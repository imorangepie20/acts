import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { MAX_WON } from "@/lib/money";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { buildSimpleVoucher, toSimpleInput, type VatAccounts } from "@/lib/vouchers/simple";
import type {
  EntryType,
  LineInput,
  StoredVoucherHeader,
  StoredVoucherInput,
  VoucherAction,
  VoucherInput,
  VoucherKind,
  VoucherSnapshot,
  VoucherStatus,
} from "@/lib/vouchers/types";
import { getVatAccountIds } from "@/server/accounts/service";
import { removeStored } from "@/server/attachments/storage";
import type { SessionUser } from "@/server/auth/service";
import { assertMonthsOpen } from "@/server/closing/periods";
import type { Db } from "@/server/db/client";
import {
  accounts,
  company,
  departments,
  partners,
  sites,
  users,
  voucherAttachments,
  voucherHistory,
  voucherLines,
  vouchers,
} from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { addHistory, header, lineColumns, loadSnapshot, type Conn, type Tx } from "./snapshot";

export type VoucherDetail = StoredVoucherHeader & {
  id: string;
  no: number;
  status: VoucherStatus;
  rejectReason: string | null;
  version: number;
  createdBy: { id: string; name: string };
  updatedAt: Date;
  approvedBy: { id: string; name: string } | null;
  approvedAt: Date | null;
  lines: (LineInput & {
    account: { code: string; name: string };
    partnerName: string | null;
    siteName: string;
    departmentName: string | null;
  })[];
};

export type VoucherListRow = {
  id: string;
  date: string;
  no: number;
  entryType: EntryType;
  kind: VoucherKind;
  description: string;
  partnerName: string | null;
  /** debit total */
  amount: number;
  status: VoucherStatus;
  createdByName: string;
};

export type HistoryEntry = {
  id: number;
  action: VoucherAction;
  userName: string;
  at: Date;
  snapshot: VoucherSnapshot;
  note: string | null;
};

export const ERR_DATE = "날짜가 올바르지 않습니다.";
const ERR_LINES = "전표에는 2줄 이상이 필요합니다.";
export const ERR_AMOUNT = "금액은 1원 이상 1조 원 미만의 정수여야 합니다.";
const ERR_BALANCE = "차변 합계와 대변 합계가 일치하지 않습니다.";
export const ERR_ACCOUNT = "사용할 수 없는 계정과목입니다.";
export const errPartnerRequired = (code: string, name: string) => `${code} ${name} 계정은 거래처를 입력해야 합니다.`;
export const ERR_REF = "사용할 수 없는 거래처, 사업장 또는 부서입니다.";
const ERR_INVALID = "입력값이 올바르지 않습니다.";
const ERR_CLOSING_TYPE = "결산 전표는 일반 전표로만 입력합니다.";
export const ERR_CONFLICT = "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.";
const errBeforeCutoff = (cutoff: string) => `기초잔액 기준일(${cutoff}) 이후 날짜만 입력할 수 있습니다.`;
const ERR_OPENING_ONLY = "기초잔액은 기초잔액 화면에서 수정하세요.";
const ERR_NOT_FOUND = "전표를 찾을 수 없습니다.";
const ERR_FORBIDDEN = "이 전표를 수정할 권한이 없습니다.";
const ERR_NOT_PENDING = "승인 대기 중인 전표가 아닙니다.";
const ERR_REASON = "반려 사유를 입력하세요.";
const ERR_NO_APPROVE = "승인 권한이 없습니다.";

export const PAGE_SIZE = 50;
/** First key of the two-key advisory lock taken while numbering vouchers (second key: the date). */
const NUMBERING_LOCK = 0x76_6f_75_63; // "vouc"

export function canModify(actor: SessionUser, v: { createdBy: string }): boolean {
  return can(actor.role, "voucher:create") && (v.createdBy === actor.id || can(actor.role, "voucher:approve"));
}

const MIN_YEAR = 2000;

/** True for a valid YYYY-MM-DD a voucher may carry (years 2000..Seoul year + 1). */
export const isVoucherDate = (date: string): boolean => epochDay(date) !== null;

/** Days since 1970-01-01 for a valid YYYY-MM-DD within 2000..(Seoul year + 1), else null. */
function epochDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > Number(todayInSeoul().slice(0, 4)) + 1) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

