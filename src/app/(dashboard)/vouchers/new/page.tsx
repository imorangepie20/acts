import { VoucherEntry } from "@/components/vouchers/voucher-entry";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { getVatAccountIds, listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getEntryOptions } from "@/server/sites/service";
import { listTemplates } from "@/server/templates/service";

export default async function Page() {
  await requirePermission("voucher:create");
  const [accounts, vat, options, templates] = await Promise.all([
    listAccounts(db, { activeOnly: true }),
    getVatAccountIds(db),
    getEntryOptions(db),
    listTemplates(db),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">전표 입력</h1>
      <VoucherEntry
        accounts={accounts.map(({ id, code, name, group }) => ({ id, code, name, group }))}
        vat={vat}
        options={options}
        today={todayInSeoul()}
        templates={templates}
      />
    </div>
  );
}
