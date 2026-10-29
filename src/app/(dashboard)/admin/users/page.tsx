import { UsersTable } from "@/components/admin/users/users-table";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listUsers } from "@/server/users/service";

export default async function Page() {
  await requirePermission("settings:manage");
  const rows = await listUsers(db);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">사용자</h1>
      <UsersTable rows={rows} />
    </div>
  );
}
