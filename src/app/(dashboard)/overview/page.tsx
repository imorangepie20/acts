import Link from "next/link";
import { CostCard, PartnersCard, ScheduleCard, VatEstimateCard } from "@/components/dashboard/analysis-cards";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { Delta, KpiCard } from "@/components/dashboard/kpi-card";
import { PositionSummary } from "@/components/dashboard/position-summary";
import { ProfitTrendChart } from "@/components/dashboard/profit-trend-chart";
import { ReportFilters } from "@/components/reports/report-filters";
import { formatKoreanShort } from "@/lib/money";
import { monthEnd } from "@/lib/dashboard/dates";
import type { ScheduleItem } from "@/lib/dashboard/schedule";
import { can } from "@/lib/permissions";
import { addDays } from "@/lib/reports/fiscal";
import { first, type SearchParams } from "@/lib/reports/params";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { getDashboard } from "@/server/dashboard/service";
import { db } from "@/server/db";
import { getReportFilterOptions } from "@/server/sites/service";
import { countPending } from "@/server/vouchers/service";
import { PENDING_HREF } from "@/lib/vouchers/links";

const positiveInt =(v: string | undefined): number | null =>
  v !== undefined && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("overview:view");
  const sp = await searchParams;
  const to = first(sp.to);
  // 어제 by default: the CEO reads yesterday's close in the morning.
  const asOf = isIsoDate(to) ? to : addDays(todayInSeoul(), -1);
  const siteId = positiveInt(first(sp.site));
  const departmentId = positiveInt(first(sp.dept));

  const [d, options, company] = await Promise.all([
    getDashboard(db, { asOf, siteId, departmentId }),
    getReportFilterOptions(db),
    getCompany(db),
  ]);
  const pendingCount = can(user.role, "voucher:approve") && company.approvalRequired ? await countPending(db) : 0;

  const scope = new URLSearchParams();
  if (siteId !== null) scope.set("site", String(siteId));
  if (departmentId !== null) scope.set("dept", String(departmentId));
  const href = (path: string, params: Record<string, string>) => {
    const q = new URLSearchParams({ ...params, ...Object.fromEntries(scope) });
    return `${path}?${q.toString()}`;
  };
  const ytdIncome = href("/reports/income-statement", { from: d.fiscalStart, to: asOf });
  const lastMonthIncome = href("/reports/income-statement", {
    from: `${d.kpi.lastMonth.month}-01`,
    to: monthEnd(d.kpi.lastMonth.month),
  });
  const trialBalance = href("/reports/trial-balance", { to: asOf });
  const balanceSheet = href("/reports/balance-sheet", { to: asOf });
  const accountLedger = (accountId: number) =>
    href("/ledgers/accounts", { account: String(accountId), from: d.fiscalStart, to: asOf });
  const partnerLedger = (partnerId: number | null) =>
    partnerId === null ? trialBalance : href("/ledgers/partners", { partner: String(partnerId), from: d.fiscalStart, to: asOf });
  const scheduleHref = (i: ScheduleItem) => {
    if (i.partnerId !== undefined) return partnerLedger(i.partnerId);
    const id = d.accountIds[i.accountCode];
    return id === undefined ? trialBalance : accountLedger(id);
  };
  const vatHref = `/exports/vat-return?${new URLSearchParams({
    year: String(d.vat.period.year),
    term: String(d.vat.period.term),
    kind: d.vat.period.kind,
  }).toString()}`;
  const lastMonthNo = Number(d.kpi.lastMonth.month.slice(5));
  const noPrior = "전년 자료 없음";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold">대시보드</h1>
        <p className="text-sm text-muted-foreground">{asOf} 마감 기준</p>
        {d.lastClosedMonth && <p className="text-sm text-muted-foreground">마감 완료: {d.lastClosedMonth}</p>}
      </div>
      <ReportFilters
        filter={{ from: d.fiscalStart, to: asOf, siteId, departmentId }}
        mode="asOf"
        {...options}
      />
      {pendingCount > 0 && (
        <Link
          href={PENDING_HREF}
          className="w-fit rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium hover:bg-amber-500/20"
        >
          승인 대기 {pendingCount}건
        </Link>
      )}
      <section aria-label="핵심 지표" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard title="누적 매출액" value={d.kpi.revenue.current} href={ytdIncome}>
          <Delta c={d.kpi.revenue} label="전년 동기 대비" missing={noPrior} />
        </KpiCard>
        <KpiCard title="누적 영업이익" value={d.kpi.operatingProfit.current} href={ytdIncome}>
          <p className="text-xs text-muted-foreground">
            영업이익률 {d.kpi.margin === null ? "-" : `${d.kpi.margin.toLocaleString("ko-KR")}%`}
          </p>
          <Delta c={d.kpi.operatingProfit} label="전년 동기 대비" missing={noPrior} />
        </KpiCard>
        <KpiCard title={`${lastMonthNo}월 매출액 (최근 완료월)`} value={d.kpi.lastMonth.revenue.current} href={lastMonthIncome}>
          <p className="text-xs text-muted-foreground">
            영업이익 {formatKoreanShort(d.kpi.lastMonth.operatingProfit.current)}
          </p>
          <Delta c={d.kpi.lastMonth.revenue} label="매출 전월 대비" missing="전월 자료 없음" />
        </KpiCard>
        <KpiCard title="현금·예금 잔액" value={d.roles.cash ? d.cash : null} href={trialBalance}>
          <Delta c={d.kpi.cash} label={`${d.kpi.cash.prevMonthEnd} 대비`} missing="전월말 잔액 없음" />
        </KpiCard>
        <KpiCard title="받을 돈 (미수금)" value={d.roles.receivable ? d.receivable : null} href={trialBalance} />
        <KpiCard title="줄 돈 (미지급금)" value={d.roles.payable ? d.payable : null} href={trialBalance} />
      </section>
      <ProfitTrendChart data={d.trend} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CashFlowChart data={d.cashFlow} runway={d.runway} cash={d.cash} />
        <ScheduleCard items={d.schedule} asOf={asOf} ledgerHref={scheduleHref} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <VatEstimateCard period={d.vat.period} estimate={d.vat.estimate} asOf={asOf} href={vatHref} />
        <PartnersCard
          receivables={d.partners.receivables.map((p) => ({ name: p.name, amount: p.amount, href: partnerLedger(p.partnerId) }))}
          payables={d.partners.payables.map((p) => ({ name: p.name, amount: p.amount, href: partnerLedger(p.partnerId) }))}
          aging={d.aging.buckets}
          agingHref={d.aging.accountId === null ? null : accountLedger(d.aging.accountId)}
        />
        <CostCard costs={d.costs} rowHref={accountLedger} hasPrior={d.prior.hasData} />
      </div>      <PositionSummary position={d.position} href={balanceSheet} />
      {d.closing.count > 0 && (
        <Link
          href={href("/vouchers", { kind: "closing", from: d.fiscalStart, to: asOf })}
          className="w-fit rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          결산 반영 {d.closing.count}건 (손익 영향 {formatKoreanShort(d.closing.profitEffect)})
        </Link>
      )}
    </div>
  );
}
