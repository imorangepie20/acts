import Link from "next/link";
import { AccountLedgerTable } from "@/components/reports/account-ledger-table";
import { AccountSelect } from "@/components/reports/account-select";
import { PartnerSummaryTable } from "@/components/reports/partner-summary-table";
import { ReportFilters } from "@/components/reports/report-filters";
import { first, parseReportParams, type SearchParams } from "@/lib/reports/params";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { listPartnersByIds } from "@/server/partners/service";
import { getAccountLedger, getPartnerSummary } from "@/server/reports/ledgers";
import { getEntryOptions } from "@/server/sites/service";

const toId = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("ledger:view");
  const sp = await searchParams;
  const company = await getCompany(db);
  const filter = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth);
  const [allAccounts, options] = await Promise.all([listAccounts(db), getEntryOptions(db)]);
  const accounts = allAccounts.filter((a) => a.requiresPartner);
  const requested = toId(first(sp.account));
  const account = accounts.find((a) => a.id === requested) ?? accounts[0] ?? null;
  const partnerId = toId(first(sp.partner));

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      from: filter.from,
      to: filter.to,
      ...(filter.siteId === null ? {} : { site: String(filter.siteId) }),
      ...(filter.departmentId === null ? {} : { dept: String(filter.departmentId) }),
      ...extra,
    }).toString();

  const detail =
    account && partnerId !== null ? await getAccountLedger(db, account.id, filter, { partnerId }) : null;
  const summary = account && !detail ? await getPartnerSummary(db, account.id, filter) : null;
  const partnerName = detail && partnerId !== null ? ((await listPartnersByIds(db, [partnerId]))[0]?.name ?? "") : "";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">거래처별 원장</h1>
      <div className="flex flex-wrap items-end gap-3">
        <AccountSelect accounts={accounts} value={account?.id ?? null} />
        <ReportFilters
          filter={filter}
          mode="period"
          {...options}
          extraParams={{ account: account ? String(account.id) : undefined, partner: detail ? String(partnerId) : undefined }}
        />
      </div>
      {!account ? (
        <p className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          거래처 필수 계정과목이 없습니다.
        </p>
      ) : detail ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Link href={`?${qs({ account: String(account.id) })}`} className="text-sm text-muted-foreground hover:underline">
              전체 거래처
            </Link>
            <h2 className="text-lg font-medium">{partnerName}</h2>
          </div>
          <AccountLedgerTable rows={detail.rows} />
        </div>
      ) : (
        <PartnerSummaryTable rows={summary ?? []} href={(id) => `?${qs({ account: String(account.id), partner: String(id) })}`} />
      )}
    </div>
  );
}
