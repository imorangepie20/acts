import { AccountLedgerTable } from "@/components/reports/account-ledger-table";
import { AccountSelect } from "@/components/reports/account-select";
import { LedgerPager } from "@/components/reports/ledger-pager";
import { ReportFilters } from "@/components/reports/report-filters";
import { exportHref, first, pageParam, parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getAccountLedger } from "@/server/reports/ledgers";
import { getEntryOptions } from "@/server/sites/service";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth);
  const raw = first(sp.account);
  const accountId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const [accounts, options, ledger] = await Promise.all([
    listAccounts(db),
    getEntryOptions(db),
    accountId === null ? null : getAccountLedger(db, accountId, filter, { page: pageParam(sp) }),
  ]);
  const pageHref = (p: number) => {
    const q = new URLSearchParams({ account: String(accountId), from: filter.from, to: filter.to, page: String(p) });
    if (filter.siteId !== null) q.set("site", String(filter.siteId));
    if (filter.departmentId !== null) q.set("dept", String(filter.departmentId));
    return `/ledgers/accounts?${q.toString()}`;
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">계정별 원장</h1>
      <div className="flex flex-wrap items-end gap-3">
        <AccountSelect accounts={accounts} value={ledger ? ledger.account.id : null} />
        <ReportFilters
          filter={filter}
          mode="period"
          {...options}
          exportHref={ledger ? exportHref("account-ledger", filter, { account: String(ledger.account.id) }) : undefined}
          extraParams={{ account: ledger ? String(ledger.account.id) : undefined }}
        />
      </div>
      {ledger ? (
        <>
          <AccountLedgerTable rows={ledger.rows} />
          <LedgerPager page={ledger.page ?? 1} pages={ledger.pages} totalLines={ledger.totalLines} href={pageHref} />
        </>
      ) : (
        <p className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">계정과목을 선택하세요.</p>
      )}
    </div>
  );
}
