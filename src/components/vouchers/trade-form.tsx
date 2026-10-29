"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AccountGroup } from "@/lib/accounts";
import {
  buildSimpleVoucher,
  defaultVat,
  splitVatFromTotal,
  type TradeInput,
} from "@/lib/vouchers/simple";
import {
  EVIDENCE_TYPE_LABELS,
  VAT_TYPE_LABELS,
  type EvidenceType,
  type VatType,
} from "@/lib/vouchers/types";
import { AccountPicker } from "./account-picker";
import { MoneyInput } from "./money-input";
import { PartnerPicker, type PartnerValue } from "./partner-picker";
import { Field, LinesPreview, SaveBar, selectClass, type FormContext } from "./shared";

type Kind = "purchase" | "sale";

const SETUP: Record<
  Kind,
  { groups: AccountGroup[]; counterLabel: string; counterFirst: string[]; evidence: EvidenceType }
> = {
  purchase: {
    groups: ["sga", "cost_of_sales", "non_operating_expense", "current_asset", "noncurrent_asset"],
    counterLabel: "결제 계정",
    counterFirst: ["101", "103", "253"],
    evidence: "card",
  },
  sale: {
    groups: ["revenue", "non_operating_income"],
    counterLabel: "입금 계정",
    counterFirst: ["101", "103", "108"],
    evidence: "tax_invoice",
  },
};
const COUNTER_GROUPS: AccountGroup[] = [
  "current_asset",
  "noncurrent_asset",
  "current_liability",
  "noncurrent_liability",
];

export type TradeInitial = { simple: TradeInput; partner: PartnerValue };

type Amounts = { total: number | null; supply: number | null; vat: number | null };

/** Splits a receipt total, or takes it all as supply when no VAT applies. */
function fromTotal(total: number | null, vatApplies: boolean): Amounts {
  if (total === null) return { total, supply: null, vat: null };
  if (!vatApplies) return { total, supply: total, vat: 0 };
  const s = splitVatFromTotal(total);
  return { total, supply: s.supplyAmount, vat: s.vatAmount };
}

export function TradeForm({ kind, ctx, initial }: { kind: Kind; ctx: FormContext; initial?: TradeInitial }) {
  const setup = SETUP[kind];
  const init = initial?.simple;
  const [mainId, setMainId] = useState<number | null>(init?.mainAccountId ?? null);
  const [counterId, setCounterId] = useState<number | null>(init?.counterAccountId ?? null);
  const [partner, setPartner] = useState<PartnerValue>(initial?.partner ?? null);
  const [evidence, setEvidence] = useState<EvidenceType>(init?.evidenceType ?? setup.evidence);
  const [vatType, setVatType] = useState<VatType>(init?.vatType ?? "taxable");
  const [deductibleOn, setDeductibleOn] = useState(init ? init.vatDeductible : true);
  const [amounts, setAmounts] = useState<Amounts>(
    init
      ? { total: init.supplyAmount + init.vatAmount, supply: init.supplyAmount, vat: init.vatAmount }
      : { total: null, supply: null, vat: null },
  );

  const p = kind;
  const noVatEvidence = kind === "purchase" && (evidence === "simple_receipt" || evidence === "none");
  const effectiveVatType: VatType = evidence === "invoice" ? "exempt" : vatType;
  const vatApplies = (ev: EvidenceType, vt: VatType) =>
    (ev === "invoice" ? "exempt" : vt) === "taxable" &&
    !(kind === "purchase" && (ev === "simple_receipt" || ev === "none"));
  const deductible = kind === "purchase" && !noVatEvidence && deductibleOn;

  const input: TradeInput = {
    type: kind,
    date: ctx.common.date,
    description: ctx.common.description,
    mainAccountId: mainId ?? 0,
    counterAccountId: counterId ?? 0,
    partnerId: partner?.id ?? null,
    siteId: ctx.common.siteId,
    departmentId: ctx.common.departmentId,
    evidenceType: evidence,
    vatType: effectiveVatType,
    vatDeductible: deductible,
    supplyAmount: amounts.supply ?? 0,
    vatAmount: amounts.vat ?? 0,
  };
  const built = buildSimpleVoucher(input, ctx.vat);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (mainId === null) return ctx.fail("계정을 선택하세요.");
        if (counterId === null) return ctx.fail(`${setup.counterLabel}을 선택하세요.`);
        ctx.submit({ mode: "simple", simple: input });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="계정" htmlFor={`${p}-main`}>
          <AccountPicker
            id={`${p}-main`}
            label="계정"
            accounts={ctx.accounts}
            groups={setup.groups}
            value={mainId}
            onChange={setMainId}
          />
        </Field>
        <Field label={setup.counterLabel} htmlFor={`${p}-counter`}>
          <AccountPicker
            id={`${p}-counter`}
            label={setup.counterLabel}
            accounts={ctx.accounts}
            groups={COUNTER_GROUPS}
            first={setup.counterFirst}
            value={counterId}
            onChange={setCounterId}
          />
        </Field>
        <Field label="거래처" htmlFor={`${p}-partner`}>
          <PartnerPicker id={`${p}-partner`} label="거래처" value={partner} onChange={setPartner} />
        </Field>
        <Field label="증빙" htmlFor={`${p}-evidence`}>
          <select
            id={`${p}-evidence`}
            className={selectClass}
            value={evidence}
            onChange={(e) => {
              const ev = e.target.value as EvidenceType;
              setEvidence(ev);
              setAmounts((a) => fromTotal(a.total, vatApplies(ev, vatType)));
            }}
          >
            {Object.entries(EVIDENCE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="과세 구분" htmlFor={`${p}-vat-type`}>
          <select
            id={`${p}-vat-type`}
            className={selectClass}
            value={effectiveVatType}
            disabled={evidence === "invoice"}
            onChange={(e) => {
              const vt = e.target.value as VatType;
              setVatType(vt);
              setAmounts((a) => fromTotal(a.total, vatApplies(evidence, vt)));
            }}
          >
            {Object.entries(VAT_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {kind === "purchase" && !noVatEvidence && (
          <div className="flex items-end gap-3 pb-1.5">
            <Switch id={`${p}-deductible`} checked={deductibleOn} onCheckedChange={setDeductibleOn} />
            <Label htmlFor={`${p}-deductible`}>공제 여부</Label>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="합계" htmlFor={`${p}-total`}>
          <MoneyInput
            id={`${p}-total`}
            value={amounts.total}
            onValueChange={(t) => setAmounts(fromTotal(t, vatApplies(evidence, vatType)))}
          />
        </Field>
        <Field label="공급가액" htmlFor={`${p}-supply`}>
          <MoneyInput
            id={`${p}-supply`}
            value={amounts.supply}
            onValueChange={(s) => {
              const v = s === null ? null : vatApplies(evidence, vatType) ? defaultVat(s) : 0;
              setAmounts({ supply: s, vat: v, total: s === null || v === null ? null : s + v });
            }}
          />
        </Field>
        <Field label="부가세" htmlFor={`${p}-vat`}>
          <MoneyInput
            id={`${p}-vat`}
            value={amounts.vat}
            onValueChange={(v) =>
              setAmounts((a) => ({ ...a, vat: v, total: a.supply === null || v === null ? null : a.supply + v }))
            }
          />
        </Field>
      </div>

      {built.ok ? (
        <LinesPreview lines={built.value.lines} accounts={ctx.accounts} />
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{built.error}</p>
      )}

      <SaveBar error={ctx.error} pending={ctx.pending} />
    </form>
  );
}
