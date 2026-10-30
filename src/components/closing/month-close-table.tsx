"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeMonthAction, reopenMonthAction } from "@/app/(dashboard)/closing/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/vouchers/dates";
import type { MonthStatus } from "@/server/closing/periods";

type Mode = "close" | "reopen";

const COPY: Record<Mode, { button: string; title: (m: string) => string; body: string; done: string }> = {
  close: {
    button: "마감",
    title: (m) => `${m}을 마감할까요?`,
    body: "마감한 월의 전표는 추가·수정·삭제·승인할 수 없고, 증빙도 바꿀 수 없습니다.",
    done: "마감되었습니다.",
  },
  reopen: {
    button: "마감 해제",
    title: (m) => `${m} 마감을 해제할까요?`,
    body: "해제하면 이 월의 전표를 다시 수정할 수 있습니다.",
    done: "마감을 해제했습니다.",
  },
};

function MonthAction({ month, mode }: { month: string; mode: Mode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const copy = COPY[mode];
  const run = () =>
    startTransition(async () => {
      const r = mode === "close" ? await closeMonthAction(month) : await reopenMonthAction(month);
      setOpen(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(copy.done);
      router.refresh();
    });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" variant={mode === "close" ? "default" : "outline"} />}>
        {copy.button}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title(month)}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={run}>
            {copy.button}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MonthCloseTable({
  months,
  fiscalStart,
  prevHref,
  nextHref,
}: {
  months: MonthStatus[];
  fiscalStart: string;
  prevHref: string;
  nextHref: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          회계연도 {months[0].month} ~ {months[11].month}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={prevHref} />}>
            이전 연도
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={nextHref} />}>
            다음 연도
          </Button>
        </div>
      </div>
      <div className="rounded-md border">
        <Table aria-label={`월 마감 ${fiscalStart.slice(0, 4)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>월</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">전표 수</TableHead>
              <TableHead className="text-right">승인 대기</TableHead>
              <TableHead>마감 일시·마감자</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="font-medium tabular-nums">{m.month}</TableCell>
                <TableCell>
                  {m.closed ? <Badge>마감</Badge> : <span className="text-sm text-muted-foreground">열림</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.voucherCount.toLocaleString("ko-KR")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.pendingCount > 0 ? m.pendingCount.toLocaleString("ko-KR") : "-"}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {m.closedAt ? `${formatDateTime(m.closedAt)} · ${m.closedByName ?? ""}` : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <MonthAction month={m.month} mode={m.closed ? "reopen" : "close"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
