import { VoucherList, type VoucherFilters } from "@/components/vouchers/voucher-list";
import { can } from "@/lib/permissions";
import { isIsoDate, monthRange, todayInSeoul } from "@/lib/vouchers/dates";
import { VOUCHER_STATUS_LABELS, type VoucherStatus } from "@/lib/vouchers/types";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listVouchers, PAGE_SIZE } from "@/server/vouchers/service";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const isStatus = (v: string | undefined): v is VoucherStatus => v !== undefined && Object.hasOwn(VOUCHER_STATUS_LABELS, v);

/** Validates the query string; anything malformed falls back to the default. */
function parseFilters(sp: SearchParams): VoucherFilters & { page: number } {
  const month = monthRange(todayInSeoul());
  const from = one(sp.from);
  const to = one(sp.to);
  const status = one(sp.status);
  const page = Number(one(sp.page));
  return {
    from: isIsoDate(from) ? from : month.from,
    to: isIsoDate(to) ? to : month.to,
    status: isStatus(status) ? status : null,
    q: (one(sp.q) ?? "").trim().slice(0, 100),
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("ledger:view");
  const filters = parseFilters(await searchParams);
  const { rows, total } = await listVouchers(db, {
    from: filters.from,
    to: filters.to,
    status: filters.status ?? undefined,
    q: filters.q,
    page: filters.page,
  });
  const { page, ...rest } = filters;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">전표 목록</h1>
      <VoucherList
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={rest}
        canCreate={can(user.role, "voucher:create")}
      />
    </div>
  );
}
