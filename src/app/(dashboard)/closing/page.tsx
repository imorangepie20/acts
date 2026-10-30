import { MonthCloseTable } from "@/components/closing/month-close-table";
import { fiscalYearStart, shiftYear } from "@/lib/reports/fiscal";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { listMonthStatus } from "@/server/closing/periods";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string | string[] }> }) {
  await requirePermission("period:close");
  const { fy } = await searchParams;
  const { fiscalYearStartMonth } = await getCompany(db);
  // Any date picks the fiscal year that contains it; anything else falls back to the current one.
  const base = typeof fy === "string" && isIsoDate(fy) ? fy : todayInSeoul();
  const start = fiscalYearStart(base, fiscalYearStartMonth);
  const months = await listMonthStatus(db, start);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">월 마감</h1>
      <MonthCloseTable
        months={months}
        fiscalStart={start}
        currentMonth={todayInSeoul().slice(0, 7)}
        prevHref={`/closing?fy=${shiftYear(start, -1)}`}
        nextHref={`/closing?fy=${shiftYear(start, 1)}`}
      />
    </div>
  );
}
