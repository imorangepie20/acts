import { formatBusinessNumber } from "@/lib/business-number";
import { formatWon } from "@/lib/money";
import { CARD_DETAIL_ROWS, cardOverflowNotice, sortedCardDetail } from "@/lib/vat/cells";
import { ENTER_DIRECTLY } from "@/lib/vat/notices";
import type { CardStatement as Statement, Tally } from "@/lib/vat/types";
import { NOT_COMPUTED_TEXT } from "@/lib/withholding/return-rows";
import { cell, num } from "./cells";

/** 신용카드매출전표등 수령명세서(갑): ④–⑧ 합계 and the ⑧ 명세. */
export function CardStatement({ card: c }: { card: Statement }) {
  const detail = sortedCardDetail(c.otherDetail);
  const tally = (label: string, t: Tally, total?: boolean) => (
    <tr key={label} className={total ? "font-semibold" : undefined}>
      <td className={cell}>{label}</td>
      <td className={num}>{formatWon(t.count)}</td>
      <td className={num}>{formatWon(t.supplyAmount)}</td>
      <td className={num}>{formatWon(t.vatAmount)}</td>
    </tr>
  );
  return (
    <section className="flex flex-col gap-2" aria-label="신용카드매출전표등 수령명세서">
      <h2 className="text-sm font-semibold">신용카드매출전표등 수령명세서(갑)</h2>
      <table className="w-full border-collapse" aria-label="신용카드매출전표등 수령금액 합계">
        <thead>
          <tr className="bg-neutral-100">
            <th className={cell}>구분</th>
            <th className={cell}>거래건수</th>
            <th className={cell}>공급가액</th>
            <th className={cell}>세액</th>
          </tr>
        </thead>
        <tbody>
          {tally("④ 합계", c.total, true)}
          {tally("⑤ 현금영수증", c.cashReceipt)}
          <tr>
            <td className={cell}>⑥ 화물운전자복지카드</td>
            <td className={`${cell} text-center text-[11px] text-neutral-500`} colSpan={3}>
              {NOT_COMPUTED_TEXT}
            </td>
          </tr>
          {tally("⑦ 사업용 신용카드", c.businessCard)}
          {tally("⑧ 그 밖의 신용카드 등", c.otherCard)}
        </tbody>
      </table>
      <p className="font-medium">⑧ 그 밖의 신용카드 등 명세</p>
      <table className="w-full border-collapse" aria-label="그 밖의 신용카드 등 명세">
        <thead>
          <tr className="bg-neutral-100">
            <th className={cell}>일련번호</th>
            <th className={cell}>카드회원번호</th>
            <th className={cell}>가맹점 사업자등록번호</th>
            <th className={cell}>거래건수</th>
            <th className={cell}>공급가액</th>
            <th className={cell}>세액</th>
          </tr>
        </thead>
        <tbody>
          {detail.length === 0 && (
            <tr>
              <td className={`${cell} text-center text-neutral-500`} colSpan={6}>
                없음
              </td>
            </tr>
          )}
          {detail.map((d, i) => (
            <tr key={`${d.cardNo}|${d.businessNumber}`}>
              <td className={`${cell} text-center tabular-nums`}>{i + 1}</td>
              <td className={`${cell} tabular-nums whitespace-nowrap`}>{d.cardNo ?? ENTER_DIRECTLY}</td>
              <td className={`${cell} tabular-nums whitespace-nowrap`}>
                {d.businessNumber ? formatBusinessNumber(d.businessNumber) : ""}
              </td>
              <td className={num}>{formatWon(d.count)}</td>
              <td className={num}>{formatWon(d.supplyAmount)}</td>
              <td className={num}>{formatWon(d.vatAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.length > CARD_DETAIL_ROWS && <p className="text-neutral-600">{cardOverflowNotice}</p>}
    </section>
  );
}
