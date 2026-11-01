// What each 신고서 cell shows, shared by the screen (src/components/vat/) and the Excel sheet (src/server/vat/sheets.ts).

import { NOT_COMPUTED_TEXT } from "@/lib/withholding/return-rows";
import type { VatRow } from "./rows";
import type { Amounts, CardStatement } from "./types";

/** A number, the not-computed text, or null for a cell the form leaves empty (shaded or absent). */
export type VatCell = number | typeof NOT_COMPUTED_TEXT | null;

/** (22)–(30) print a 세액 only; (31)–(35) 과세표준명세 and (85)–(90) 면세·계산서 rows print a 금액 only. */
const TAX_ONLY = (no: number) => no >= 22 && no <= 30;
const AMOUNT_ONLY = (no: number) => (no >= 31 && no <= 35) || (no >= 85 && no <= 90);

/** (31)–(34) 과세표준명세 by 업태·종목: acts has no 업태·종목, so the screen shows BY_INDUSTRY_NOTICE there. */
export const isByIndustryRow = (no: number) => no >= 31 && no <= 34;

export function vatCells(r: VatRow, rows: Map<number, Amounts>): { amount: VatCell; tax: VatCell } {
  const a = r.computed ? rows.get(r.no) : undefined;
  const value = (v: number | undefined): VatCell => (r.computed ? (v ?? 0) : NOT_COMPUTED_TEXT);
  return {
    amount: r.shadedAmount || TAX_ONLY(r.no) ? null : value(a?.amount),
    tax: AMOUNT_ONLY(r.no) ? null : value(a?.tax),
  };
}

/** ⑧ detail in a stable order: card number, then business number; nulls (직접 입력) last. */
export function sortedCardDetail(detail: CardStatement["otherDetail"]): CardStatement["otherDetail"] {
  const cmp = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x.localeCompare(y));
  return [...detail].sort((a, b) => cmp(a.cardNo, b.cardNo) || cmp(a.businessNumber, b.businessNumber));
}

/** Rows per 갑 서식 before the rest goes on the (을) 서식. */
export const INVOICE_DETAIL_ROWS = 5;
export const CARD_DETAIL_ROWS = 15;
export const invoiceOverflowNotice = `${INVOICE_DETAIL_ROWS + 1}번째부터는 (을) 서식에 적습니다.`;
export const cardOverflowNotice = `${CARD_DETAIL_ROWS + 1}번째부터는 (을) 서식에 적습니다.`;

/** Under (57). */
export const E_FILING_BASIS = "조특법 시행령 제104조의5④";
/** ㉰, rendered between (18) and (19). */
export const PAYABLE_LABEL = "납부(환급)세액 ㉰";
/** Beside a negative (30). */
export const REFUND_LABEL = "환급받을 세액";
