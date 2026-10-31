import { EmployeesTable } from "@/components/payroll/employees/employees-table";
import { KeyMissingAlert } from "@/components/payroll/key-missing";
import { requirePermission } from "@/server/auth/dal";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { listEmployees, type EmployeeRow } from "@/server/payroll/employees";

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requirePermission("payroll:manage");
  const includeLeft = (await searchParams).all === "1";
  let rows: EmployeeRow[] | null = null;
  try {
    rows = await listEmployees(db, { includeLeft });
  } catch (e) {
    if (!(e instanceof MissingEncryptionKeyError)) throw e;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">사원</h1>
      {rows ? <EmployeesTable rows={rows} includeLeft={includeLeft} /> : <KeyMissingAlert />}
    </div>
  );
}
