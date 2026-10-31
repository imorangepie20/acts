"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createRunAction } from "@/app/(dashboard)/payroll/runs/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** 새 대장: 정기 or 상여, 귀속월, 지급일 and, for 상여, an optional 지급대상기간. */
export function NewRunDialog({ defaultMonth, defaultPayDate }: { defaultMonth: string; defaultPayDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"regular" | "bonus">("regular");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "").trim();
    startTransition(async () => {
      const r = await createRunAction({
        type,
        yearMonth: text("yearMonth"),
        payDate: text("payDate"),
        bonusFrom: type === "bonus" ? text("bonusFrom") || null : null,
        bonusTo: type === "bonus" ? text("bonusTo") || null : null,
      });
      if (!r.ok) return setError(r.error);
      setError(null);
      setOpen(false);
      toast.success("급여 대장을 만들었습니다.");
      router.push(`/payroll/runs/${r.value.id}`);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger render={<Button />}>새 대장</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 급여 대장</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-type">종류</Label>
            <NativeSelect
              id="run-type"
              value={type}
              onChange={(e) => setType(e.target.value as "regular" | "bonus")}
              className="w-full"
            >
              <NativeSelectOption value="regular">정기 급여</NativeSelectOption>
              <NativeSelectOption value="bonus">상여</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="run-month">귀속월</Label>
              <Input id="run-month" name="yearMonth" type="month" defaultValue={defaultMonth} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="run-pay-date">지급일</Label>
              <Input id="run-pay-date" name="payDate" type="date" defaultValue={defaultPayDate} required />
            </div>
          </div>
          {type === "bonus" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">지급대상기간 (선택)</span>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input name="bonusFrom" type="month" aria-label="지급대상기간 시작" />
                <Input name="bonusTo" type="month" aria-label="지급대상기간 끝" />
              </div>
              <p className="text-xs text-muted-foreground">
                비우면 그해 1월(같은 해 앞선 상여가 있으면 그 지급월 다음 달)부터 지급월까지로 계산합니다.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
