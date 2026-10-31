import { isBalanceSheetGroup, isPnlGroup } from "@/lib/accounts";
import { addDays, fiscalYearStart, priorYearPeriod, type Period } from "@/lib/reports/fiscal";
import {
  buildBalanceSheet,
  buildIncomeStatement,
  type BsInput,
  type StatementLine,
} from "@/lib/reports/statements";
import { buildTrialBalance, type TrialBalance } from "@/lib/reports/trial-balance";
// Statements take a ReportScope, not a ReportFilter: payroll vouchers always count here, whoever asks
// (only the ledgers hide them from users without payroll:manage).
import type { ReportScope } from "@/lib/reports/types";
import { listAccounts } from "@/server/accounts/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { accountTotals, profitBetween } from "./totals";

/** 합계잔액시산표 as of `f.to` (f.from is ignored). */
export async function getTrialBalance(
  db: Db,
  f: ReportScope,
): Promise<TrialBalance & { asOf: string; fiscalStart: string }> {
  const asOf = f.to;
  const company = await getCompany(db);
  const fiscalStart = fiscalYearStart(asOf, company.fiscalYearStartMonth);
  const scope = { siteId: f.siteId, departmentId: f.departmentId };
  const [accounts, bsAll, plAll, priorProfit] = await Promise.all([
    listAccounts(db),
    accountTotals(db, { from: null, to: asOf, ...scope }),
    accountTotals(db, { from: fiscalStart, to: asOf, ...scope }),
    profitBetween(db, { from: null, to: addDays(fiscalStart, -1), ...scope }),
  ]);
  const groupOf = new Map(accounts.map((a) => [a.id, a.group]));
  const bsTotals = bsAll.filter((t) => {
    const g = groupOf.get(t.accountId);
    return g !== undefined && isBalanceSheetGroup(g);
  });
  const plTotals = plAll.filter((t) => {
    const g = groupOf.get(t.accountId);
    return g !== undefined && isPnlGroup(g);
  });
  return { ...buildTrialBalance({ accounts, bsTotals, plTotals, priorProfit }), asOf, fiscalStart };
}

type Scope = { siteId: number | null; departmentId: number | null };

/** 손익계산서 for [f.from, f.to], compared with the same period one year earlier. */
export async function getIncomeStatement(
  db: Db,
  f: ReportScope,
): Promise<{ lines: StatementLine[]; period: Period; priorPeriod: Period }> {
  const period = { from: f.from, to: f.to };
  const priorPeriod = priorYearPeriod(period);
  const scope: Scope = { siteId: f.siteId, departmentId: f.departmentId };
  const [accounts, current, prior] = await Promise.all([
    listAccounts(db),
    accountTotals(db, { ...period, ...scope }),
    accountTotals(db, { ...priorPeriod, ...scope }),
  ]);
  return { lines: buildIncomeStatement(accounts, current, prior), period, priorPeriod };
}

/** One balance-sheet column as of `asOf`, with its own fiscal-year start. */
async function bsColumn(db: Db, asOf: string, startMonth: number, scope: Scope): Promise<BsInput> {
  const fiscalStart = fiscalYearStart(asOf, startMonth);
  const [bsTotals, priorProfit, currentProfit] = await Promise.all([
    accountTotals(db, { from: null, to: asOf, ...scope }),
    profitBetween(db, { from: null, to: addDays(fiscalStart, -1), ...scope }),
    profitBetween(db, { from: fiscalStart, to: asOf, ...scope }),
  ]);
  return { bsTotals, priorProfit, currentProfit };
}

/** 재무상태표 as of `f.to` (f.from is ignored), compared with the end of the prior fiscal year. */
export async function getBalanceSheet(
  db: Db,
  f: ReportScope,
): Promise<{ lines: StatementLine[]; asOf: string; priorAsOf: string; fiscalStart: string }> {
  const asOf = f.to;
  const company = await getCompany(db);
  const startMonth = company.fiscalYearStartMonth;
  const fiscalStart = fiscalYearStart(asOf, startMonth);
  const priorAsOf = addDays(fiscalStart, -1);
  const scope: Scope = { siteId: f.siteId, departmentId: f.departmentId };
  const [accounts, current, prior] = await Promise.all([
    listAccounts(db),
    bsColumn(db, asOf, startMonth, scope),
    bsColumn(db, priorAsOf, startMonth, scope),
  ]);
  return { lines: buildBalanceSheet(accounts, current, prior), asOf, priorAsOf, fiscalStart };
}
