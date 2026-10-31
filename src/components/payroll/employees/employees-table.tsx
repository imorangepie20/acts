import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EmployeeRow } from "@/server/payroll/employees";

/** Masked values only: the list never carries a plain 주민등록번호. */
export function EmployeesTable({ rows, includeLeft }: { rows: EmployeeRow[]; includeLeft: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={includeLeft ? "/payroll/employees" : "/payroll/employees?all=1"} />}
        >
          {includeLeft ? "재직자만 보기" : "퇴사자 포함"}
        </Button>
        <Button nativeButton={false} render={<Link href="/payroll/employees/new" />}>
          사원 등록
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>사번</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>주민등록번호</TableHead>
              <TableHead>사업장</TableHead>
              <TableHead>부서</TableHead>
              <TableHead>입사일</TableHead>
              <TableHead>퇴사일</TableHead>
              <TableHead>구분</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  등록된 사원이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.employeeNo}</TableCell>
                <TableCell>
                  <Link href={`/payroll/employees/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm tabular-nums">{r.rrnMasked}</TableCell>
                <TableCell>{r.siteName}</TableCell>
                <TableCell>{r.departmentName ?? "-"}</TableCell>
                <TableCell className="tabular-nums">{r.hiredOn}</TableCell>
                <TableCell className="tabular-nums">{r.leftOn ?? "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {r.isExecutive && <Badge variant="outline">임원</Badge>}
                    {r.leftOn && <Badge variant="secondary">퇴사</Badge>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
