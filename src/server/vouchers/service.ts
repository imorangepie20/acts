import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { MAX_WON } from "@/lib/money";
import { can } from "@/lib/permissions";
import { buildSimpleVoucher, toSimpleInput, type VatAccounts } from "@/lib/vouchers/simple";
import type {
  EntryType,
  LineInput,
  VoucherAction,
  VoucherHeaderInput,
  VoucherInput,
  VoucherKind,
  VoucherSnapshot,
  VoucherStatus,
} from "@/lib/vouchers/types";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import {
  accounts,
  departments,
  partners,
  sites,
  users,
  voucherHistory,
  voucherLines,
  vouchers,
} from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export type VoucherDetail = VoucherHeaderInput & {
  id: string;
  no: number;
  kind: VoucherKind;
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

const ERR_DATE = "날짜가 올바르지 않습니다.";
const ERR_LINES = "전표에는 2줄 이상이 필요합니다.";
const ERR_AMOUNT = "금액은 1원 이상 1조 원 미만의 정수여야 합니다.";
const ERR_BALANCE = "차변 합계와 대변 합계가 일치하지 않습니다.";
const ERR_ACCOUNT = "사용할 수 없는 계정과목입니다.";
const errPartnerRequired = (code: string, name: string) => `${code} ${name} 계정은 거래처를 입력해야 합니다.`;
const ERR_REF = "사용할 수 없는 거래처, 사업장 또는 부서입니다.";
const ERR_INVALID = "입력값이 올바르지 않습니다.";
const ERR_CONFLICT = "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.";
const ERR_NOT_FOUND = "전표를 찾을 수 없습니다.";
const ERR_FORBIDDEN = "이 전표를 수정할 권한이 없습니다.";

export const PAGE_SIZE = 50;
/** First key of the two-key advisory lock taken while numbering vouchers (second key: the date). */
const NUMBERING_LOCK = 0x76_6f_75_63; // "vouc"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

export function canModify(actor: SessionUser, v: { createdBy: string }): boolean {
  return can(actor.role, "voucher:create") && (v.createdBy === actor.id || can(actor.role, "voucher:approve"));
}

/** Days since 1970-01-01 for a valid YYYY-MM-DD, else null. */
function epochDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

/** Ids already on the stored voucher's lines; inactive ones stay usable on update. */
type Allowed = { accounts: Set<number>; partners: Set<number>; sites: Set<number>; departments: Set<number> };
const NONE_ALLOWED: Allowed = { accounts: new Set(), partners: new Set(), sites: new Set(), departments: new Set() };

const nonNull = <T>(xs: (T | null)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null))];

/** Read before the transaction: VAT account ids (for the simple-entry re-check) and the approval setting. */
type Context = { vat: VatAccounts; approvalRequired: boolean };
async function loadContext(db: Db): Promise<Context> {
  const [vat, company] = await Promise.all([getVatAccountIds(db), getCompany(db)]);
  return { vat, approvalRequired: company.approvalRequired };
}

async function validate(tx: Conn, ctx: Context, input: VoucherInput, allowed: Allowed): Promise<string | null> {
  if (epochDay(input.date) === null) return ERR_DATE;
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

  if (input.entryType !== "general") {
    const s = toSimpleInput(input, ctx.vat);
    if (s === null) return ERR_INVALID;
    const b = buildSimpleVoucher(s, ctx.vat);
    if (!b.ok) return b.error;
    if (!sameVoucher(b.value, input)) return ERR_INVALID;
  }
  return null;
}

function sameVoucher(a: VoucherInput, b: VoucherInput): boolean {
  const headerKeys = [
    "date",
    "description",
    "entryType",
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

/** Next number for the date, serialised per date by a transaction-scoped advisory lock. */
async function nextNo(tx: Tx, date: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(${NUMBERING_LOCK}::int, ${epochDay(date)!}::int)`);
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${vouchers.no}), 0)::int + 1` })
    .from(vouchers)
    .where(eq(vouchers.date, date));
  return next;
}

function statusFields(ctx: Context, actor: SessionUser) {
  return ctx.approvalRequired
    ? { status: "pending" as const, approvedBy: null, approvedAt: null }
    : { status: "approved" as const, approvedBy: actor.id, approvedAt: new Date() };
}

const header = (input: VoucherHeaderInput): VoucherHeaderInput => ({
  date: input.date,
  entryType: input.entryType,
  description: input.description,
  partnerId: input.partnerId,
  evidenceType: input.evidenceType,
  vatType: input.vatType,
  vatDeductible: input.vatDeductible,
  supplyAmount: input.supplyAmount,
  vatAmount: input.vatAmount,
});

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

const lineColumns = {
  accountId: voucherLines.accountId,
  side: voucherLines.side,
  amount: voucherLines.amount,
  partnerId: voucherLines.partnerId,
  siteId: voucherLines.siteId,
  departmentId: voucherLines.departmentId,
  description: voucherLines.description,
};

