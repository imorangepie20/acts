import { SitesAdmin } from "@/components/admin/sites/sites-admin";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listDepartments, listSites } from "@/server/sites/service";

export default async function Page() {
  await requirePermission("settings:manage");
  const [sites, departments] = await Promise.all([listSites(db), listDepartments(db)]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">사업장·부서</h1>
      <SitesAdmin sites={sites} departments={departments} />
    </div>
  );
}