/** Ids already on the stored voucher's lines; inactive ones stay usable on update. */
type Allowed = { accounts: Set<number>; partners: Set<number>; sites: Set<number>; departments: Set<number> };
const NONE_ALLOWED: Allowed = { accounts: new Set(), partners: new Set(), sites: new Set(), departments: new Set() };

const nonNull = <T>(xs: (T | null)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null))];

/** Read before the transaction: VAT account ids (for the simple-entry re-check). */
type Context = { vat: VatAccounts; approvalRequired: boolean };
export async function loadVat(db: Db): Promise<VatAccounts> {
  return getVatAccountIds(db);
}

/**
 * The approval setting, read inside the write transaction under a share lock: it waits for an
 * in-flight toggle (which holds FOR UPDATE on the row until commit) and blocks a later toggle
 * until this voucher commits, so the toggle's auto-approve always sees the voucher.
 */
async function readApproval(tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ approvalRequired: company.approvalRequired })
    .from(company)
    .where(eq(company.id, 1))
    .for("share");
  if (!row) throw new Error("회사 정보가 없습니다. 시드를 실행하세요.");
  return row.approvalRequired;
}

/**
 * The 기초잔액 cut-off: the opening voucher's date, or null. Voucher writes read it inside their
 * transaction, after the period lock; `saveOpening` holds that lock exclusively, so a write never
 * races a cut-off change.
 */
export async function getOpeningCutoff(conn: Conn): Promise<string | null> {
  const [row] = await conn.select({ date: vouchers.date }).from(vouchers).where(eq(vouchers.kind, "opening"));
  return row?.date ?? null;
}

async function validate(
  tx: Conn,
  ctx: Context,
  input: StoredVoucherInput,
  allowed: Allowed,
): Promise<string | null> {
  if (epochDay(input.date) === null) return ERR_DATE;
  if (input.kind !== "opening") {
    // Nothing regular on or before the cut-off: the opening voucher already holds that history.
    const cutoff = await getOpeningCutoff(tx);
    if (cutoff !== null && input.date <= cutoff) return errBeforeCutoff(cutoff);
  }
  if (input.lines.length < 2) return ERR_LINES;
  if (input.lines.some((l) => !Number.isInteger(l.amount) || l.amount < 1 || l.amount > MAX_WON)) {
    return ERR_AMOUNT;
  }
  const total = (side: LineInput["side"]) =>
    input.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
  if (total("debit") !== total("credit")) return ERR_BALANCE;

  const accountIds = nonNull(input.lines.map((l) => l.accountId));
  const accountRows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      requiresPartner: accounts.requiresPartner,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  for (const l of input.lines) {
    const a = accountById.get(l.accountId);
    if (!a || (!a.isActive && !allowed.accounts.has(a.id))) return ERR_ACCOUNT;
  }
  for (const l of input.lines) {
    const a = accountById.get(l.accountId)!;
    if (a.requiresPartner && l.partnerId === null) return errPartnerRequired(a.code, a.name);
  }

  const usable = async (
    table: typeof partners | typeof sites | typeof departments,
    ids: number[],
    allowedIds: Set<number>,
  ): Promise<boolean> => {
    if (ids.length === 0) return true;
    const rows = await tx
      .select({ id: table.id, isActive: table.isActive })
      .from(table)
      .where(inArray(table.id, ids));
    return (
      rows.length === ids.length && rows.every((r) => r.isActive || allowedIds.has(r.id))
    );
  };
  const partnerIds = nonNull([input.partnerId, ...input.lines.map((l) => l.partnerId)]);
  const siteIds = nonNull(input.lines.map((l) => l.siteId));
  const departmentIds = nonNull(input.lines.map((l) => l.departmentId));
  if (
    !(await usable(partners, partnerIds, allowed.partners)) ||
    !(await usable(sites, siteIds, allowed.sites)) ||
    !(await usable(departments, departmentIds, allowed.departments))
  ) {
    return ERR_REF;
  }

  if (input.kind === "closing" && input.entryType !== "general") return ERR_CLOSING_TYPE;
  if (input.entryType === "general") {
    // General vouchers carry no VAT metadata; VAT goes through the purchase/sale forms.
    if (
      input.vatType !== null ||
      input.vatDeductible !== null ||
      input.supplyAmount !== null ||
      input.vatAmount !== null
    ) {
      return ERR_INVALID;
    }
  } else {
    if (input.kind === "opening") return ERR_INVALID; // 기초 is always a general entry
    const regular: VoucherInput = { ...input, kind: input.kind };
    const s = toSimpleInput(regular, ctx.vat);
    if (s === null) return ERR_INVALID;
    const b = buildSimpleVoucher(s, ctx.vat);
    if (!b.ok) return b.error;
    if (!sameVoucher(b.value, regular)) return ERR_INVALID;
  }
  return null;
}

