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

  const v = state.values;
  return (
    <form key={state.nonce} action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-name">회사명</Label>
        <Input id="company-name" name="name" defaultValue={v?.name ?? company.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-bn">사업자등록번호</Label>
        <Input
          id="company-bn"
          name="businessNumber"
          inputMode="numeric"
          placeholder="000-00-00000"
          defaultValue={
            v ? v.businessNumber : company.businessNumber ? formatBusinessNumber(company.businessNumber) : ""
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-rep">대표자</Label>
        <Input id="company-rep" name="representative" defaultValue={v ? v.representative : (company.representative ?? "")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company-month">회계연도 시작 월</Label>
        <select
          id="company-month"
          name="fiscalYearStartMonth"
          defaultValue={v?.fiscalYearStartMonth || String(company.fiscalYearStartMonth)}
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
          defaultChecked={v ? v.approvalRequired : company.approvalRequired}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="company-approval">전표 승인 사용</Label>
          <p className="text-sm text-muted-foreground">
            켜면 승인된 전표만 장부와 대시보드에 반영됩니다.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4 border-t pt-4">
        <div>
          <h3 className="text-sm font-medium">원천세 신고 정보</h3>
          <p className="text-sm text-muted-foreground">
            원천징수이행상황신고서와 간이지급명세서 파일에 쓰입니다. 파일을 내려받을 때 빈 값을 확인합니다.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-tax-office">세무서코드</Label>
          <Input
            id="company-tax-office"
            name="taxOfficeCode"
            inputMode="numeric"
            placeholder="000"
            defaultValue={v ? v.taxOfficeCode : (company.taxOfficeCode ?? "")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-business-type">사업자 유형</Label>
          <select
            id="company-business-type"
            name="businessType"
            defaultValue={v?.businessType || company.businessType}
            className={selectClass}
          >
            <option value="corporation">법인</option>
            <option value="individual">개인</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-corp-no">법인등록번호</Label>
          <Input
            id="company-corp-no"
            name="corporateNumber"
            inputMode="numeric"
            placeholder="0000000000000"
            defaultValue={v ? v.corporateNumber : (company.corporateNumber ?? "")}
          />
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="company-semiannual"
            name="withholdingSemiannual"
            value="true"
            uncheckedValue="false"
            defaultChecked={v ? v.withholdingSemiannual : company.withholdingSemiannual}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="company-semiannual">반기별 납부</Label>
            <p className="text-sm text-muted-foreground">반기별 납부 승인을 받은 사업장만 켭니다.</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-hometax-id">홈택스 ID</Label>
          <Input
            id="company-hometax-id"
            name="hometaxId"
            autoComplete="off"
            defaultValue={v ? v.hometaxId : (company.hometaxId ?? "")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-contact-dept">담당자 부서</Label>
          <Input
            id="company-contact-dept"
            name="filingContactDept"
            defaultValue={v ? v.filingContactDept : (company.filingContactDept ?? "")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-contact-name">담당자 성명</Label>
          <Input
            id="company-contact-name"
            name="filingContactName"
            defaultValue={v ? v.filingContactName : (company.filingContactName ?? "")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-contact-phone">담당자 전화번호</Label>
          <Input
            id="company-contact-phone"
            name="filingContactPhone"
            inputMode="tel"
            defaultValue={v ? v.filingContactPhone : (company.filingContactPhone ?? "")}
          />
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
