"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReturnSelection } from "@/server/withholding/return-view";

/** GET form: the URL carries the period, so the page, print and Excel all share it. */
export function PeriodPicker({ selection }: { selection: ReturnSelection }) {
  const [mode, setMode] = useState(selection.mode);
  const monthly = selection.mode === "monthly" ? selection : null;
  const semi = selection.mode === "semiannual" ? selection : null;
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-mode">신고 구분</Label>
        <NativeSelect id="wh-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="monthly">매월</option>
          <option value="semiannual">반기</option>
        </NativeSelect>
      </div>
      {mode === "monthly" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-pay">지급연월</Label>
            <Input id="wh-pay" name="pay" type="month" required defaultValue={monthly?.pay ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-attr">귀속연월 (비우면 그 달 지급분 전부)</Label>
            <Input id="wh-attr" name="attr" type="month" defaultValue={monthly?.attr ?? ""} />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-year">연도</Label>
            <Input
              id="wh-year"
              name="year"
              type="number"
              min={2000}
              max={2100}
              required
              className="w-28"
              defaultValue={semi?.year ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wh-half">반기</Label>
            <NativeSelect id="wh-half" name="half" defaultValue={String(semi?.half ?? 1)}>
              <option value="1">상반기 (1~6월 지급분)</option>
              <option value="2">하반기 (7~12월 지급분)</option>
            </NativeSelect>
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-refund">⑫ 전월 미환급세액 (원)</Label>
        <Input id="wh-refund" name="refund" type="number" min={0} step={1} className="w-40" defaultValue={selection.refund} />
      </div>
      <Button type="submit">조회</Button>
    </form>
  );
}
