"use client";

import { useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatWon } from "@/lib/money";
import type { LineInput } from "@/lib/vouchers/types";
import { AccountPicker } from "./account-picker";
import { MoneyInput } from "./money-input";
import { PartnerPicker, type PartnerValue } from "./partner-picker";
import { SaveBar, type FormContext } from "./shared";

export type GeneralRow = {
  accountId: number | null;
  debit: number | null;
  credit: number | null;
  partner: PartnerValue;
  description: string;
};
type KeyedRow = GeneralRow & { key: number };

const emptyRow = (): GeneralRow => ({ accountId: null, debit: null, credit: null, partner: null, description: "" });

const isBlank = (r: GeneralRow) =>
  r.accountId === null && r.debit === null && r.credit === null && r.partner === null && !r.description.trim();
const isFilled = (r: GeneralRow) => r.accountId !== null && (r.debit !== null || r.credit !== null);

export function GeneralForm({
  ctx,
  initial,
  initialClosing = false,
}: {
  ctx: FormContext;
  initial?: GeneralRow[];
  initialClosing?: boolean;
}) {
  const [closing, setClosing] = useState(initialClosing);
  const start = initial && initial.length >= 2 ? initial : [emptyRow(), emptyRow()];
  const nextKey = useRef(start.length);
  const [rows, setRows] = useState<KeyedRow[]>(() => start.map((r, i) => ({ ...r, key: i })));

  const update = (key: number, patch: Partial<GeneralRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...emptyRow(), key: nextKey.current++ }]);
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const debitTotal = rows.reduce((s, r) => s + (r.debit ?? 0), 0);
  const creditTotal = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const diff = debitTotal - creditTotal;
  const filled = rows.filter(isFilled).length;
  const canSave = diff === 0 && filled >= 2;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const used = rows.filter((r) => !isBlank(r));
        if (used.some((r) => !isFilled(r))) return ctx.fail("계정과 금액을 모두 입력하세요.");
        const header = ctx.common;
        const lines: LineInput[] = used.map((r) => ({
          accountId: r.accountId!,
          side: r.debit !== null ? "debit" : "credit",
          amount: (r.debit ?? r.credit)!,
          partnerId: r.partner?.id ?? null,
          siteId: header.siteId,
          departmentId: header.departmentId,
          description: r.description.trim() || header.description,
        }));
        ctx.submit({
          mode: "general",
          voucher: {
            date: header.date,
            description: header.description,
            entryType: "general",
            kind: closing ? "closing" : "general",
            partnerId: lines.find((l) => l.partnerId !== null)?.partnerId ?? null,
            evidenceType: "none",
            vatType: null,
            vatDeductible: null,
            supplyAmount: null,
            vatAmount: null,
            lines,
          },
        });
      }}
    >
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="w-10 p-2 text-left font-medium">#</th>
              <th className="p-2 text-left font-medium">계정</th>
              <th className="w-36 p-2 text-right font-medium">차변</th>
              <th className="w-36 p-2 text-right font-medium">대변</th>
              <th className="w-48 p-2 text-left font-medium">거래처</th>
              <th className="p-2 text-left font-medium">적요</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const n = `${i + 1}행`;
              return (
                <tr key={r.key} className="border-b align-top last:border-0">
                  <td className="p-2 pt-3.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="p-2">
                    <AccountPicker
                      label={`${n} 계정`}
                      accounts={ctx.accounts}
                      value={r.accountId}
                      onChange={(id) => update(r.key, { accountId: id })}
                    />
                  </td>
                  <td className="p-2">
                    <MoneyInput
                      aria-label={`${n} 차변`}
                      value={r.debit}
                      onValueChange={(v) => update(r.key, v === null ? { debit: null } : { debit: v, credit: null })}
                    />
                  </td>
                  <td className="p-2">
                    <MoneyInput
                      aria-label={`${n} 대변`}
                      value={r.credit}
                      onValueChange={(v) => update(r.key, v === null ? { credit: null } : { credit: v, debit: null })}
                    />
                  </td>
                  <td className="p-2">
                    <PartnerPicker
                      label={`${n} 거래처`}
                      value={r.partner}
                      onChange={(p) => update(r.key, { partner: p })}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      aria-label={`${n} 적요`}
                      placeholder={ctx.common.description || undefined}
                      value={r.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    {rows.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${n} 삭제`}
                        onClick={() => removeRow(r.key)}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/40">
            <tr>
              <td colSpan={2} className="p-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  <PlusIcon />줄 추가
                </Button>
              </td>
              <td className="p-2 text-right tabular-nums">
                <span className="mr-2 text-xs text-muted-foreground">차변 합계</span>
                {formatWon(debitTotal)}
              </td>
              <td className="p-2 text-right tabular-nums">
                <span className="mr-2 text-xs text-muted-foreground">대변 합계</span>
                {formatWon(creditTotal)}
              </td>
              <td colSpan={3} className="p-2">
                <span className="mr-2 text-xs text-muted-foreground">차액</span>
                <output aria-label="차액" className={diff !== 0 ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
                  {formatWon(Math.abs(diff))}
                </output>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-start gap-3">
        <Switch id="voucher-closing" checked={closing} onCheckedChange={setClosing} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <label htmlFor="voucher-closing" className="text-sm font-medium">
            결산 전표
          </label>
          <p className="text-xs text-muted-foreground">
            세무사 결산 수정 내역(감가상각·대손·미지급비용·법인세 등)을 입력할 때 켭니다.
          </p>
        </div>
      </div>

      <SaveBar
        error={ctx.error}
        pending={ctx.pending}
        disabled={!canSave}
        onSaveTemplate={
          ctx.canSaveTemplate
            ? () =>
                ctx.saveAsTemplate({
                  type: "general",
                  description: ctx.common.description,
                  closing,
                  lines: rows
                    .filter((r) => !isBlank(r))
                    .map((r) => ({
                      accountId: r.accountId,
                      side: r.debit === null && r.credit !== null ? "credit" : "debit",
                      amount: r.debit ?? r.credit,
                      partnerId: r.partner?.id ?? null,
                      description: r.description.trim(),
                    })),
                })
            : undefined
        }
      />
    </form>
  );
}