function sameVoucher(a: VoucherInput, b: VoucherInput): boolean {
  const headerKeys = [
    "date",
    "description",
    "entryType",
    "kind",
    "partnerId",
    "evidenceType",
    "vatType",
    "vatDeductible",
    "supplyAmount",
    "vatAmount",
  ] as const;
  const lineKeys = ["accountId", "side", "amount", "partnerId", "siteId", "departmentId", "description"] as const;
  return (
    headerKeys.every((k) => a[k] === b[k]) &&
    a.lines.length === b.lines.length &&
    a.lines.every((x, i) => lineKeys.every((k) => x[k] === b.lines[i][k]))
  );
}

/**
 * Stored date read before the transaction, so the period lock can be taken first. Callers re-check
 * it against the row locked by `lockForWrite` and return the conflict message if it moved.
 */
async function storedDate(db: Db, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [v] = await db.select({ date: vouchers.date }).from(vouchers).where(eq(vouchers.id, id));
  return v?.date ?? null;
}

/** Next number for the date, serialised per date by a transaction-scoped advisory lock. */
async function nextNo(tx: Tx, date: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(${NUMBERING_LOCK}::int, ${epochDay(date)!}::int)`);
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${vouchers.no}), 0)::int + 1` })
    .from(vouchers)
    .where(eq(vouchers.date, date));
  return next;
}

type StatusFields =
  | { status: "pending"; approvedBy: null; approvedAt: null }
  | { status: "approved"; approvedBy: string; approvedAt: SQL };

const approvedBy = (actor: SessionUser): StatusFields => ({
  status: "approved",
  approvedBy: actor.id,
  approvedAt: sql`now()`,
});

function statusFields(ctx: Context, actor: SessionUser): StatusFields {
  return ctx.approvalRequired ? { status: "pending", approvedBy: null, approvedAt: null } : approvedBy(actor);
}

async function insertLines(tx: Tx, voucherId: string, lines: LineInput[]): Promise<void> {
  await tx.insert(voucherLines).values(
    lines.map((l, i) => ({
      voucherId,
      lineNo: i + 1,
      accountId: l.accountId,
      side: l.side,
      amount: l.amount,
      partnerId: l.partnerId,
      siteId: l.siteId,
      departmentId: l.departmentId,
      description: l.description,
    })),
  );
}

/** Numbers and inserts a validated voucher with its lines and the `created` history row. */
async function insertVoucher(
  tx: Tx,
  actor: SessionUser,
  input: StoredVoucherInput,
  status: StatusFields,
): Promise<string> {
  const no = await nextNo(tx, input.date);
  const [{ id }] = await tx
    .insert(vouchers)
    .values({ ...header(input), no, ...status, createdBy: actor.id, updatedBy: actor.id })
    .returning({ id: vouchers.id });
  await insertLines(tx, id, input.lines);
  await addHistory(tx, id, "created", actor.id, (await loadSnapshot(tx, id))!);
  return id;
}

/**
 * Replaces a locked voucher's header and lines with validated input: renumbers on a date change,
 * bumps the version and writes the `updated` history row. Fails with the conflict message if the
 * version moved.
 */
