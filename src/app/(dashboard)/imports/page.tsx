import { ImportScreen } from "@/components/imports/import-screen";
import { listAccounts } from "@/server/accounts/service";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getEntryOptions } from "@/server/sites/service";

export default async function Page() {
  await requirePermission("voucher:create");
  const [accounts, options] = await Promise.all([listAccounts(db, { activeOnly: true }), getEntryOptions(db)]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">자료 불러오기</h1>
      <ImportScreen
        accounts={accounts.map(({ id, code, name, group }) => ({ id, code, name, group }))}
        options={options}
      />
    </div>
  );
}
