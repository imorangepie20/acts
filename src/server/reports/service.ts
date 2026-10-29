import { isBalanceSheetGroup, isPnlGroup } from "@/lib/accounts";
import { addDays, fiscalYearStart } from "@/lib/reports/fiscal";
import { buildTrialBalance, type TrialBalance } from "@/lib/reports/trial-balance";
import type { ReportFilter } from "@/lib/reports/types";
import { listAccounts } from "@/server/accounts/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { accountTotals, profitBetween } from "./totals";

/** 합계잔액시산표 as of `f.to` (f.from is ignored). */
export async function getTrialBalance(
  db: Db,
  f: ReportFilter,
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
