import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_TYPE_LABELS } from "@/lib/payroll/labels";
import { formatWon } from "@/lib/money";
import type { RunRow } from "@/server/payroll/runs";
import { RunStatusBadge } from "./run-status-badge";

export function RunsTable({ year, rows }: { year: number; rows: RunRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/payroll/runs?year=${year - 1}`} />}>
          이전 연도
        </Button>
        <span className="min-w-16 text-center font-medium tabular-nums">{year}년</span>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/payroll/runs?year=${year + 1}`} />}>
          다음 연도
        </Button>
      </div>
      <div className="rounded-md border">
        <Table aria-label={`${year}년 급여 대장`}>
          <TableHeader>
            <TableRow>
              <TableHead>귀속월</TableHead>
              <TableHead>종류</TableHead>
              <TableHead>지급일</TableHead>
              <TableHead className="text-right">인원</TableHead>
              <TableHead className="text-right">지급 총액</TableHead>
              <TableHead className="text-right">실지급액</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {year}년 급여 대장이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/payroll/runs/${r.id}`} className="font-medium tabular-nums underline-offset-4 hover:underline">
                    {r.yearMonth}
                  </Link>
                </TableCell>
                <TableCell>
                  {r.type === "bonus" ? <Badge variant="outline">{RUN_TYPE_LABELS.bonus}</Badge> : RUN_TYPE_LABELS.regular}
                </TableCell>
                <TableCell className="tabular-nums">{r.payDate}</TableCell>
                <TableCell className="text-right tabular-nums">{r.employeeCount}명</TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(r.gross)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(r.netPay)}</TableCell>
                <TableCell>
                  <RunStatusBadge status={r.status} voucherStatus={r.voucherStatus} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
