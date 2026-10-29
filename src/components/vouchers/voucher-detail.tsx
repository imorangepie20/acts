"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatWon } from "@/lib/money";
import {
  ENTRY_TYPE_LABELS,
  EVIDENCE_TYPE_LABELS,
  VAT_TYPE_LABELS,
  formatVoucherNo,
} from "@/lib/vouchers/types";
import type { VoucherDetail as Detail } from "@/server/vouchers/service";
import { approveVoucherAction, deleteVoucherAction, rejectVoucherAction } from "@/app/(dashboard)/vouchers/actions";
import { StatusBadge } from "./shared";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function VoucherDetail({
  voucher: v,
  canModify,
  canApprove = false,
  children,
}: {
  voucher: Detail;
  canModify: boolean;
  canApprove?: boolean;
  /** History section, rendered on the server. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const total = (side: "debit" | "credit") =>
    v.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);

  const remove = () =>
    startTransition(async () => {
      const r = await deleteVoucherAction(v.id, v.version);
      if (!r.ok) {
        toast.error(r.error);
        setOpen(false);
        return;
      }
      toast.success("삭제되었습니다.");
      router.push("/vouchers");
    });

  const approve = () =>
    startTransition(async () => {
      const r = await approveVoucherAction(v.id, v.version);
      if (!r.ok) return void toast.error(r.error);
      toast.success("승인되었습니다.");
      router.refresh();
    });

  const reject = () =>
    startTransition(async () => {
      const r = await rejectVoucherAction(v.id, v.version, reason);
      if (!r.ok) return void toast.error(r.error);
      toast.success("반려되었습니다.");
      setRejectOpen(false);
      setReason("");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tabular-nums">전표 {formatVoucherNo(v.date, v.no)}</h1>
          <StatusBadge status={v.status} />
        </div>
        <div className="flex gap-2">
          {canApprove && v.status === "pending" && (
            <>
              <Button disabled={pending} onClick={approve}>
                승인
              </Button>
              <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                <DialogTrigger render={<Button variant="outline" />}>반려</DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>전표 반려</DialogTitle>
                    <DialogDescription>반려 사유는 작성자에게 표시됩니다.</DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="reject-reason">사유</Label>
                    <Textarea
                      id="reject-reason"
                      value={reason}
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="destructive" disabled={pending || !reason.trim()} onClick={reject}>
                      반려하기
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          {canModify && (
          <>
            <Button variant="outline" nativeButton={false} render={<Link href={`/vouchers/${v.id}/edit`} />}>
              수정
            </Button>
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger render={<Button variant="destructive" />}>삭제</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>전표를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {formatVoucherNo(v.date, v.no)} 전표가 삭제됩니다. 변경 이력은 남습니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" disabled={pending} onClick={remove}>
                    삭제
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
          )}
        </div>
      </div>

      {v.status === "rejected" && v.rejectReason && (
        <Alert variant="destructive">
          <AlertTitle>반려된 전표입니다</AlertTitle>
          <AlertDescription>{v.rejectReason}</AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-4 rounded-md border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label="번호">{formatVoucherNo(v.date, v.no)}</Fact>
        <Fact label="일자">{v.date}</Fact>
        <Fact label="유형">{ENTRY_TYPE_LABELS[v.entryType]}</Fact>
        <Fact label="적요">{v.description || "-"}</Fact>
        <Fact label="증빙">{EVIDENCE_TYPE_LABELS[v.evidenceType]}</Fact>
        <Fact label="과세 구분">
          {v.vatType ? VAT_TYPE_LABELS[v.vatType] : "-"}
          {v.vatDeductible === false && v.entryType === "purchase" ? " (불공제)" : ""}
        </Fact>
        <Fact label="공급가액 / 부가세">
          {v.supplyAmount !== null && v.vatAmount !== null
            ? `${formatWon(v.supplyAmount)} / ${formatWon(v.vatAmount)}`
            : "-"}
        </Fact>
        <Fact label="작성자">{v.createdBy.name}</Fact>
        <Fact label="승인자">{v.approvedBy?.name ?? "-"}</Fact>
      </dl>

      <div className="rounded-md border">
        <Table aria-label="분개">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>계정</TableHead>
              <TableHead>거래처</TableHead>
              <TableHead>적요</TableHead>
              <TableHead className="text-right">차변</TableHead>
              <TableHead className="text-right">대변</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell>
                  {l.account.code} {l.account.name}
                </TableCell>
                <TableCell>{l.partnerName ?? ""}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell className="text-right tabular-nums">{l.side === "debit" ? formatWon(l.amount) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{l.side === "credit" ? formatWon(l.amount) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>합계</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(total("debit"))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(total("credit"))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {children}
    </div>
  );
}
