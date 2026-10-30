import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { addDays, fiscalYearStart, shiftYear } from "@/lib/reports/fiscal";
import type { StatementLine } from "@/lib/reports/statements";
import { isIsoDate } from "@/lib/vouchers/dates";
import type { SessionUser } from "@/server/auth/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { fiscalYearCloses } from "@/server/db/schema";
import { getBalanceSheet, getIncomeStatement } from "@/server/reports/service";
import { fail, ok, type Result } from "@/server/result";
import type { Conn } from "@/server/vouchers/snapshot";
import { isMonthClosed, lockPeriodsExclusive, monthOf } from "./periods";

/**
 * Fiscal-year close is a lock plus a reconciliation, not a carry-forward voucher: balance-sheet
 * balances roll into the next year because reports accumulate from the beginning of time, and the
 * prior-years profit row is computed. See the Phase 1D notes.
 */
export type TaxFigures = {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
};

export type YearEnd = {
  fiscalStart: string;
  fiscalEnd: string;
  system: TaxFigures;
  tax: TaxFigures | null;
  closed: boolean;
  closedAt: Date | null;
  allMonthsClosed: boolean;
};

const ERR_PERMISSION = "마감 권한이 없습니다.";
const ERR_INVALID = "입력값이 올바르지 않습니다.";
const ERR_MONTHS_OPEN = "회계연도의 모든 월을 먼저 마감하세요.";
const ERR_ALREADY = "이미 마감된 회계연도입니다.";
const ERR_NOT_LATEST = "가장 최근에 마감한 회계연도부터 해제할 수 있습니다.";
const ERR_NOT_CLOSED = "마감되지 않은 회계연도입니다.";

const fiscalEndOf = (fiscalStart: string) => addDays(shiftYear(fiscalStart, 1), -1);

function amountOf(lines: StatementLine[], key: string): number {
  const l = lines.find((x) => x.kind === "computed" && x.key === key);
  return l ? l.amount : 0;
}

/** Whether `fiscalStart` is the first day of a fiscal year under the company's start month. */
async function isFiscalStart(db: Conn, fiscalStart: string): Promise<boolean> {
  if (!isIsoDate(fiscalStart)) return false;
  const { fiscalYearStartMonth } = await getCompany(db as Db);
  return fiscalYearStart(fiscalStart, fiscalYearStartMonth) === fiscalStart;
}

function validFigures(f: TaxFigures): boolean {
  return [f.totalAssets, f.totalLiabilities, f.totalEquity, f.netIncome].every((n) => Number.isSafeInteger(n));
}

export async function getYearEnd(db: Db, fiscalStart: string): Promise<YearEnd> {
  const fiscalEnd = fiscalEndOf(fiscalStart);
  const scope = { siteId: null, departmentId: null };
  const [bs, is, [row]] = await Promise.all([
    getBalanceSheet(db, { from: fiscalEnd, to: fiscalEnd, ...scope }),
    getIncomeStatement(db, { from: fiscalStart, to: fiscalEnd, ...scope }),
    db.select().from(fiscalYearCloses).where(eq(fiscalYearCloses.fiscalStart, fiscalStart)),
  ]);
  return {
    fiscalStart,
    fiscalEnd,
    system: {
      totalAssets: amountOf(bs.lines, "total_assets"),
      totalLiabilities: amountOf(bs.lines, "total_liabilities"),
      totalEquity: amountOf(bs.lines, "total_equity"),
      netIncome: amountOf(is.lines, "net"),
    },
    tax: row?.taxFigures ?? null,
    closed: row?.closedAt != null,
    closedAt: row?.closedAt ?? null,
    allMonthsClosed: await isMonthClosed(db, monthOf(fiscalEnd)),
  };
}

/** Saves what the 세무사 filed; allowed whether the year is open or closed. */
export async function saveTaxFigures(
  db: Db,
  actor: SessionUser,
  fiscalStart: string,
  figures: TaxFigures,
): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!validFigures(figures) || !(await isFiscalStart(db, fiscalStart))) return fail(ERR_INVALID);
  const taxFigures: TaxFigures = {
    totalAssets: figures.totalAssets,
    totalLiabilities: figures.totalLiabilities,
    totalEquity: figures.totalEquity,
    netIncome: figures.netIncome,
  };
  await db
    .insert(fiscalYearCloses)
    .values({ fiscalStart, taxFigures })
    .onConflictDoUpdate({ target: fiscalYearCloses.fiscalStart, set: { taxFigures } });
  return ok();
}

/** Closes the year once all 12 months are closed. Differences from the 세무사 figures do not block it. */
export async function closeFiscalYear(db: Db, actor: SessionUser, fiscalStart: string): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!(await isFiscalStart(db, fiscalStart))) return fail(ERR_INVALID);
  return db.transaction(async (tx) => {
    await lockPeriodsExclusive(tx);
    const [row] = await tx.select().from(fiscalYearCloses).where(eq(fiscalYearCloses.fiscalStart, fiscalStart));
    if (row?.closedAt) return fail(ERR_ALREADY);
    if (!(await isMonthClosed(tx, monthOf(fiscalEndOf(fiscalStart))))) return fail(ERR_MONTHS_OPEN);
    await tx
      .insert(fiscalYearCloses)
      .values({ fiscalStart, closedBy: actor.id, closedAt: sql`now()` })
      .onConflictDoUpdate({
        target: fiscalYearCloses.fiscalStart,
        set: { closedBy: actor.id, closedAt: sql`now()` },
      });
    return ok();
  });
}

/** Reopens the latest closed year; the saved 세무사 figures are kept. */
export async function reopenFiscalYear(db: Db, actor: SessionUser, fiscalStart: string): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!(await isFiscalStart(db, fiscalStart))) return fail(ERR_INVALID);
  return db.transaction(async (tx) => {
    await lockPeriodsExclusive(tx);
    const [row] = await tx.select().from(fiscalYearCloses).where(eq(fiscalYearCloses.fiscalStart, fiscalStart));
    if (!row?.closedAt) return fail(ERR_NOT_CLOSED);
    const [latest] = await tx
      .select({ fiscalStart: fiscalYearCloses.fiscalStart })
      .from(fiscalYearCloses)
      .where(isNotNull(fiscalYearCloses.closedAt))
      .orderBy(desc(fiscalYearCloses.fiscalStart))
      .limit(1);
    if (latest?.fiscalStart !== fiscalStart) return fail(ERR_NOT_LATEST);
    await tx
      .update(fiscalYearCloses)
      .set({ closedAt: null, closedBy: null })
      .where(eq(fiscalYearCloses.fiscalStart, fiscalStart));
    return ok();
  });
}
