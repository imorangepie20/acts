import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { isPnlGroup, normalSideOf, type DashboardRole } from "@/lib/accounts";
import { receivableAging, type AgingBucket } from "@/lib/dashboard/aging";
import { cashFlows, runway, type CashMonth, type Runway } from "@/lib/dashboard/cash";
import { costComposition, type CostComposition } from "@/lib/dashboard/costs";
import { addMonths, lastCompletedMonth, monthEnd, monthsBetween } from "@/lib/dashboard/dates";
import { compare, marginPct, type Comparison } from "@/lib/dashboard/kpi";
import { buildSchedule, type ScheduleItem } from "@/lib/dashboard/schedule";
import { currentVatPeriod, vatEstimate, type CurrentVatPeriod, type VatEstimate } from "@/lib/dashboard/vat";
import { fiscalYearStart, shiftYear } from "@/lib/reports/fiscal";
import { buildIncomeStatement, type StatementLine } from "@/lib/reports/statements";
import type { AccountTotal } from "@/lib/reports/types";
import { POSTED_STATUSES } from "@/lib/vouchers/types";
import { listAccounts } from "@/server/accounts/service";
import { latestClosedMonth } from "@/server/closing/periods";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { accounts, voucherLines, vouchers } from "@/server/db/schema";
import { accountTotals, accountTotalsByMonth } from "@/server/reports/totals";
import { getBalanceSheet } from "@/server/reports/service";
import { loadVatEntries } from "@/server/vat/entries";
import { partnerBalances, payrollMonths, receivableLines } from "./queries";

export type TrendPoint = {
  month: string;
  revenue: number;
  operatingProfit: number;
  netProfit: number;
  /** 매출액 of the same month a year earlier; null when the prior year has no posted P&L at all. */
  priorRevenue: number | null;
};

export type PartnerRow = { partnerId: number | null; name: string; amount: number };

export type Dashboard = {
  asOf: string;
  /** `YYYY-MM` of `asOf`. */
  month: string;
  fiscalStart: string;
  /** Same span a year earlier: [prior fiscal start, asOf − 1 year]. */
  prior: { from: string; to: string; hasData: boolean };
  kpi: {
    revenue: Comparison;
    operatingProfit: Comparison;
    /** 영업이익률 of the YTD figures, percent. */
    margin: number | null;
    /** Latest whole month ≤ asOf, compared with the month before it. */
    lastMonth: { month: string; revenue: Comparison; operatingProfit: Comparison };
    /** Cash now vs the end of the previous month. */
    cash: Comparison & { prevMonthEnd: string };
  };
  cash: number;
  receivable: number;
  payable: number;
  /** Whether any account carries each role (false: show "—" and the setup hint). */
  roles: Record<DashboardRole, boolean>;
  trend: TrendPoint[];
  cashFlow: CashMonth[];
  runway: Runway;
  schedule: ScheduleItem[];
  vat: { period: CurrentVatPeriod; estimate: VatEstimate };
  partners: { receivables: PartnerRow[]; payables: PartnerRow[]; receivableAccountIds: number[]; payableAccountIds: number[] };
  aging: { accountId: number | null; buckets: Record<AgingBucket, number> };
  costs: CostComposition;
  /** Account id by code for the links (missing codes are absent). */
  accountIds: Record<string, number>;
  position: { assets: number; liabilities: number; equity: number };
  closing: { count: number; profitEffect: number };
  lastClosedMonth: string | null;
};

const amountOf = (lines: StatementLine[], key: string): number => {
  const l = lines.find((x) => (x.kind === "computed" || x.kind === "section") && x.key === key);
  return l && l.kind !== "account" ? l.amount : 0;
};

const RECEIVABLE_CODES = ["108", "110", "120"];
const PAYABLE_CODES = ["251", "252", "253"];
const SCHEDULE_CODES = ["253", "254", "261", "262", "264", "265"];
const TOP_PARTNERS = 5;

