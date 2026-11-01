"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { VatSelection } from "@/lib/vat/periods";

/** GET form: the URL carries the period, so the page, print and Excel all share it. Checkboxes post 1/0 through hidden inputs. */
export function VatPeriodPicker({ selection: s }: { selection: VatSelection }) {
  const [kind, setKind] = useState(s.kind);
  const [prelim, setPrelim] = useState(s.prelimFiled);
  const [efile, setEfile] = useState(s.efile);
  const final = kind === "final";
  return (
    <form method="get" className="flex flex-wrap items-end gap-x-4 gap-y-3 print:hidden">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vat-year">연도</Label>
        <Input id="vat-year" name="year" type="number" min={2000} max={2100} required className="w-28" defaultValue={s.year} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vat-term">기</Label>
        <NativeSelect id="vat-term" name="term" defaultValue={String(s.term)}>
          <option value="1">제1기 (1~6월)</option>
          <option value="2">제2기 (7~12월)</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vat-kind">구분</Label>
        <NativeSelect id="vat-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="prelim">예정</option>
          <option value="final">확정</option>
        </NativeSelect>
      </div>
      {final && (
        <div className="flex h-9 items-center gap-2">
          <Checkbox id="vat-prelim" checked={prelim} onCheckedChange={(c) => setPrelim(c === true)} />
          <Label htmlFor="vat-prelim">예정신고를 했음</Label>
          <input type="hidden" name="prelim" value={prelim ? "1" : "0"} />
        </div>
      )}
      <div className="flex h-9 items-center gap-2">
        <Checkbox id="vat-efile" checked={efile} onCheckedChange={(c) => setEfile(c === true)} />
        <Label htmlFor="vat-efile">전자신고세액공제 적용</Label>
        <input type="hidden" name="efile" value={efile ? "1" : "0"} />
      </div>
      {final && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vat-prelim-refund">(23) 예정신고 미환급세액 (원)</Label>
            <Input
              id="vat-prelim-refund"
              name="prelimRefund"
              type="number"
              min={0}
              step={1}
              className="w-44"
              defaultValue={s.prelimRefund}
              aria-invalid={s.errors.prelimRefund ? true : undefined}
            />
            {s.errors.prelimRefund && <p className="text-xs text-destructive">{s.errors.prelimRefund}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vat-notice">(24) 예정고지세액 (원)</Label>
            <Input
              id="vat-notice"
              name="notice"
              type="number"
              min={0}
              step={1}
              className="w-44"
              defaultValue={s.notice}
              aria-invalid={s.errors.notice ? true : undefined}
            />
            {s.errors.notice && <p className="text-xs text-destructive">{s.errors.notice}</p>}
          </div>
        </>
      )}
      <Button type="submit">조회</Button>
    </form>
  );
}