async function replaceVoucher(
  tx: Tx,
  actor: SessionUser,
  id: string,
  version: number,
  storedDate: string,
  input: StoredVoucherInput,
  status: StatusFields,
): Promise<Result> {
  const renumber = input.date !== storedDate ? { no: await nextNo(tx, input.date) } : {};
  const updated = await tx
    .update(vouchers)
    .set({
      ...header(input),
      ...renumber,
      ...status,
      rejectReason: null,
      version: sql`${vouchers.version} + 1`,
      updatedBy: actor.id,
      updatedAt: sql`now()`,
    })
    .where(and(eq(vouchers.id, id), eq(vouchers.version, version)))
    .returning({ id: vouchers.id });
  if (updated.length === 0) return fail(ERR_CONFLICT);

  await tx.delete(voucherLines).where(eq(voucherLines.voucherId, id));
  await insertLines(tx, id, input.lines);
  await addHistory(tx, id, "updated", actor.id, (await loadSnapshot(tx, id))!);
  return ok();
}

/** Ids on a stored voucher's lines; they stay usable on update even if since deactivated. */
async function storedRefs(tx: Tx, id: string): Promise<Allowed> {
  const stored = await tx.select(lineColumns).from(voucherLines).where(eq(voucherLines.voucherId, id));
  return {
    accounts: new Set(stored.map((l) => l.accountId)),
    partners: new Set(nonNull(stored.map((l) => l.partnerId))),
    sites: new Set(stored.map((l) => l.siteId)),
    departments: new Set(nonNull(stored.map((l) => l.departmentId))),
  };
}

export async function createVoucher(
  db: Db,
  actor: SessionUser,
  input: VoucherInput,
): Promise<Result<{ id: string }>> {
  const vat = await loadVat(db);
  return db.transaction(async (tx) => {
    // Lock order (every voucher write): global period lock (PERIOD_LOCK, 0) → company FOR SHARE → voucher row → numbering.
    const closed = await assertMonthsOpen(tx, [input.date]);
    if (closed) return fail(closed);
    const ctx: Context = { vat, approvalRequired: await readApproval(tx) };
    const error = await validate(tx, ctx, input, NONE_ALLOWED);
    if (error) return fail(error);
    return ok({ id: await insertVoucher(tx, actor, input, statusFields(ctx, actor)) });
  });
}

/**
 * Writes the single 기초 (opening) voucher for `saveOpening` through the regular validation,
 * numbering, version bump, line replacement and history. Always approved by the actor. The caller
 * holds the period lock exclusively, has checked the opening rules, and passes the stored opening
 * voucher it locked FOR UPDATE (or null); a `version` that does not match it is a conflict.
 */
export async function writeOpeningVoucher(
  tx: Tx,
  actor: SessionUser,
  vat: VatAccounts,
  input: StoredVoucherInput & { kind: "opening" },
  version: number | null,
  stored: { id: string; version: number; date: string } | null,
): Promise<Result> {
  if (version !== (stored?.version ?? null)) return fail(ERR_CONFLICT);
  const ctx: Context = { vat, approvalRequired: false };
  const error = await validate(tx, ctx, input, stored ? await storedRefs(tx, stored.id) : NONE_ALLOWED);
  if (error) return fail(error);
  if (!stored) {
    await insertVoucher(tx, actor, input, approvedBy(actor));
    return ok();
  }
  return replaceVoucher(tx, actor, stored.id, stored.version, stored.date, input, approvedBy(actor));
}

/**
 * Locks the stored voucher and checks existence, permission (default: may modify), version, and
 * that its date is still `expectedDate` (the pre-transaction read the closed-month check was made for).
 */
async function lockForWrite(
  tx: Tx,
  actor: SessionUser,
  id: string,
  version: number,
  expectedDate: string | null,
  permitted: (v: { createdBy: string; kind: VoucherKind }) => Result = (v) => {
    // The opening voucher is written only by saveOpening (its own rules and screen).
    if (v.kind === "opening") return fail(ERR_OPENING_ONLY);
    return canModify(actor, v) ? ok() : fail(ERR_FORBIDDEN);
  },
): Promise<Result<{ date: string; status: VoucherStatus }>> {
  if (!isUuid(id)) return fail(ERR_NOT_FOUND);
  const [v] = await tx
    .select({
      date: vouchers.date,
      version: vouchers.version,
      createdBy: vouchers.createdBy,
      status: vouchers.status,
      kind: vouchers.kind,
    })
    .from(vouchers)
    .where(eq(vouchers.id, id))
    .for("update");
  if (!v) return fail(ERR_NOT_FOUND);
  const allowed = permitted(v);
  if (!allowed.ok) return allowed;
  if (v.version !== version || v.date !== expectedDate) return fail(ERR_CONFLICT);
  return ok({ date: v.date, status: v.status });
}

