import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PositionSummary } from "@/components/dashboard/position-summary";
import { ProfitTrendChart } from "@/components/dashboard/profit-trend-chart";
import { ReportFilters } from "@/components/reports/report-filters";
import { formatKoreanShort } from "@/lib/money";
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

const positiveInt = (v: string | undefined): number | null =>
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
  const monthIncome = href("/reports/income-statement", { from: `${d.month}-01`, to: asOf });
  const trialBalance = href("/reports/trial-balance", { to: asOf });
  const balanceSheet = href("/reports/balance-sheet", { to: asOf });
  const monthNo = Number(d.month.slice(5));

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
          href="/vouchers?status=pending&from=2000-01-01&to=2099-12-31"
          className="w-fit rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium hover:bg-amber-500/20"
        >
          승인 대기 {pendingCount}건
        </Link>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={`${monthNo}월 누적 영업이익`} value={d.monthOperatingProfit} href={monthIncome} />
        <MetricCard title="현금·예금 잔액" value={d.roles.cash ? d.cash : null} href={trialBalance} />
        <MetricCard title="받을 돈 (미수금)" value={d.roles.receivable ? d.receivable : null} href={trialBalance} />
        <MetricCard title="줄 돈 (미지급금)" value={d.roles.payable ? d.payable : null} href={trialBalance} />
      </div>
      <ProfitTrendChart data={d.trend} />
      <PositionSummary position={d.position} href={balanceSheet} />
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
