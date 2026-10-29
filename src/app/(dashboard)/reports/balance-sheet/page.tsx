import { BalanceSheetTable } from "@/components/reports/balance-sheet-table";
import { formatWon } from "@/lib/money";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getBalanceSheet } from "@/server/reports/service";
import { getEntryOptions } from "@/server/sites/service";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth);
  const [bs, options] = await Promise.all([getBalanceSheet(db, filter), getEntryOptions(db)]);
  const total = (key: string) => bs.lines.find((l) => l.kind === "computed" && l.key === key)?.amount ?? 0;
  const diff = total("total_assets") - total("total_liabilities_equity");
  const filtered = filter.siteId !== null || filter.departmentId !== null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">재무상태표</h1>
      <ReportFilters filter={filter} mode="asOf" {...options} />
      {diff !== 0 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {filtered ? "사업장·부서 필터가 적용되어 " : ""}자산총계와 부채와자본총계가 다릅니다. (차액 {formatWon(Math.abs(diff))})
        </p>
      )}
      <BalanceSheetTable
        lines={bs.lines}
        asOf={bs.asOf}
        priorAsOf={bs.priorAsOf}
        fiscalStart={bs.fiscalStart}
        scope={{ siteId: filter.siteId, departmentId: filter.departmentId }}
      />
    </div>
  );
}
