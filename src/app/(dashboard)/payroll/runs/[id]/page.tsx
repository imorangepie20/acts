import Link from "next/link";
import { notFound } from "next/navigation";
import { RunActions } from "@/components/payroll/runs/run-actions";
import { RunGrid, type GridLine } from "@/components/payroll/runs/run-grid";
import { RunStatusBadge } from "@/components/payroll/runs/run-status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runTitle } from "@/lib/payroll/labels";
import { formatDateTime } from "@/lib/vouchers/dates";
import { formatVoucherNo } from "@/lib/vouchers/types";
import { requirePermission } from "@/server/auth/dal";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { listEmployees, type EmployeeRow } from "@/server/payroll/employees";
import { getRun } from "@/server/payroll/runs";

const lastDayOf = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Employees employed in the 귀속월 and not in the run yet (the 사원 추가 choices). */
async function candidatesFor(yearMonth: string, inRun: Set<number>): Promise<EmployeeRow[]> {
  let all: EmployeeRow[];
  try {
    all = await listEmployees(db, { includeLeft: true });
  } catch (e) {
    if (e instanceof MissingEncryptionKeyError) return [];
    throw e;
  }
  const first = `${yearMonth}-01`;
  const last = lastDayOf(yearMonth);
  return all.filter((e) => !inRun.has(e.id) && e.hiredOn <= last && (e.leftOn === null || e.leftOn >= first));
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll:manage");
  const { id } = await params;
  const run = await getRun(db, id);
  if (!run) notFound();
  const title = runTitle(run.yearMonth, run.type);
  const draft = run.status === "draft";
  const candidates = draft ? await candidatesFor(run.yearMonth, new Set(run.lines.map((l) => l.employeeId))) : [];
  const lines: GridLine[] = run.lines.map((l) => ({
    employeeId: l.employeeId,
    employeeNo: l.snapshot.employeeNo,
    name: l.snapshot.name,
    amounts: l.amounts,
    overrides: l.overrides,
    calculated: l.snapshot.calculated,
    result: l.result,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <RunStatusBadge status={run.status} voucherStatus={run.voucherStatus} />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            지급일 {run.payDate}
            {run.type === "bonus" && run.bonusFrom && run.bonusTo && ` · 지급대상기간 ${run.bonusFrom} ~ ${run.bonusTo}`}
            {` · 작성 ${run.createdByName}`}
            {run.confirmedAt && ` · 확정 ${formatDateTime(run.confirmedAt)} ${run.confirmedByName ?? ""}`}
            {run.voucherId && run.voucherNo !== null && (
              <>
                {" · 전표 "}
                <Link href={`/vouchers/${run.voucherId}`} className="underline underline-offset-4">
                  {formatVoucherNo(run.payDate, run.voucherNo)}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={`/payroll/runs/${run.id}/payslips`} />}>
            급여명세서
          </Button>
          <Button variant="outline" nativeButton={false} render={<a href={`/api/exports/payroll-run?run=${run.id}`} />}>
            Excel
          </Button>
          <RunActions
            runId={run.id}
            version={run.version}
            status={run.status}
            title={title}
            listHref={`/payroll/runs?year=${run.yearMonth.slice(0, 4)}`}
          />
        </div>
      </div>

      {run.status === "confirmed" && run.voucherStatus === "rejected" && (
        <Alert variant="destructive">
          <AlertDescription>
            {`전표가 반려되었습니다: ${run.voucherRejectReason ?? ""}. 확정을 취소한 뒤 고쳐서 다시 확정하세요.`}
          </AlertDescription>
        </Alert>
      )}
      {draft && (
        <p className="text-sm text-muted-foreground">
          금액을 고치면 칸을 벗어날 때 저장하고 그 줄을 다시 계산합니다. 공제액은 사원을 넣었거나 마지막으로 재계산한 때의
          사원 정보(공제대상가족, 보수월액, 4대보험 가입 등)로 계산하므로, 사원 정보나 요율이 바뀌었으면 재계산을 누르세요. 공제 칸에 금액을
          직접 넣으면 점으로 표시되고, 비우거나 ×를 누르면 계산값으로 돌아갑니다.
        </p>
      )}

      <RunGrid
        runId={run.id}
        version={run.version}
        editable={draft}
        items={run.items.map((i) => ({ code: i.code, name: i.name }))}
        lines={lines}
        candidates={candidates.map((c) => ({ id: c.id, employeeNo: c.employeeNo, name: c.name }))}
      />
    </div>
  );
}
