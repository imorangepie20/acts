import { EmployeeForm } from "@/components/payroll/employees/employee-form";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getEmployeeFormOptions } from "@/server/payroll/options";

export default async function Page() {
  await requirePermission("payroll:manage");
  const options = await getEmployeeFormOptions(db);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">사원 등록</h1>
      <EmployeeForm {...options} />
    </div>
  );
}