export async function getDashboard(
  db: Db,
  f: { asOf: string; siteId: number | null; departmentId: number | null },
): Promise<Dashboard> {
  const { asOf } = f;
  const scope = { siteId: f.siteId, departmentId: f.departmentId };
  const company = await getCompany(db);
  const fiscalStart = fiscalYearStart(asOf, company.fiscalYearStartMonth);
  const priorFrom = shiftYear(fiscalStart, -1);
  const priorTo = shiftYear(asOf, -1);
  const month = asOf.slice(0, 7);
  const lastMonth = lastCompletedMonth(asOf);
  const vatPeriod = currentVatPeriod(asOf, company.businessType);
  const accts = await listAccounts(db);
  const byId = new Map(accts.map((a) => [a.id, a]));
  const activeId = (code: string) => accts.find((a) => a.code === code && a.isActive)?.id;
  const accountIds = Object.fromEntries(accts.filter((a) => a.isActive).map((a) => [a.code, a.id])) as Record<string, number>;
  const receivableIds = accts
    .filter((a) => a.isActive && (a.dashboardRole === "receivable" || RECEIVABLE_CODES.includes(a.code)))
    .map((a) => a.id);
  const payableIds = PAYABLE_CODES.map(activeId).filter((v): v is number => v !== undefined);

  const [balances, byMonth, priorYtd, balanceSheet, closingRows, lastClosedMonth, pb, arLines, payroll, vatEntries] =
    await Promise.all([
      accountTotals(db, { from: null, to: asOf, ...scope }),
      // One query covers this year's trend, last year's same months and the months before the last whole month.
      accountTotalsByMonth(db, { from: priorFrom, to: asOf, ...scope }),
      accountTotals(db, { from: priorFrom, to: priorTo, ...scope }),
      getBalanceSheet(db, { from: fiscalStart, to: asOf, ...scope }),
      closingVouchers(db, fiscalStart, asOf, scope),
      latestClosedMonth(db),
      partnerBalances(db, [...new Set([...receivableIds, ...payableIds])], asOf, scope),
      receivableLines(db, activeId("108") ?? null, asOf, scope),
      payrollMonths(db, `${addMonths(month, -1)}-01`, asOf),
      loadVatEntries(db, vatPeriod.from, asOf),
    ]);

  const normal = (accountId: number, t: { debit: number; credit: number }) => {
    const a = byId.get(accountId);
    if (!a) return 0;
    return normalSideOf(a.group) === "debit" ? t.debit - t.credit : t.credit - t.debit;
  };
  const roleSum = (role: DashboardRole, totals: AccountTotal[]): number =>
    totals.reduce((s, t) => (byId.get(t.accountId)?.dashboardRole === role ? s + normal(t.accountId, t) : s), 0);
  const hasRole = (role: DashboardRole) => accts.some((a) => a.dashboardRole === role);
  const pnlOf = (totals: AccountTotal[]) => {
    const lines = buildIncomeStatement(accts, totals, []);
    return { revenue: amountOf(lines, "revenue"), operating: amountOf(lines, "operating"), net: amountOf(lines, "net") };
  };
  const monthPnl = (m: string) => pnlOf(byMonth.get(m) ?? []);
  const hasPnl = (totals: AccountTotal[]) => totals.some((t) => { const a = byId.get(t.accountId); return a !== undefined && isPnlGroup(a.group); });

  const priorHasData = hasPnl(priorYtd);
  const months = monthsBetween(fiscalStart, asOf);
  const trend: TrendPoint[] = months.map((m) => {
    const p = monthPnl(m);
    const priorMonth = addMonths(m, -12);
    return {
      month: m,
      revenue: p.revenue,
      operatingProfit: p.operating,
      netProfit: p.net,
      priorRevenue: priorHasData ? monthPnl(priorMonth).revenue : null,
    };
  });

  const ytd = trend.reduce((s, t) => ({ revenue: s.revenue + t.revenue, operating: s.operating + t.operatingProfit }), { revenue: 0, operating: 0 });
  const priorPnl = pnlOf(priorYtd);
  const lastHasData = (m: string) => hasPnl(byMonth.get(m) ?? []);
  const lm = monthPnl(lastMonth);
  const before = addMonths(lastMonth, -1);
  const bm = lastHasData(before) ? monthPnl(before) : null;

  const cash = roleSum("cash", balances);
  const thisMonthCash = (byMonth.get(month) ?? []).filter((t) => byId.get(t.accountId)?.dashboardRole === "cash");
  const cashAtPrevMonthEnd = cash - thisMonthCash.reduce((s, t) => s + t.debit - t.credit, 0);

  const cashMoves = new Map<string, { debit: number; credit: number }>();
  for (const [m, totals] of byMonth) {
    const cashTotals = totals.filter((t) => byId.get(t.accountId)?.dashboardRole === "cash");
    cashMoves.set(m, { debit: cashTotals.reduce((s, t) => s + t.debit, 0), credit: cashTotals.reduce((s, t) => s + t.credit, 0) });
  }
  const cashFlow = cashFlows(months, cashMoves);
  const completed = cashFlows([addMonths(lastMonth, -2), addMonths(lastMonth, -1), lastMonth], cashMoves);

  // 납부·지급 일정
  const balanceByCode: Record<string, number | undefined> = {};
  for (const code of SCHEDULE_CODES) {
    const id = activeId(code);
    if (id === undefined) continue;
    const t = balances.find((b) => b.accountId === id);
    balanceByCode[code] = t ? normal(id, t) : 0;
  }
  const cardId = activeId("253");
  const cardRows = cardId === undefined ? [] : pb.filter((r) => r.accountId === cardId && r.partnerId !== null && (r.partnerName ?? "").includes("카드"));
  const schedule = buildSchedule({
    asOf,
    fiscalStartMonth: company.fiscalYearStartMonth,
    balances: balanceByCode,
    payroll,
    cards: cardRows.map((r) => ({ partnerId: r.partnerId!, name: r.partnerName ?? "", balance: r.credit - r.debit })),
  });

  // 채권·채무
  const topPartners = (ids: number[], sign: 1 | -1): PartnerRow[] => {
    const set = new Set(ids);
    const byPartner = new Map<string, PartnerRow>();
    for (const r of pb) {
      if (!set.has(r.accountId)) continue;
      const key = String(r.partnerId ?? "none");
      const row = byPartner.get(key) ?? { partnerId: r.partnerId, name: r.partnerName ?? "거래처 없음", amount: 0 };
      row.amount += sign * (r.debit - r.credit);
      byPartner.set(key, row);
    }
    return [...byPartner.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, TOP_PARTNERS);
  };

  // 비용 구성 (판관비 YTD)
  const sumBy = (totals: AccountTotal[]) => {
    const m = new Map<number, number>();
    for (const t of totals) m.set(t.accountId, (m.get(t.accountId) ?? 0) + t.debit - t.credit);
    return m;
  };
  const ytdTotals = months.flatMap((m) => byMonth.get(m) ?? []);
  const cur = sumBy(ytdTotals);
  const prior = sumBy(priorYtd);
  const costs = costComposition(
    accts
      .filter((a) => a.group === "sga")
      .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: cur.get(a.id) ?? 0, prior: prior.get(a.id) ?? null })),
    ytd.revenue,
    { hasPrior: priorHasData },
  );

  const bs = balanceSheet.lines;
  return {
    asOf,
    month,
    fiscalStart,
    prior: { from: priorFrom, to: priorTo, hasData: priorHasData },
    kpi: {
      revenue: compare(ytd.revenue, priorHasData ? priorPnl.revenue : null),
      operatingProfit: compare(ytd.operating, priorHasData ? priorPnl.operating : null),
      margin: marginPct(ytd.operating, ytd.revenue),
      lastMonth: {
        month: lastMonth,
        revenue: compare(lm.revenue, bm ? bm.revenue : null),
        operatingProfit: compare(lm.operating, bm ? bm.operating : null),
      },
      cash: { ...compare(cash, cashAtPrevMonthEnd), prevMonthEnd: monthEnd(addMonths(month, -1)) },
    },
    cash,
    receivable: roleSum("receivable", balances),
    payable: roleSum("payable", balances),
    roles: { cash: hasRole("cash"), receivable: hasRole("receivable"), payable: hasRole("payable") },
    trend,
    cashFlow,
    runway: runway(cash, completed),
    schedule,
    vat: { period: vatPeriod, estimate: vatEstimate(vatEntries) },
    partners: {
      receivables: topPartners(receivableIds, 1),
      payables: topPartners(payableIds, -1),
      receivableAccountIds: receivableIds,
      payableAccountIds: payableIds,
    },
    aging: { accountId: activeId("108") ?? null, buckets: receivableAging(arLines, asOf) },
    costs,
    accountIds,
    position: {
      assets: amountOf(bs, "total_assets"),
      liabilities: amountOf(bs, "total_liabilities"),
      equity: amountOf(bs, "total_equity"),
    },
    closing: {
      count: closingRows.length,
      profitEffect: closingRows.reduce((s, r) => s + r.profitEffect, 0),
    },
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
