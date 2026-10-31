import { PayItemsTable } from "@/components/payroll/settings/pay-items-table";
import { PayrollSettingsForm } from "@/components/payroll/settings/payroll-settings-form";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { BUILTIN_ITEM_CODES, listItems } from "@/server/payroll/items";
import { getPayrollSettings } from "@/server/payroll/settings";

export default async function Page() {
  await requirePermission("payroll:manage");
  const [items, { partners, ...settings }, accounts] = await Promise.all([
    listItems(db),
    getPayrollSettings(db),
    listAccounts(db, { activeOnly: true }),
  ]);
  const options = accounts.map(({ id, code, name, group }) => ({ id, code, name, group }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">급여 설정</h1>
      <PayItemsTable items={items.map((i) => ({ ...i, builtin: BUILTIN_ITEM_CODES.includes(i.code) }))} accounts={options} />
      <PayrollSettingsForm settings={settings} partners={partners} accounts={options} />
    </div>
  );
}
