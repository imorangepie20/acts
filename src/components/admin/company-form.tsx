"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  updateCompanyAction,
  type CompanyActionState,
} from "@/app/(dashboard)/admin/company/actions";
import { formatBusinessNumber } from "@/lib/business-number";
import type { Company } from "@/server/company/service";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function CompanyForm({ company }: { company: Company }) {
  const [state, formAction, pending] = useActionState<CompanyActionState, FormData>(
    updateCompanyAction,
    {},
  );
  useEffect(() => {
    if (state.success) toast.success("저장되었습니다.");
  }, [state]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-name">회사명</Label>
        <Input id="company-name" name="name" defaultValue={company.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-bn">사업자등록번호</Label>
        <Input
          id="company-bn"
          name="businessNumber"
          inputMode="numeric"
          placeholder="000-00-00000"
          defaultValue={company.businessNumber ? formatBusinessNumber(company.businessNumber) : ""}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-rep">대표자</Label>
        <Input id="company-rep" name="representative" defaultValue={company.representative ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-month">회계연도 시작 월</Label>
        <select
          id="company-month"
          name="fiscalYearStartMonth"
          defaultValue={String(company.fiscalYearStartMonth)}
          className={selectClass}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={String(m)}>
              {m}월
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-start gap-3">
        <Switch
          id="company-approval"
          name="approvalRequired"
          value="true"
          uncheckedValue="false"
          defaultChecked={company.approvalRequired}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="company-approval">전표 승인 사용</Label>
          <p className="text-sm text-muted-foreground">
            켜면 승인된 전표만 장부와 대시보드에 반영됩니다.
          </p>
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        저장
      </Button>
    </form>
  );
}
