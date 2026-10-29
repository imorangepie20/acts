import { AccountLedgerTable } from "@/components/reports/account-ledger-table";
import { AccountSelect } from "@/components/reports/account-select";
import { ReportFilters } from "@/components/reports/report-filters";
import { first, parseReportParams, type SearchParams } from "@/lib/reports/params";
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
    accountId === null ? null : getAccountLedger(db, accountId, filter),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">계정별 원장</h1>
      <div className="flex flex-wrap items-end gap-3">
        <AccountSelect accounts={accounts} value={ledger ? ledger.account.id : null} />
        <ReportFilters
          filter={filter}
          mode="period"
          {...options}
          extraParams={{ account: ledger ? String(ledger.account.id) : undefined }}
        />
      </div>
      {ledger ? (
        <AccountLedgerTable rows={ledger.rows} />
      ) : (
        <p className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">계정과목을 선택하세요.</p>
      )}
    </div>
  );
}