export async function updateVoucher(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  input: VoucherInput,
): Promise<Result> {
  const vat = await loadVat(db);
  const oldDate = await storedDate(db, id);
  return db.transaction(async (tx) => {
    // Both the stored month (moving out) and the new one (moving in) must be open.
    const closed = await assertMonthsOpen(tx, oldDate === null ? [input.date] : [oldDate, input.date]);
    if (closed) return fail(closed);
    const ctx: Context = { vat, approvalRequired: await readApproval(tx) };
    const locked = await lockForWrite(tx, actor, id, version, oldDate);
    if (!locked.ok) return locked;

    const error = await validate(tx, ctx, input, await storedRefs(tx, id));
    if (error) return fail(error);
    return replaceVoucher(tx, actor, id, version, locked.value.date, input, statusFields(ctx, actor));
  });
}

export async function deleteVoucher(db: Db, actor: SessionUser, id: string, version: number): Promise<Result> {
  const oldDate = await storedDate(db, id);
  const r = await db.transaction(async (tx): Promise<Result<string[]>> => {
    const closed = await assertMonthsOpen(tx, oldDate === null ? [] : [oldDate]);
    if (closed) return fail(closed);
    const locked = await lockForWrite(tx, actor, id, version, oldDate);
    if (!locked.ok) return locked;
    const snapshot = (await loadSnapshot(tx, id))!;
    // Attachment rows go with the voucher (ON DELETE CASCADE); their files are unlinked after commit.
    const files = await tx
      .select({ storagePath: voucherAttachments.storagePath })
      .from(voucherAttachments)
      .where(eq(voucherAttachments.voucherId, id));
    const deleted = await tx
      .delete(vouchers)
      .where(and(eq(vouchers.id, id), eq(vouchers.version, version)))
      .returning({ id: vouchers.id });
    if (deleted.length === 0) return fail(ERR_CONFLICT);
    await addHistory(tx, id, "deleted", actor.id, snapshot);
    return ok(files.map((f) => f.storagePath));
  });
  if (!r.ok) return r;
  await Promise.all(r.value.map(removeStored));
  return ok();
}

const creator = alias(users, "creator");
const approver = alias(users, "approver");

export async function getVoucher(db: Db, id: string): Promise<VoucherDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      v: vouchers,
      creatorName: creator.name,
      approverName: approver.name,
    })
    .from(vouchers)
    .innerJoin(creator, eq(creator.id, vouchers.createdBy))
    .leftJoin(approver, eq(approver.id, vouchers.approvedBy))
    .where(eq(vouchers.id, id));
  if (!row) return null;
  const lines = await db
    .select({
      ...lineColumns,
      accountCode: accounts.code,
      accountName: accounts.name,
      partnerName: partners.name,
      siteName: sites.name,
      departmentName: departments.name,
    })
    .from(voucherLines)
    .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
    .leftJoin(partners, eq(partners.id, voucherLines.partnerId))
    .innerJoin(sites, eq(sites.id, voucherLines.siteId))
    .leftJoin(departments, eq(departments.id, voucherLines.departmentId))
    .where(eq(voucherLines.voucherId, id))
    .orderBy(asc(voucherLines.lineNo));
  const { v } = row;
  return {
    ...header(v),
    id: v.id,
    no: v.no,
    kind: v.kind,
    status: v.status,
    rejectReason: v.rejectReason,
    version: v.version,
    createdBy: { id: v.createdBy, name: row.creatorName },
    updatedAt: v.updatedAt,
    approvedBy: v.approvedBy && row.approverName !== null ? { id: v.approvedBy, name: row.approverName } : null,
    approvedAt: v.approvedAt,
    lines: lines.map(({ accountCode, accountName, ...l }) => ({
      ...l,
      account: { code: accountCode, name: accountName },
    })),
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listVouchers(
  db: Db,
  f: { from?: string; to?: string; status?: VoucherStatus; kind?: VoucherKind; q?: string; page?: number },
): Promise<{ rows: VoucherListRow[]; total: number }> {
  const conds: (SQL | undefined)[] = [];
  if (f.from) conds.push(gte(vouchers.date, f.from));
  if (f.to) conds.push(lte(vouchers.date, f.to));
  if (f.status) conds.push(eq(vouchers.status, f.status));
  if (f.kind) conds.push(eq(vouchers.kind, f.kind));
  const q = f.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conds.push(or(ilike(vouchers.description, pattern), ilike(partners.name, pattern)));
  }
  const where = and(...conds);
  const page = Number.isInteger(f.page) && f.page! > 1 ? f.page! : 1;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: vouchers.id,
        date: vouchers.date,
        no: vouchers.no,
        entryType: vouchers.entryType,
        kind: vouchers.kind,
        description: vouchers.description,
        partnerName: partners.name,
        amount: sql<number>`(select coalesce(sum(${voucherLines.amount}), 0) from ${voucherLines}
          where ${voucherLines.voucherId} = ${vouchers.id} and ${voucherLines.side} = 'debit')::bigint`.mapWith(Number),
        status: vouchers.status,
        createdByName: users.name,
      })
      .from(vouchers)
      .leftJoin(partners, eq(partners.id, vouchers.partnerId))
      .innerJoin(users, eq(users.id, vouchers.createdBy))
      .where(where)
      .orderBy(desc(vouchers.date), desc(vouchers.no))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(vouchers)
      .leftJoin(partners, eq(partners.id, vouchers.partnerId))
      .where(where),
  ]);
  return { rows, total };
}

