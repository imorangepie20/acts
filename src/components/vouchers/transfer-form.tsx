"use client";

import { useState } from "react";
import { buildSimpleVoucher, type TransferInput } from "@/lib/vouchers/simple";
import { EVIDENCE_TYPE_LABELS, type EvidenceType } from "@/lib/vouchers/types";
import { AccountPicker } from "./account-picker";
import { MoneyInput } from "./money-input";
import { PartnerPicker, type PartnerValue } from "./partner-picker";
import { Field, LinesPreview, SaveBar, selectClass, type FormContext } from "./shared";

export type TransferInitial = {
  simple: Pick<TransferInput, "evidenceType"> & {
    debitAccountId: number | null;
    creditAccountId: number | null;
    amount: number | null;
  };
  partner: PartnerValue;
};

const FIRST = ["101", "103"];

export function TransferForm({ ctx, initial }: { ctx: FormContext; initial?: TransferInitial }) {
  const init = initial?.simple;
  const [debitId, setDebitId] = useState<number | null>(init?.debitAccountId ?? null);
  const [creditId, setCreditId] = useState<number | null>(init?.creditAccountId ?? null);
  const [amount, setAmount] = useState<number | null>(init?.amount ?? null);
  const [partner, setPartner] = useState<PartnerValue>(initial?.partner ?? null);
  const [evidence, setEvidence] = useState<EvidenceType>(init?.evidenceType ?? "none");

  const input: TransferInput = {
    type: "transfer",
    date: ctx.common.date,
    description: ctx.common.description,
    debitAccountId: debitId ?? 0,
    creditAccountId: creditId ?? 0,
    amount: amount ?? 0,
    partnerId: partner?.id ?? null,
    siteId: ctx.common.siteId,
    departmentId: ctx.common.departmentId,
    evidenceType: evidence,
  };
  const built = buildSimpleVoucher(input, ctx.vat);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (debitId === null) return ctx.fail("차변 계정을 선택하세요.");
        if (creditId === null) return ctx.fail("대변 계정을 선택하세요.");
        ctx.submit({ mode: "simple", simple: input });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="차변 계정" htmlFor="transfer-debit">
          <AccountPicker
            id="transfer-debit"
            label="차변 계정"
            accounts={ctx.accounts}
            first={FIRST}
            value={debitId}
            onChange={setDebitId}
          />
        </Field>
        <Field label="대변 계정" htmlFor="transfer-credit">
          <AccountPicker
            id="transfer-credit"
            label="대변 계정"
            accounts={ctx.accounts}
            first={FIRST}
            value={creditId}
            onChange={setCreditId}
          />
        </Field>
        <Field label="금액" htmlFor="transfer-amount">
          <MoneyInput id="transfer-amount" value={amount} onValueChange={setAmount} />
        </Field>
        <Field label="거래처" htmlFor="transfer-partner">
          <PartnerPicker id="transfer-partner" label="거래처" value={partner} onChange={setPartner} />
        </Field>
        <Field label="증빙" htmlFor="transfer-evidence">
          <select
            id="transfer-evidence"
            className={selectClass}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value as EvidenceType)}
          >
            {Object.entries(EVIDENCE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {built.ok ? (
        <LinesPreview lines={built.value.lines} accounts={ctx.accounts} />
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{built.error}</p>
      )}

      <SaveBar
        error={ctx.error}
        pending={ctx.pending}
        onSaveTemplate={
          ctx.canSaveTemplate
            ? () =>
                ctx.saveAsTemplate({
                  type: "transfer",
                  description: ctx.common.description,
                  debitAccountId: debitId,
                  creditAccountId: creditId,
                  partnerId: partner?.id ?? null,
                  evidenceType: evidence,
                  amount,
                })
            : undefined
        }
      />
    </form>
  );
}
