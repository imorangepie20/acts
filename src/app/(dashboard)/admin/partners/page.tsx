import { PartnersTable } from "@/components/admin/partners/partners-table";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listPartners } from "@/server/partners/service";

export default async function Page() {
  await requirePermission("settings:manage");
  const rows = await listPartners(db);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">거래처</h1>
      <PartnersTable rows={rows} />
    </div>
  );
}