/** The stored voucher as a history snapshot (null if it does not exist). */
async function loadSnapshot(tx: Conn, id: string): Promise<VoucherSnapshot | null> {
  const [v] = await tx.select().from(vouchers).where(eq(vouchers.id, id));
  if (!v) return null;
  const lines = await tx
    .select(lineColumns)
    .from(voucherLines)
    .where(eq(voucherLines.voucherId, id))
    .orderBy(asc(voucherLines.lineNo));
  return { ...header(v), no: v.no, status: v.status, attachments: [], lines };
}

async function addHistory(tx: Tx, voucherId: string, action: VoucherAction, actor: SessionUser, snapshot: VoucherSnapshot) {
  await tx.insert(voucherHistory).values({ voucherId, action, userId: actor.id, snapshot });
}

export async function createVoucher(
  db: Db,
  actor: SessionUser,
  input: VoucherInput,
): Promise<Result<{ id: string }>> {
  const ctx = await loadContext(db);
  return db.transaction(async (tx) => {
    const error = await validate(tx, ctx, input, NONE_ALLOWED);
    if (error) return fail(error);
    const no = await nextNo(tx, input.date);
    const [{ id }] = await tx
      .insert(vouchers)
      .values({
        ...header(input),
        no,
        ...statusFields(ctx, actor),
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: vouchers.id });
    await insertLines(tx, id, input.lines);
    await addHistory(tx, id, "created", actor, (await loadSnapshot(tx, id))!);
    return ok({ id });
  });
}

/** Locks the stored voucher and checks existence, permission and version. */
async function lockForWrite(
  tx: Tx,
  actor: SessionUser,
  id: string,
  version: number,
): Promise<Result<{ date: string }>> {
  if (!UUID_RE.test(id)) return fail(ERR_NOT_FOUND);
  const [v] = await tx
    .select({ date: vouchers.date, version: vouchers.version, createdBy: vouchers.createdBy })
    .from(vouchers)
    .where(eq(vouchers.id, id))
    .for("update");
  if (!v) return fail(ERR_NOT_FOUND);
  if (!canModify(actor, v)) return fail(ERR_FORBIDDEN);
  if (v.version !== version) return fail(ERR_CONFLICT);
  return ok({ date: v.date });
}

export async function updateVoucher(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  input: VoucherInput,
): Promise<Result> {
  const ctx = await loadContext(db);
  return db.transaction(async (tx) => {
    const locked = await lockForWrite(tx, actor, id, version);
    if (!locked.ok) return locked;

    const stored = await tx.select(lineColumns).from(voucherLines).where(eq(voucherLines.voucherId, id));
    const allowed: Allowed = {
      accounts: new Set(stored.map((l) => l.accountId)),
      partners: new Set(nonNull(stored.map((l) => l.partnerId))),
      sites: new Set(stored.map((l) => l.siteId)),
      departments: new Set(nonNull(stored.map((l) => l.departmentId))),
    };
    const error = await validate(tx, ctx, input, allowed);
    if (error) return fail(error);

    const renumber = input.date !== locked.value.date ? { no: await nextNo(tx, input.date) } : {};
    const updated = await tx
      .update(vouchers)
      .set({
        ...header(input),
        ...renumber,
        ...statusFields(ctx, actor),
        rejectReason: null,
        version: sql`${vouchers.version} + 1`,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(and(eq(vouchers.id, id), eq(vouchers.version, version)))
      .returning({ id: vouchers.id });
    if (updated.length === 0) return fail(ERR_CONFLICT);

    await tx.delete(voucherLines).where(eq(voucherLines.voucherId, id));
    await insertLines(tx, id, input.lines);
    await addHistory(tx, id, "updated", actor, (await loadSnapshot(tx, id))!);
    return ok();
  });
}

export async function deleteVoucher(db: Db, actor: SessionUser, id: string, version: number): Promise<Result> {
  return db.transaction(async (tx) => {
    const locked = await lockForWrite(tx, actor, id, version);
    if (!locked.ok) return locked;
    const snapshot = (await loadSnapshot(tx, id))!;
    const deleted = await tx
      .delete(vouchers)
      .where(and(eq(vouchers.id, id), eq(vouchers.version, version)))
      .returning({ id: vouchers.id });
    if (deleted.length === 0) return fail(ERR_CONFLICT);
    await addHistory(tx, id, "deleted", actor, snapshot);
    return ok();
  });
}

const creator = alias(users, "creator");
const approver = alias(users, "approver");

export async function getVoucher(db: Db, id: string): Promise<VoucherDetail | null> {
  if (!UUID_RE.test(id)) return null;
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
  f: { from?: string; to?: string; status?: VoucherStatus; q?: string; page?: number },
): Promise<{ rows: VoucherListRow[]; total: number }> {
  const conds: (SQL | undefined)[] = [];
  if (f.from) conds.push(gte(vouchers.date, f.from));
  if (f.to) conds.push(lte(vouchers.date, f.to));
  if (f.status) conds.push(eq(vouchers.status, f.status));
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
  if (!UUID_RE.test(voucherId)) return [];
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
