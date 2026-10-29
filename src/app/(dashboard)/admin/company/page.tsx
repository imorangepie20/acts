import { CompanyForm } from "@/components/admin/company-form";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";

export default async function Page() {
  await requirePermission("settings:manage");
  const company = await getCompany(db);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">회사 정보</h1>
      <CompanyForm company={company} />
    </div>
  );
}
