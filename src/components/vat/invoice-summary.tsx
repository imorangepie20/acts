import Link from "next/link";
import { formatBusinessNumber } from "@/lib/business-number";
import { formatWon } from "@/lib/money";
import { INVOICE_DETAIL_ROWS, invoiceOverflowNotice } from "@/lib/vat/cells";
import { purchasesWithoutBusinessNumberNotice } from "@/lib/vat/notices";
import type { InvoiceSummary as Summary, PartnerTally, PurchaseWithoutBusinessNumber } from "@/lib/vat/types";
import { cell, num } from "./cells";

/** 매출처별 / 매입처별 세금계산서합계표(갑): 총합계 and the 전자 외 발급분 처별 명세. */
export function InvoiceSummary({
  side,
  summary: s,
  withoutBusinessNumber = [],
}: {
  side: "매출처" | "매입처";
  summary: Summary;
  /** 매입 only: 세금계산서 whose partner has no 사업자등록번호 */
  withoutBusinessNumber?: PurchaseWithoutBusinessNumber[];
}) {
  const issued = side === "매입처" ? "발급받은 분" : "발급분";
  const tally = (label: string, t: PartnerTally, sub?: boolean) => (
    <tr key={label} className={sub ? "font-semibold" : undefined}>
      <td className={cell}>{label}</td>
      <td className={num}>{formatWon(t.partners)}</td>
      <td className={num}>{formatWon(t.count)}</td>
      <td className={num}>{formatWon(t.supplyAmount)}</td>
      <td className={num}>{formatWon(t.vatAmount)}</td>
    </tr>
  );
  const group = (label: string, g: Summary["electronic"]) => [
    <tr key={label} className="bg-neutral-50">
      <th className={`${cell} text-left`} colSpan={5}>
        {label}
      </th>
    </tr>,
    tally(`${label} 사업자등록번호 ${issued}`, g.bn),
    tally(`${label} 주민등록번호 ${issued}`, g.rrn),
    tally(`${label} 소계`, g.subtotal, true),
  ];
  return (
    <section className="flex flex-col gap-2" aria-label={`${side}별 세금계산서합계표`}>
      <h2 className="text-sm font-semibold">{side}별 세금계산서합계표(갑)</h2>
      <table className="w-full border-collapse" aria-label={`${side}별 총합계`}>
        <thead>
          <tr className="bg-neutral-100">
            <th className={cell}>구분</th>
            <th className={cell}>{side}수</th>
            <th className={cell}>매수</th>
            <th className={cell}>공급가액</th>
            <th className={cell}>세액</th>
          </tr>
        </thead>
        <tbody>
          {tally("합계", s.total, true)}
          {group(`전자 ${issued}`, s.electronic)}
          {group(`전자 외 ${issued}`, s.other)}
        </tbody>
      </table>
      <p className="font-medium">전자 외 {issued} {side}별 명세 (사업자등록번호 {issued})</p>
      <table className="w-full border-collapse" aria-label={`${side}별 전자 외 ${issued} 명세`}>
        <thead>
          <tr className="bg-neutral-100">
            <th className={cell}>번호</th>
            <th className={cell}>사업자등록번호</th>
            <th className={cell}>상호</th>
            <th className={cell}>매수</th>
            <th className={cell}>공급가액</th>
            <th className={cell}>세액</th>
          </tr>
        </thead>
        <tbody>
          {s.otherByPartner.length === 0 && (
            <tr>
              <td className={`${cell} text-center text-neutral-500`} colSpan={6}>
                없음
              </td>
            </tr>
          )}
          {s.otherByPartner.map((p, i) => (
            <tr key={p.businessNumber}>
              <td className={`${cell} text-center tabular-nums`}>{i + 1}</td>
              <td className={`${cell} tabular-nums whitespace-nowrap`}>{formatBusinessNumber(p.businessNumber)}</td>
              <td className={cell}>{p.name ?? ""}</td>
              <td className={num}>{formatWon(p.count)}</td>
              <td className={num}>{formatWon(p.supplyAmount)}</td>
              <td className={num}>{formatWon(p.vatAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.otherByPartner.length > INVOICE_DETAIL_ROWS && <p className="text-neutral-600">{invoiceOverflowNotice}</p>}
      {withoutBusinessNumber.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 print:hidden">
          <p className="font-medium">{purchasesWithoutBusinessNumberNotice(withoutBusinessNumber.length)}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {withoutBusinessNumber.map((v) => (
              <li key={v.voucherId} className="tabular-nums">
                <Link href={`/vouchers/${v.voucherId}`} className="underline underline-offset-2">
                  {v.voucherNo}
                </Link>{" "}
                · {v.date} · {v.partnerName ?? "거래처 없음"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
