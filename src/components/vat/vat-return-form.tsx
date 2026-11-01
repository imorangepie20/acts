import { formatWon } from "@/lib/money";
import {
  E_FILING_BASIS,
  isByIndustryRow,
  PAYABLE_LABEL,
  REFUND_LABEL,
  vatCells,
  type VatCell,
} from "@/lib/vat/cells";
import { BY_INDUSTRY_NOTICE, BY_REASON_NOTICE, taxDiffNotice, ZERO_ASSUMED_NOTICE } from "@/lib/vat/notices";
import type { VatReturn } from "@/lib/vat/return";
import type { VatRowGroup } from "@/lib/vat/rows";
import { NOT_COMPUTED_TEXT } from "@/lib/withholding/return-rows";
import { cell, num } from "./cells";

const note = "mt-0.5 text-[11px] font-normal text-neutral-600";

function Value({ v, col }: { v: VatCell; col: "amount" | "tax" }) {
  if (v === null) return <td className={`${cell} bg-neutral-100`} data-col={col} />;
  if (v === NOT_COMPUTED_TEXT)
    return (
      <td className={`${cell} text-center text-[11px] text-neutral-500`} data-col={col}>
        {v}
      </td>
    );
  return (
    <td className={num} data-col={col}>
      {formatWon(v)}
    </td>
  );
}

/** One page of 별지 제21호서식 as a 칸 번호 | 이름 | 금액 | 세율 | 세액 table. */
export function VatReturnForm({ title, groups, result }: { title: string; groups: VatRowGroup[]; result: VatReturn }) {
  return (
    <div>
      <p className="mb-1 flex justify-between font-medium">
        <span>{title}</span>
        <span className="font-normal">(단위: 원)</span>
      </p>
      <table className="w-full table-fixed border-collapse" aria-label={title}>
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-32" />
          <col className="w-20" />
          <col className="w-32" />
        </colgroup>
        <thead>
          <tr className="bg-neutral-100">
            <th className={cell}>칸</th>
            <th className={cell}>이름</th>
            <th className={cell}>금액</th>
            <th className={cell}>세율</th>
            <th className={cell}>세액</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            g.rows.length > 1 ? (
              <tr key={`g:${g.label}`} className="bg-neutral-50">
                <th className={`${cell} text-left`} colSpan={5}>
                  {g.label}
                </th>
              </tr>
            ) : null,
            ...g.rows.flatMap((r) => {
              const { amount, tax } = vatCells(r, result.rows);
              const diff = result.taxDiff.get(r.no as 1 | 2 | 3 | 4);
              const total = /합계|차감계|차감ㆍ가감/.test(r.label);
              const out = [
                <tr key={r.no} data-row={r.no} className={total ? "font-semibold" : undefined}>
                  <td className={`${cell} text-center tabular-nums`}>({r.no})</td>
                  <td className={cell}>
                    {r.label || "—"}
                    {r.no === 53 && <p className={note}>{BY_REASON_NOTICE}</p>}
                    {r.no === 57 && <p className={note}>{E_FILING_BASIS}</p>}
                    {r.no === 30 && <p className={note}>{ZERO_ASSUMED_NOTICE}</p>}
                  </td>
                  {isByIndustryRow(r.no) ? (
                    <td className={`${cell} text-center text-[11px] text-neutral-500`} colSpan={3} data-col="amount">
                      {BY_INDUSTRY_NOTICE}
                    </td>
                  ) : (
                    <>
                      <Value v={amount} col="amount" />
                      <td className={`${cell} text-center whitespace-nowrap`}>{r.rate ?? ""}</td>
                    </>
                  )}
                  {isByIndustryRow(r.no) ? null : typeof tax === "number" && diff !== undefined ? (
                    <td className={num} data-col="tax">
                      {formatWon(tax)}
                      <p className={note}>{taxDiffNotice(diff)}</p>
                    </td>
                  ) : r.no === 30 && typeof tax === "number" && tax < 0 ? (
                    <td className={num} data-col="tax">
                      {formatWon(tax)}
                      <p className={note}>{REFUND_LABEL}</p>
                    </td>
                  ) : (
                    <Value v={tax} col="tax" />
                  )}
                </tr>,
              ];
              if (r.no === 18)
                out.push(
                  <tr key="payable" data-row="payable" className="bg-neutral-50 font-semibold">
                    <td className={cell} />
                    <td className={cell}>{PAYABLE_LABEL}</td>
                    <td className={`${cell} bg-neutral-100`} />
                    <td className={cell} />
                    <td className={num}>{formatWon(result.payable)}</td>
                  </tr>,
                );
              return out;
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}
