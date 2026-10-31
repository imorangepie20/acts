import Link from "next/link";
import { notFound } from "next/navigation";
import { Payslip } from "@/components/payroll/payslip";
import { PrintButton } from "@/components/payroll/print-button";
import { Button } from "@/components/ui/button";
import { runTitle } from "@/lib/payroll/labels";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { db } from "@/server/db";
import { getRun } from "@/server/payroll/runs";

/** Print view: one payslip per A4 page; `?employee=<id>` prints one employee's. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ employee?: string }>;
}) {
  await requirePermission("payroll:manage");
  const [{ id }, { employee }] = await Promise.all([params, searchParams]);
  const run = await getRun(db, id);
  if (!run) notFound();
  const company = await getCompany(db);
  const only = employee && /^\d{1,9}$/.test(employee) ? Number(employee) : null;
  const lines = only === null ? run.lines : run.lines.filter((l) => l.employeeId === only);

  return (
    <div className="flex flex-col gap-4" data-print-root>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-semibold">{runTitle(run.yearMonth, run.type)} 급여명세서</h1>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={`/payroll/runs/${run.id}`} />}>
            대장으로
          </Button>
          <PrintButton />
        </div>
      </div>
      {run.status === "draft" && (
        <p className="text-sm text-muted-foreground print:hidden">작성 중인 대장입니다. 확정 전에 금액이 바뀔 수 있습니다.</p>
      )}
      {lines.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">표시할 급여명세서가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-6 print:gap-0">
          {lines.map((l) => (
            <Payslip key={l.employeeId} companyName={company.name} run={run} line={l} />
          ))}
        </div>
      )}
    </div>
  );
}
