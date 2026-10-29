import { AccountsTable } from "@/components/admin/accounts/accounts-table";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listAccounts } from "@/server/accounts/service";

export default async function Page() {
  await requirePermission("settings:manage");
  const rows = await listAccounts(db);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">계정과목</h1>
      <AccountsTable rows={rows} />
    </div>
  );
}
