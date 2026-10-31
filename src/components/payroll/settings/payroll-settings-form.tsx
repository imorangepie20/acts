"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AccountPicker, type AccountOption } from "@/components/vouchers/account-picker";
import { PartnerPicker, type PartnerValue } from "@/components/vouchers/partner-picker";
import {
  SETTING_CODE_FIELDS,
  SETTING_LABELS,
  SETTING_PARTNER_FIELDS,
  type PayrollSettingsInput,
  type SettingPartnerField,
} from "@/lib/payroll/settings";
import { savePayrollSettingsAction } from "@/app/(dashboard)/payroll/settings/actions";

type Props = {
  settings: PayrollSettingsInput;
  partners: { id: number; name: string }[];
  accounts: AccountOption[];
};

const CODE_HINTS: Record<(typeof SETTING_CODE_FIELDS)[number], string> = {
  pensionCompanyCode: "차변",
  insuranceCompanyCode: "차변",
  withholdingCode: "대변",
  companyPayableCode: "대변",
  netPayCode: "대변",
  executiveCode: "차변, 임원",
  staffCode: "차변, 직원",
};

export function PayrollSettingsForm({ settings, partners, accounts }: Props) {
  const [codes, setCodes] = useState(() => Object.fromEntries(SETTING_CODE_FIELDS.map((k) => [k, settings[k]])));
  const [chosen, setChosen] = useState<Record<SettingPartnerField, PartnerValue>>(
    () =>
      Object.fromEntries(
        SETTING_PARTNER_FIELDS.map((k) => {
          const id = settings[k];
          const p = id === null ? undefined : partners.find((x) => x.id === id);
          return [k, p ? { id: p.id, name: p.name } : null];
        }),
      ) as Record<SettingPartnerField, PartnerValue>,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const input = {
        ...codes,
        ...Object.fromEntries(SETTING_PARTNER_FIELDS.map((k) => [k, chosen[k]?.id ?? null])),
      };
      const r = await savePayrollSettingsAction(input);
      if (r.ok) {
        setError(null);
        toast.success("급여 설정을 저장했습니다.");
      } else setError(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>전표 계정과 기관 거래처</CardTitle>
        <CardDescription>
          급여 대장을 확정할 때 이 계정과 거래처로 급여 전표를 만듭니다. 거래처가 필요한 계정이면 기관 거래처를
          지정하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SETTING_CODE_FIELDS.map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <Label htmlFor={`ps-${k}`}>
                {SETTING_LABELS[k]} <span className="text-xs text-muted-foreground">({CODE_HINTS[k]})</span>
              </Label>
              <AccountPicker
                id={`ps-${k}`}
                label={SETTING_LABELS[k]}
                accounts={accounts}
                value={accounts.find((a) => a.code === codes[k])?.id ?? null}
                onChange={(id) => {
                  const a = accounts.find((x) => x.id === id);
                  if (a) setCodes((c) => ({ ...c, [k]: a.code }));
                }}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SETTING_PARTNER_FIELDS.map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <Label htmlFor={`ps-${k}`}>{SETTING_LABELS[k]} 거래처</Label>
              <PartnerPicker
                id={`ps-${k}`}
                label={`${SETTING_LABELS[k]} 거래처`}
                value={chosen[k]}
                onChange={(p) => setChosen((c) => ({ ...c, [k]: p }))}
              />
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={pending}>
            설정 저장
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
