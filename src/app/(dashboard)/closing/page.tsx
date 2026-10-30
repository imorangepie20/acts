import Link from "next/link";
import { MonthCloseTable } from "@/components/closing/month-close-table";
import { fiscalYearStart, shiftYear } from "@/lib/reports/fiscal";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getOpening } from "@/server/closing/opening";
import { isMonthClosed, listMonthStatus, monthOf } from "@/server/closing/periods";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string | string[] }> }) {
  await requirePermission("period:close");
  const { fy } = await searchParams;
  const { fiscalYearStartMonth } = await getCompany(db);
  // Any date picks the fiscal year that contains it; anything else falls back to the current one.
  const base = typeof fy === "string" && isIsoDate(fy) ? fy : todayInSeoul();
  const start = fiscalYearStart(base, fiscalYearStartMonth);
  const [months, opening] = await Promise.all([listMonthStatus(db, start), getOpening(db)]);
  // Closing is sequential over months that hold vouchers, so an earlier 기초잔액 month must be closed first.
  const openingMonth = opening.date !== null && monthOf(opening.date) < monthOf(start) ? monthOf(opening.date) : null;
  const hint =
    opening.date !== null && openingMonth !== null && !(await isMonthClosed(db, openingMonth))
      ? { date: opening.date, month: openingMonth, href: `/closing?fy=${fiscalYearStart(opening.date, fiscalYearStartMonth)}` }
      : null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">월 마감</h1>
      {hint && (
        <p className="text-sm text-muted-foreground">
          <Link href={hint.href} className="underline underline-offset-4">
            기초잔액({hint.date})이 들어 있는 월({hint.month})부터 마감해야 합니다.
          </Link>
        </p>
      )}
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
