"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  cancelConfirmAction,
  confirmRunAction,
  deleteRunAction,
  previewRunVoucherAction,
  recomputeRunAction,
} from "@/app/(dashboard)/payroll/runs/actions";
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
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWon } from "@/lib/money";
import type { Result } from "@/server/result";
import type { RunStatus, VoucherPreviewRow } from "@/server/payroll/runs";

type Props = { runId: string; version: number; status: RunStatus; title: string; listHref: string };

/** A button with a confirm dialog; a refusal is shown as the service returned it. */
function ConfirmButton({
  label,
  title,
  body,
  done,
  variant = "outline",
  action,
  after,
}: {
  label: string;
  title: string;
  body: string;
  done: string;
  variant?: "outline" | "destructive" | "default";
  action: () => Promise<Result>;
  after?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const r = await action();
      setOpen(false);
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
        return;
      }
      toast.success(done);
      if (after) after();
      else router.refresh();
    });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} />}>{label}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          <AlertDialogAction variant={variant === "outline" ? "default" : variant} disabled={pending} onClick={run}>
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 확정: shows the voucher it would write (per account), then confirms. */
function ConfirmRunButton({ runId, version, title }: { runId: string; version: number; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Result<VoucherPreviewRow[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    setError(null);
    if (!o) return;
    setPreview(null);
    startTransition(async () => setPreview(await previewRunVoucherAction(runId)));
  };
  const confirm = () =>
    startTransition(async () => {
      const r = await confirmRunAction(runId, version);
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      setOpen(false);
      toast.success("확정했습니다. 급여 전표를 만들었습니다.");
      router.refresh();
    });

  const rows = preview?.ok ? preview.value : [];
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={<Button />}>확정</AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}을 확정할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            아래 급여 전표가 만들어집니다. 확정한 대장은 확정을 취소해야 고칠 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview === null && <p className="text-sm text-muted-foreground">전표를 미리 계산하는 중…</p>}
        {preview && !preview.ok && (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {preview?.ok && (
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table aria-label="전표 미리보기">
              <TableHeader>
                <TableRow>
                  <TableHead>계정</TableHead>
                  <TableHead className="text-right">차변</TableHead>
                  <TableHead className="text-right">대변</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell>{`${r.code} ${r.name}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.debit ? formatWon(r.debit) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.credit ? formatWon(r.credit) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>합계</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(debit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(credit)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          <AlertDialogAction disabled={pending || !preview?.ok} onClick={confirm}>
            확정
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RunActions({ runId, version, status, title, listHref }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const recompute = () =>
    startTransition(async () => {
      const r = await recomputeRunAction(runId, version);
      if (!r.ok) toast.error(r.error);
      else toast.success("현재 사원 정보와 요율로 다시 계산했습니다.");
      router.refresh();
    });

  if (status === "confirmed") {
    return (
      <ConfirmButton
        label="확정 취소"
        title={`${title} 확정을 취소할까요?`}
        body="급여 전표가 삭제되고 대장을 다시 고칠 수 있게 됩니다."
        done="확정을 취소했습니다."
        action={() => cancelConfirmAction(runId, version)}
      />
    );
  }
  return (
    <>
      <Button variant="outline" disabled={pending} onClick={recompute}>
        재계산
      </Button>
      <ConfirmRunButton runId={runId} version={version} title={title} />
      <ConfirmButton
        label="삭제"
        title={`${title}을 삭제할까요?`}
        body="작성 중인 대장과 입력한 금액이 모두 삭제됩니다."
        done="급여 대장을 삭제했습니다."
        variant="destructive"
        action={() => deleteRunAction(runId, version)}
        after={() => router.push(listHref)}
      />
    </>
  );
}
