import { IncomeStatementTable } from "@/components/reports/income-statement-table";
import { ReportFilters } from "@/components/reports/report-filters";
import { exportHref, parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { hidesPayroll } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getIncomeStatement } from "@/server/reports/service";
import { getReportFilterOptions } from "@/server/sites/service";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth, {
    hidePayroll: hidesPayroll(user.role),
  });
  const [is, options] = await Promise.all([getIncomeStatement(db, filter), getReportFilterOptions(db)]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">손익계산서</h1>
      <ReportFilters filter={filter} mode="period" {...options} exportHref={exportHref("income-statement", filter)} />
      <IncomeStatementTable
        lines={is.lines}
        period={is.period}
        priorPeriod={is.priorPeriod}
        scope={{ siteId: filter.siteId, departmentId: filter.departmentId }}
      />
    </div>
  );
}
