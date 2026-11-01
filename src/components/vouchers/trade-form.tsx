"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { recommendAccountsAction } from "@/app/(dashboard)/vouchers/actions";
import { Switch } from "@/components/ui/switch";
import type { AccountGroup } from "@/lib/accounts";
import { formatWon } from "@/lib/money";
import type { Recommendation } from "@/lib/recommend";
import {
  buildSimpleVoucher,
  defaultVat,
  splitVatFromTotal,
  type TradeInput,
  type TradeSplit,
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

/** What a form reads to pre-fill itself: an edited voucher (complete) or a template (possibly not). */
export type TradeInitial = {
  simple: Pick<TradeInput, "evidenceType" | "vatType" | "vatDeductible" | "paperTaxInvoice" | "unregisteredCard"> & {
    mainAccountId: number | null;
    counterAccountId: number | null;
    supplyAmount: number | null;
    vatAmount: number | null;
    splits?: TradeSplit[];
  };
  partner: PartnerValue;
};

/** A 계정 나누기 row; the first row's account is the voucher's main account. */
type SplitRow = { key: number; accountId: number | null; amount: number | null };

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
  // null = one account for the whole supply amount. Keys of initial rows are their indexes.
  const [splitRows, setSplitRows] = useState<SplitRow[] | null>(
    init?.splits ? init.splits.map((s, i) => ({ key: i, accountId: s.accountId, amount: s.amount })) : null,
  );
  const nextKey = useRef(init?.splits?.length ?? 0);
  // Event handlers only: reads the ref.
  const splitRow = (accountId: number | null, amount: number | null): SplitRow => ({
    key: nextKey.current++,
    accountId,
    amount,
  });
  const effectiveMainId = splitRows ? splitRows[0].accountId : mainId;
  const updateSplit = (key: number, patch: Partial<SplitRow>) =>
    setSplitRows((rows) => rows && rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const [counterId, setCounterId] = useState<number | null>(init?.counterAccountId ?? null);
  const [partner, setPartner] = useState<PartnerValue>(initial?.partner ?? null);
  const [evidence, setEvidence] = useState<EvidenceType>(init?.evidenceType ?? setup.evidence);
  const [vatType, setVatType] = useState<VatType>(init?.vatType ?? "taxable");
  const [deductibleOn, setDeductibleOn] = useState(init ? init.vatDeductible : true);
  // A 수정·취소분 is typed as positive amounts with this switch on; it is sent negated.
  const [reversal, setReversal] = useState((init?.supplyAmount ?? 0) < 0);
  // Header flags are not part of a template: applying one starts them off.
  const [paper, setPaper] = useState(init?.paperTaxInvoice === true);
  const [unregistered, setUnregistered] = useState(init?.unregisteredCard === true);
  const [amounts, setAmounts] = useState<Amounts>(() => {
    if (!init) return { total: null, supply: null, vat: null };
    const supply = init.supplyAmount === null ? null : Math.abs(init.supplyAmount);
    const vat = init.vatAmount === null ? null : Math.abs(init.vatAmount);
    return { total: supply === null || vat === null ? null : supply + vat, supply, vat };
  });
  const sign = reversal ? -1 : 1;

  const [recs, setRecs] = useState<Recommendation[]>([]);
  const partnerId = partner?.id ?? null;
  const text = ctx.common.description;
  const hasQuery = partnerId !== null || text.trim() !== "";
  const lastPartner = useRef(partnerId);
  useEffect(() => {
    if (!hasQuery) return;
    // A partner pick fetches at once; typing waits for 400 ms of idle.
    const delay = lastPartner.current !== partnerId ? 0 : 400;
    lastPartner.current = partnerId;
    let stale = false;
    const t = setTimeout(() => {
      recommendAccountsAction({ entryType: kind, partnerId, text })
        .then((r) => {
          if (!stale) setRecs(r.ok ? r.value : []);
        })
        .catch(() => {
          if (!stale) setRecs([]);
        });
    }, delay);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [kind, partnerId, text, hasQuery]);
  const chips = hasQuery
    ? recs.flatMap((r) => {
        const a = ctx.accounts.find((x) => x.id === r.accountId);
        return a && a.id !== mainId ? [{ a, reason: r.reason }] : [];
      })
    : [];
  const splitTotal = splitRows ? splitRows.reduce((s, r) => s + (r.amount ?? 0), 0) : 0;
  const splitDiff = (amounts.supply ?? 0) - splitTotal;

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
    mainAccountId: effectiveMainId ?? 0,
    counterAccountId: counterId ?? 0,
    partnerId: partner?.id ?? null,
    siteId: ctx.common.siteId,
    departmentId: ctx.common.departmentId,
    evidenceType: evidence,
    vatType: effectiveVatType,
    vatDeductible: deductible,
    paperTaxInvoice: evidence === "tax_invoice" && paper,
    unregisteredCard: kind === "purchase" && evidence === "card" && unregistered,
    supplyAmount: sign * (amounts.supply ?? 0),
    vatAmount: sign * (amounts.vat ?? 0),
    ...(splitRows && {
      splits: splitRows.map((r) => ({ accountId: r.accountId ?? 0, amount: r.amount ?? 0 })),
    }),
  };
  const built = buildSimpleVoucher(input, ctx.vat);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (splitRows?.some((r) => r.accountId === null)) return ctx.fail("나눌 계정을 선택하세요.");
        if (effectiveMainId === null) return ctx.fail("계정을 선택하세요.");
        if (counterId === null) return ctx.fail(`${setup.counterLabel}을 선택하세요.`);
        ctx.submit({ mode: "simple", simple: input });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="계정" htmlFor={`${p}-main`}>
          {splitRows ? (
            <p className="flex h-9 items-center text-sm text-muted-foreground">아래 계정별 금액에서 나눠 입력합니다.</p>
          ) : (
            <>
              <AccountPicker
                id={`${p}-main`}
                label="계정"
                accounts={ctx.accounts}
                groups={setup.groups}
                value={mainId}
                onChange={setMainId}
              />
              <button
                type="button"
                className="mt-1.5 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setSplitRows([splitRow(mainId, amounts.supply), splitRow(null, null)])}
              >
                계정 나누기
              </button>
            </>
          )}
          {!splitRows && chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="추천 계정">
              {chips.map(({ a, reason }) => (
                <button
                  key={a.id}
                  type="button"
                  title={reason}
                  className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setMainId(a.id)}
                >
                  {a.code} {a.name}
                </button>
              ))}
            </div>
          )}
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
              if (ev === "invoice") setDeductibleOn(false);
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
              // 면세·영세 purchases are usually not deducted; the user may switch it back on.
              if (vt !== "taxable") setDeductibleOn(false);
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
        {evidence === "tax_invoice" && (
          <div className="flex items-end gap-3 pb-1.5">
            <Switch id={`${p}-paper`} checked={paper} onCheckedChange={setPaper} />
            <Label htmlFor={`${p}-paper`}>종이 세금계산서</Label>
          </div>
        )}
        {kind === "purchase" && evidence === "card" && (
          <div className="flex items-end gap-3 pb-1.5">
            <Switch id={`${p}-unregistered`} checked={unregistered} onCheckedChange={setUnregistered} />
            <Label htmlFor={`${p}-unregistered`}>홈택스 미등록 카드</Label>
          </div>
        )}
        <div className="flex items-end gap-3 pb-1.5">
          <Switch id={`${p}-reversal`} checked={reversal} onCheckedChange={setReversal} />
          <Label htmlFor={`${p}-reversal`}>수정·취소분(마이너스)</Label>
        </div>
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

      {splitRows && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[480px] text-sm" aria-label="계정별 금액">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="w-10 p-2 text-left font-medium">#</th>
                <th className="p-2 text-left font-medium">계정</th>
                <th className="w-44 p-2 text-right font-medium">공급가액</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {splitRows.map((r, i) => (
                <tr key={r.key} className="border-b align-top last:border-0">
                  <td className="p-2 pt-3.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="p-2">
                    <AccountPicker
                      label={`나눌 계정 ${i + 1}`}
                      accounts={ctx.accounts}
                      groups={setup.groups}
                      value={r.accountId}
                      onChange={(id) => updateSplit(r.key, { accountId: id })}
                    />
                  </td>
                  <td className="p-2">
                    <MoneyInput
                      aria-label={`나눌 금액 ${i + 1}`}
                      value={r.amount}
                      onValueChange={(v) => updateSplit(r.key, { amount: v })}
                    />
                  </td>
                  <td className="p-2">
                    {splitRows.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`나눌 계정 ${i + 1} 삭제`}
                        onClick={() => setSplitRows((rows) => rows && rows.filter((x) => x.key !== r.key))}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40">
              <tr>
                <td colSpan={2} className="p-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSplitRows((rows) => rows && [...rows, splitRow(null, null)])}
                    >
                      <PlusIcon />계정 추가
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMainId(splitRows[0].accountId);
                        setSplitRows(null);
                      }}
                    >
                      나누기 취소
                    </Button>
                  </div>
                </td>
                <td colSpan={2} className="p-2 text-right tabular-nums">
                  <div>
                    <span className="mr-2 text-xs text-muted-foreground">나눈 합계</span>
                    {formatWon(splitTotal)}
                  </div>
                  <div>
                    <span className="mr-2 text-xs text-muted-foreground">남은 금액</span>
                    <output
                      aria-label="남은 금액"
                      className={splitDiff !== 0 ? "font-medium text-destructive" : undefined}
                    >
                      {formatWon(splitDiff)}
                    </output>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

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
                  type: kind,
                  description: ctx.common.description,
                  mainAccountId: effectiveMainId,
                  counterAccountId: counterId,
                  partnerId: partner?.id ?? null,
                  evidenceType: evidence,
                  vatType: effectiveVatType,
                  vatDeductible: deductibleOn,
                  supplyAmount: amounts.supply,
                  vatAmount: amounts.vat,
                })
            : undefined
        }
      />
    </form>
  );
}
