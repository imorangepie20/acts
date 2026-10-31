"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/vouchers/money-input";
import type { EmployeeDetail } from "@/server/payroll/employees";
import { createEmployeeAction, updateEmployeeAction } from "@/app/(dashboard)/payroll/employees/actions";

type Option = { id: number; name: string };
export type ItemOption = { code: string; name: string };

type Props = {
  /** Masked values only; the form never receives a plain 주민등록번호 or account number. */
  employee?: EmployeeDetail;
  sites: Option[];
  departments: Option[];
  items: ItemOption[];
};

/** Typed secret: hidden by default, with a show toggle for what is being typed (never a stored value). */
function SecretInput({ id, name, placeholder, required }: { id: string; name: string; placeholder?: string; required?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex gap-1">
      <Input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete="off"
        inputMode="numeric"
        placeholder={placeholder}
        required={required}
        className="font-mono"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={shown ? "입력값 숨기기" : "입력값 표시"}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}

function Won({ id, name, initial }: { id: string; name: string; initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return <MoneyInput id={id} name={name} value={v} onValueChange={setV} placeholder="0" />;
}

function Toggle({ id, name, label, initial }: { id: string; name: string; label: string; initial: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} name={name} value="true" uncheckedValue="false" defaultChecked={initial} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmployeeForm({ employee: e, sites, departments, items }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Remounts the secret inputs after a save so typed values do not linger.
  const [secretKey, setSecretKey] = useState(0);
  const editing = e !== undefined;

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    startTransition(async () => {
      const r = editing ? await updateEmployeeAction(fd) : await createEmployeeAction(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(null);
      if (editing) {
        toast.success("저장했습니다.");
        setSecretKey((k) => k + 1);
        router.refresh();
      } else {
        toast.success("사원을 등록했습니다.");
        router.push(`/payroll/employees/${r.id}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" autoComplete="off">
      {e && <input type="hidden" name="id" value={e.id} />}
      <Card>
        <CardHeader>
          <CardTitle>인적 사항</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="사번" htmlFor="emp-no">
            <Input id="emp-no" name="employeeNo" defaultValue={e?.employeeNo} required />
          </Field>
          <Field label="이름" htmlFor="emp-name">
            <Input id="emp-name" name="name" defaultValue={e?.name} required />
          </Field>
          <Field
            label="주민등록번호"
            htmlFor="emp-rrn"
            hint={editing ? `현재 ${e.rrnMasked}. 바꿀 때만 입력하세요.` : undefined}
          >
            <SecretInput
              key={`rrn-${secretKey}`}
              id="emp-rrn"
              name="rrn"
              placeholder={editing ? "바꿀 때만 입력" : "000000-0000000"}
              required={!editing}
            />
          </Field>
          <Field label="입사일" htmlFor="emp-hired">
            <Input id="emp-hired" name="hiredOn" type="date" defaultValue={e?.hiredOn} required />
          </Field>
          <Field label="퇴사일" htmlFor="emp-left">
            <Input id="emp-left" name="leftOn" type="date" defaultValue={e?.leftOn ?? ""} />
          </Field>
          <div className="flex items-end pb-1.5">
            <Toggle id="emp-exec" name="isExecutive" label="임원" initial={e?.isExecutive ?? false} />
          </div>
          <Field label="사업장" htmlFor="emp-site">
            <NativeSelect id="emp-site" name="siteId" defaultValue={String(e?.siteId ?? sites[0]?.id ?? "")} className="w-full">
              {sites.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="부서" htmlFor="emp-dept">
            <NativeSelect id="emp-dept" name="departmentId" defaultValue={String(e?.departmentId ?? "")} className="w-full">
              <NativeSelectOption value="">없음</NativeSelectOption>
              {departments.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {d.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>원천징수</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="공제대상가족 수(본인 포함)" htmlFor="emp-dependents">
            <Input id="emp-dependents" name="dependents" type="number" min={1} defaultValue={e?.dependents ?? 1} required />
          </Field>
          <Field label="8세 이상 20세 이하 자녀 수" htmlFor="emp-children">
            <Input id="emp-children" name="children" type="number" min={0} defaultValue={e?.children ?? 0} required />
          </Field>
          <Field label="간이세액 비율" htmlFor="emp-rate">
            <NativeSelect id="emp-rate" name="withholdingRate" defaultValue={String(e?.withholdingRate ?? 100)} className="w-full">
              <NativeSelectOption value="80">80%</NativeSelectOption>
              <NativeSelectOption value="100">100%</NativeSelectOption>
              <NativeSelectOption value="120">120%</NativeSelectOption>
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>급여 계좌</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="은행" htmlFor="emp-bank">
            <Input id="emp-bank" name="bank" defaultValue={e?.bank ?? ""} />
          </Field>
          <Field
            label="계좌번호"
            htmlFor="emp-account"
            hint={editing && e.accountMasked ? `현재 ${e.accountMasked}. 바꿀 때만 입력하세요.` : undefined}
          >
            <SecretInput
              key={`account-${secretKey}`}
              id="emp-account"
              name="account"
              placeholder={editing && e.accountMasked ? "바꿀 때만 입력" : "000-0000-0000"}
            />
          </Field>
          {editing && e.accountMasked && (
            <div className="flex items-end pb-1.5">
              <Toggle key={`clear-${secretKey}`} id="emp-clear-account" name="clearAccount" label="계좌번호 지우기" initial={false} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4대보험</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle id="emp-ins-pension" name="insPension" label="국민연금 가입" initial={e?.insPension ?? true} />
          <Toggle id="emp-ins-health" name="insHealth" label="건강보험 가입" initial={e?.insHealth ?? true} />
          <Toggle id="emp-ins-employment" name="insEmployment" label="고용보험 가입" initial={e?.insEmployment ?? true} />
          <Field label="국민연금 기준소득월액" htmlFor="emp-pension-base">
            <Won id="emp-pension-base" name="pensionBase" initial={e?.pensionBase ?? null} />
          </Field>
          <Field label="건강보험 보수월액" htmlFor="emp-health-base">
            <Won id="emp-health-base" name="healthBase" initial={e?.healthBase ?? null} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>기본 급여 금액</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <Field key={i.code} label={i.name} htmlFor={`emp-amount-${i.code}`}>
              <Won id={`emp-amount-${i.code}`} name={`amount.${i.code}`} initial={e?.defaultAmounts[i.code] ?? null} />
            </Field>
          ))}
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {editing ? "저장" : "등록"}
        </Button>
      </div>
    </form>
  );
}
