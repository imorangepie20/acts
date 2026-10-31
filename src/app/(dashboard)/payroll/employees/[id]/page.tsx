import { notFound } from "next/navigation";
import { KeyMissingAlert } from "@/components/payroll/key-missing";
import { EmployeeForm } from "@/components/payroll/employees/employee-form";
import { SecretReveal } from "@/components/payroll/employees/secret-reveal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { encryptionKeyMessage } from "@/server/auth/mfa";
import { requirePermission } from "@/server/auth/dal";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { getEmployee, type EmployeeDetail } from "@/server/payroll/employees";
import { getEmployeeFormOptions } from "@/server/payroll/options";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll:manage");
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  let employee: EmployeeDetail | null;
  try {
    employee = await getEmployee(db, Number(raw));
  } catch (e) {
    if (!(e instanceof MissingEncryptionKeyError)) throw e;
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">사원 상세</h1>
        <KeyMissingAlert message={encryptionKeyMessage(e)} />
      </div>
    );
  }
  if (!employee) notFound();
  const options = await getEmployeeFormOptions(db, employee);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {employee.name} <span className="text-base font-normal text-muted-foreground">{employee.employeeNo}</span>
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>민감 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SecretReveal employeeId={employee.id} field="rrn" label="주민등록번호" masked={employee.rrnMasked} />
          <SecretReveal
            employeeId={employee.id}
            field="account"
            label={employee.bank ? `계좌번호 (${employee.bank})` : "계좌번호"}
            masked={employee.accountMasked}
          />
          <p className="text-xs text-muted-foreground sm:col-span-2">보기를 누를 때마다 열람 기록이 남습니다.</p>
        </CardContent>
      </Card>
      <EmployeeForm employee={employee} {...options} />
    </div>
  );
}
