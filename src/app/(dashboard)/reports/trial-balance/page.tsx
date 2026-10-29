import { ReportFilters } from "@/components/reports/report-filters";
import { TrialBalanceTable } from "@/components/reports/trial-balance-table";
import { formatWon } from "@/lib/money";
import { exportHref, parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getTrialBalance } from "@/server/reports/service";
import { getReportFilterOptions } from "@/server/sites/service";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth);
  const [tb, options] = await Promise.all([getTrialBalance(db, filter), getReportFilterOptions(db)]);
  const filtered = filter.siteId !== null || filter.departmentId !== null;
  const diff = formatWon(Math.abs(tb.total.debitTotal - tb.total.creditTotal));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">합계잔액시산표</h1>
      <ReportFilters filter={filter} mode="asOf" {...options} exportHref={exportHref("trial-balance", filter)} />
      {!tb.balanced && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {filtered ? "사업장·부서 필터가 적용되어 " : ""}차변과 대변 합계가 다릅니다. (차액 {diff})
        </p>
      )}
      <TrialBalanceTable
        trialBalance={tb}
        asOf={tb.asOf}
        fiscalStart={tb.fiscalStart}
        siteId={filter.siteId}
        departmentId={filter.departmentId}
      />
    </div>
  );
}
