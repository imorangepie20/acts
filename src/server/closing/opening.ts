import { asc, eq, inArray, ne, sql } from "drizzle-orm";
import { normalSideOf } from "@/lib/accounts";
import { formatWon, MAX_WON } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { LineInput, StoredVoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { accounts, sites, voucherLines, vouchers } from "@/server/db/schema";
import { fail, type Result } from "@/server/result";
import type { Conn } from "@/server/vouchers/snapshot";
import {
  ERR_ACCOUNT,
  ERR_AMOUNT,
  ERR_CONFLICT,
  ERR_DATE,
  ERR_REF,
  errPartnerRequired,
  isVoucherDate,
  loadVat,
  writeOpeningVoucher,
} from "@/server/vouchers/service";
import { assertMonthsOpen, lockPeriodsExclusive } from "./periods";

export { getOpeningCutoff } from "@/server/vouchers/service";

/**
 * One 기초잔액 entry. `balance` is signed: positive on the account's normal side (`normalSideOf`),
 * negative on the other, e.g. 213 감가상각누계액 is entered as −200,000.
 */
export type OpeningLine = { accountId: number; partnerId: number | null; balance: number };

export type Opening = {
  voucherId: string | null;
  version: number | null;
  /** The cut-off: regular vouchers must be dated after it. */
  date: string | null;
  lines: OpeningLine[];
};

export type OpeningInput = { date: string; version: number | null; lines: OpeningLine[] };

export const OPENING_DESCRIPTION = "기초잔액";

const ERR_PERMISSION = "기초잔액 입력 권한이 없습니다.";
const errUnbalanced = (diff: number) => `차변과 대변 합계가 일치하지 않습니다. (차액 ${formatWon(diff)}원)`;
const errFirstVoucher = (date: string) => `기초잔액 기준일은 첫 전표 날짜(${date})보다 앞서야 합니다.`;

const opposite = (side: LineInput["side"]): LineInput["side"] => (side === "debit" ? "credit" : "debit");

/** The single opening voucher, as signed balances in line order (empty when none was saved). */
export async function getOpening(db: Conn): Promise<Opening> {
  const [v] = await db
    .select({ id: vouchers.id, version: vouchers.version, date: vouchers.date })
    .from(vouchers)
    .where(eq(vouchers.kind, "opening"));
  if (!v) return { voucherId: null, version: null, date: null, lines: [] };
  const rows = await db
    .select({
      accountId: voucherLines.accountId,
      partnerId: voucherLines.partnerId,
      side: voucherLines.side,
      amount: voucherLines.amount,
      group: accounts.group,
    })
    .from(voucherLines)
    .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
    .where(eq(voucherLines.voucherId, v.id))
    .orderBy(asc(voucherLines.lineNo));
  return {
    voucherId: v.id,
    version: v.version,
    date: v.date,
    lines: rows.map((r) => ({
      accountId: r.accountId,
      partnerId: r.partnerId,
      balance: r.side === normalSideOf(r.group) ? r.amount : -r.amount,
    })),
  };
}

/**
 * Saves the pre-adoption balances as the one `opening` voucher dated `input.date` (the cut-off),
 * creating it or replacing it in place. Always approved by the actor.
 *
 * Lock and read order: the period lock EXCLUSIVE first (so no voucher write runs between the
 * first-voucher check and commit, and every later write reads the new cut-off) → accounts → the
 * earliest regular voucher → the stored opening voucher FOR UPDATE → the close watermark → the
 * first active site → the shared voucher validation → numbering lock (in the shared writer).
 */
export async function saveOpening(db: Db, actor: SessionUser, input: OpeningInput): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!isVoucherDate(input.date)) return fail(ERR_DATE);
  if (input.lines.some((l) => !Number.isInteger(l.balance) || Math.abs(l.balance) > MAX_WON)) {
    return fail(ERR_AMOUNT);
  }
  const entries = input.lines.filter((l) => l.balance !== 0);
  const vat = await loadVat(db);
  try {
    return await db.transaction(async (tx) => {
      await lockPeriodsExclusive(tx);

      const ids = [...new Set(entries.map((l) => l.accountId))];
      const accountRows = await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          group: accounts.group,
          requiresPartner: accounts.requiresPartner,
        })
        .from(accounts)
        .where(inArray(accounts.id, ids));
      const accountById = new Map(accountRows.map((a) => [a.id, a]));
      if (entries.some((l) => !accountById.has(l.accountId))) return fail(ERR_ACCOUNT);

      const sided = entries.map((l) => {
        const normal = normalSideOf(accountById.get(l.accountId)!.group);
        return { ...l, side: l.balance > 0 ? normal : opposite(normal), amount: Math.abs(l.balance) };
      });
      const total = (side: LineInput["side"]) =>
        sided.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
      const diff = total("debit") - total("credit");
      if (diff !== 0) return fail(errUnbalanced(Math.abs(diff)));

      for (const l of entries) {
        const a = accountById.get(l.accountId)!;
        if (a.requiresPartner && l.partnerId === null) return fail(errPartnerRequired(a.code, a.name));
      }

      const [first] = await tx
        .select({ date: sql<string | null>`min(${vouchers.date})` })
        .from(vouchers)
        .where(ne(vouchers.kind, "opening"));
      if (first?.date && first.date <= input.date) return fail(errFirstVoucher(first.date));

      const [stored] = await tx
        .select({ id: vouchers.id, version: vouchers.version, date: vouchers.date })
        .from(vouchers)
        .where(eq(vouchers.kind, "opening"))
        .for("update");
      const closed = await assertMonthsOpen(tx, stored ? [input.date, stored.date] : [input.date]);
      if (closed) return fail(closed);

      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.isActive, true))
        .orderBy(asc(sites.id))
        .limit(1);
      if (!site) return fail(ERR_REF);

      const voucher: StoredVoucherInput & { kind: "opening" } = {
        date: input.date,
        description: OPENING_DESCRIPTION,
        entryType: "general",
        kind: "opening",
        partnerId: null,
        evidenceType: "none",
        vatType: null,
        vatDeductible: null,
        supplyAmount: null,
        vatAmount: null,
        lines: sided.map((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          partnerId: l.partnerId,
          siteId: site.id,
          departmentId: null,
          description: OPENING_DESCRIPTION,
        })),
      };
      return writeOpeningVoucher(tx, actor, vat, voucher, input.version, stored ?? null);
    });
  } catch (e) {
    // A concurrent first save that slipped past the version check: the single-opening index wins.
    if (isUniqueViolation(e)) return fail(ERR_CONFLICT);
    throw e;
  }
}
