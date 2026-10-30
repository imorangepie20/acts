import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { isPnlGroup, normalSideOf, type DashboardRole } from "@/lib/accounts";
import { fiscalYearStart } from "@/lib/reports/fiscal";
import { buildIncomeStatement, type StatementLine } from "@/lib/reports/statements";
import { POSTED_STATUSES } from "@/lib/vouchers/types";
import { listAccounts } from "@/server/accounts/service";
import { latestClosedMonth } from "@/server/closing/periods";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { accounts, voucherLines, vouchers } from "@/server/db/schema";
import { accountTotals, accountTotalsByMonth } from "@/server/reports/totals";
import { getBalanceSheet } from "@/server/reports/service";

export type TrendPoint = { month: string; revenue: number; operatingProfit: number; netProfit: number };

export type Dashboard = {
  asOf: string;
  /** `YYYY-MM` of `asOf`. */
  month: string;
  fiscalStart: string;
  /** Ⅴ. 영업이익 for [first day of `month`, asOf]. */
  monthOperatingProfit: number;
  cash: number;
  receivable: number;
  payable: number;
  /** Whether any account carries each role (false: show "—" and the setup hint). */
  roles: Record<DashboardRole, boolean>;
  trend: TrendPoint[];
  position: { assets: number; liabilities: number; equity: number };
  closing: { count: number; profitEffect: number };
  lastClosedMonth: string | null;
};

const amountOf = (lines: StatementLine[], key: string): number => {
  const l = lines.find((x) => (x.kind === "computed" || x.kind === "section") && x.key === key);
  return l && l.kind !== "account" ? l.amount : 0;
};

/** Every `YYYY-MM` from the month of `from` through `to`'s month. */
function monthsBetween(from: string, to: string): string[] {
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export async function getDashboard(
  db: Db,
  f: { asOf: string; siteId: number | null; departmentId: number | null },
): Promise<Dashboard> {
  const { asOf } = f;
  const scope = { siteId: f.siteId, departmentId: f.departmentId };
  const company = await getCompany(db);
  const fiscalStart = fiscalYearStart(asOf, company.fiscalYearStartMonth);
  const month = asOf.slice(0, 7);

  const [accts, balances, byMonth, balanceSheet, closingRows, lastClosedMonth] = await Promise.all([
    listAccounts(db),
    accountTotals(db, { from: null, to: asOf, ...scope }),
    accountTotalsByMonth(db, { from: fiscalStart, to: asOf, ...scope }),
    getBalanceSheet(db, { from: fiscalStart, to: asOf, ...scope }),
    closingVouchers(db, fiscalStart, asOf, scope),
    latestClosedMonth(db),
  ]);

  const byId = new Map(accts.map((a) => [a.id, a]));
  const roleSum = (role: DashboardRole): number =>
    balances.reduce((s, t) => {
      const a = byId.get(t.accountId);
      if (!a || a.dashboardRole !== role) return s;
      return s + (normalSideOf(a.group) === "debit" ? t.debit - t.credit : t.credit - t.debit);
    }, 0);
  const hasRole = (role: DashboardRole) => accts.some((a) => a.dashboardRole === role);

  const trend: TrendPoint[] = monthsBetween(fiscalStart, asOf).map((m) => {
    const lines = buildIncomeStatement(accts, byMonth.get(m) ?? [], []);
    return {
      month: m,
      revenue: amountOf(lines, "revenue"),
      operatingProfit: amountOf(lines, "operating"),
      netProfit: amountOf(lines, "net"),
    };
  });

  const bs = balanceSheet.lines;
  const closing = {
    count: closingRows.length,
    profitEffect: closingRows.reduce((s, r) => s + r.profitEffect, 0),
  };

  return {
    asOf,
    month,
    fiscalStart,
    // The trend already covers [first of month, asOf] for the last month.
    monthOperatingProfit: trend.at(-1)?.operatingProfit ?? 0,
    cash: roleSum("cash"),
    receivable: roleSum("receivable"),
    payable: roleSum("payable"),
    roles: { cash: hasRole("cash"), receivable: hasRole("receivable"), payable: hasRole("payable") },
    trend,
    position: {
      assets: amountOf(bs, "total_assets"),
      liabilities: amountOf(bs, "total_liabilities"),
      equity: amountOf(bs, "total_equity"),
    },
    closing,
    lastClosedMonth,
  };
}

/** Posted 결산 vouchers in [from, to] (that have a line in scope) with Σ(credit − debit) on their in-scope P&L lines. */
async function closingVouchers(
  db: Db,
  from: string,
  to: string,
  scope: { siteId: number | null; departmentId: number | null },
): Promise<{ id: string; profitEffect: number }[]> {
  const rows = await db
    .select({
      voucherId: voucherLines.voucherId,
      group: accounts.group,
      side: voucherLines.side,
      amount: voucherLines.amount,
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
    .where(
      and(
        eq(vouchers.kind, "closing"),
        inArray(vouchers.status, [...POSTED_STATUSES]),
        gte(vouchers.date, from),
        lte(vouchers.date, to),
        scope.siteId === null ? undefined : eq(voucherLines.siteId, scope.siteId),
        scope.departmentId === null ? undefined : eq(voucherLines.departmentId, scope.departmentId),
      ),
    );
  const out = new Map<string, number>();
  for (const r of rows) {
    const delta = isPnlGroup(r.group) ? (r.side === "credit" ? Number(r.amount) : -Number(r.amount)) : 0;
    out.set(r.voucherId, (out.get(r.voucherId) ?? 0) + delta);
  }
  return [...out].map(([id, profitEffect]) => ({ id, profitEffect }));
}
