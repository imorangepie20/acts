import Link from "next/link";
import { JournalTable } from "@/components/reports/journal-table";
import { ReportFilters } from "@/components/reports/report-filters";
import { Button } from "@/components/ui/button";
import { formatWon } from "@/lib/money";
import { first, parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getJournal, JOURNAL_PAGE_SIZE } from "@/server/reports/ledgers";
import { getEntryOptions } from "@/server/sites/service";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth);
  const raw = Number(first(sp.page));
  const page = Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
  const [journal, options] = await Promise.all([getJournal(db, filter, page), getEntryOptions(db)]);
  const pages = Math.max(1, Math.ceil(journal.total / JOURNAL_PAGE_SIZE));
  const href = (p: number) => {
    const q = new URLSearchParams({ from: filter.from, to: filter.to, page: String(p) });
    if (filter.siteId !== null) q.set("site", String(filter.siteId));
    if (filter.departmentId !== null) q.set("dept", String(filter.departmentId));
    return `/ledgers/journal?${q.toString()}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">분개장</h1>
      <ReportFilters filter={filter} mode="period" {...options} />
      <JournalTable entries={journal.entries} debitSum={journal.debitSum} creditSum={journal.creditSum} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>총 {formatWon(journal.total)}건</span>
        <div className="flex items-center gap-2">
          {page > 1 && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href(page - 1)} />}>
              이전
            </Button>
          )}
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          {page < pages && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href(page + 1)} />}>
              다음
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