export async function listHistory(db: Db, voucherId: string): Promise<HistoryEntry[]> {
  if (!isUuid(voucherId)) return [];
  return db
    .select({
      id: voucherHistory.id,
      action: voucherHistory.action,
      userName: users.name,
      at: voucherHistory.at,
      snapshot: voucherHistory.snapshot,
      note: voucherHistory.note,
    })
    .from(voucherHistory)
    .innerJoin(users, eq(users.id, voucherHistory.userId))
    .where(eq(voucherHistory.voucherId, voucherId))
    .orderBy(asc(voucherHistory.id));
}

/** Shared by approve and reject: lock, require `pending`, apply `set`, bump the version, write history. */
async function decide(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  action: "approved" | "rejected",
  set: { [K in keyof typeof vouchers.$inferInsert]?: (typeof vouchers.$inferInsert)[K] | SQL },
  note: string | null,
): Promise<Result> {
  if (!can(actor.role, "voucher:approve")) return fail(ERR_NO_APPROVE);
  const oldDate = await storedDate(db, id);
  return db.transaction(async (tx) => {
    const closed = await assertMonthsOpen(tx, oldDate === null ? [] : [oldDate]);
    if (closed) return fail(closed);
    const locked = await lockForWrite(tx, actor, id, version, oldDate, () => ok());
    if (!locked.ok) return locked;
    if (locked.value.status !== "pending") return fail(ERR_NOT_PENDING);
    const updated = await tx
      .update(vouchers)
      .set({ ...set, version: sql`${vouchers.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(vouchers.id, id), eq(vouchers.version, version)))
      .returning({ id: vouchers.id });
    if (updated.length === 0) return fail(ERR_CONFLICT);
    await addHistory(tx, id, action, actor.id, (await loadSnapshot(tx, id))!, note);
    return ok();
  });
}

export function approveVoucher(db: Db, actor: SessionUser, id: string, version: number): Promise<Result> {
  return decide(db, actor, id, version, "approved", {
    status: "approved",
    approvedBy: actor.id,
    approvedAt: sql`now()`,
    rejectReason: null,
  }, null);
}

export async function rejectVoucher(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  reason: string,
): Promise<Result> {
  if (!can(actor.role, "voucher:approve")) return fail(ERR_NO_APPROVE);
  const trimmed = reason.trim();
  if (!trimmed) return fail(ERR_REASON);
  return decide(db, actor, id, version, "rejected", {
    status: "rejected",
    rejectReason: trimmed,
    approvedBy: null,
    approvedAt: null,
  }, trimmed);
}

export async function countPending(db: Db): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vouchers)
    .where(eq(vouchers.status, "pending"));
  return n;
}
