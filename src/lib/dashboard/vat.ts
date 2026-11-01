// 부가세 예상액 for the 과세기간 that contains a date.

import type { VatEntry } from "@/lib/vat/types";
import type { VatKind } from "@/lib/vat/periods";
import { addMonths, monthEnd, nextBusinessDay } from "./dates";

export type CurrentVatPeriod = {
  year: number;
  term: 1 | 2;
  kind: VatKind;
  from: string;
  to: string;
  /** 25th of the month after the period ends, moved past a weekend. */
  due: string;
};

/**
 * A 법인 files 예정 (Q1, Q3) and 확정 (Q2, Q4) for each quarter; an individual files 확정 for the whole half.
 */
export function currentVatPeriod(date: string, businessType: "corporation" | "individual"): CurrentVatPeriod {
  const year = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const term: 1 | 2 = m <= 6 ? 1 : 2;
  const half = term === 1 ? 1 : 7;
  let fromMonth: number;
  let toMonth: number;
  let kind: VatKind;
  if (businessType === "individual") {
    [fromMonth, toMonth, kind] = [half, half + 5, "final"];
  } else {
    const q1 = m < half + 3;
    [fromMonth, toMonth, kind] = q1 ? [half, half + 2, "prelim"] : [half + 3, half + 5, "final"];
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const endMonth = `${year}-${pad(toMonth)}`;
  return {
    year,
    term,
    kind,
    from: `${year}-${pad(fromMonth)}-01`,
    to: monthEnd(endMonth),
    due: nextBusinessDay(`${addMonths(endMonth, 1)}-25`),
  };
}

export type VatEstimate = {
  outputTax: number;
  /** 공제받는 매입세액 only (vatDeductible true). */
  inputTax: number;
  /** Positive = 납부, negative = 환급. */
  payable: number;
  saleCount: number;
  purchaseCount: number;
};

export function vatEstimate(entries: VatEntry[]): VatEstimate {
  let outputTax = 0;
  let inputTax = 0;
  let saleCount = 0;
  let purchaseCount = 0;
  for (const e of entries) {
    if (e.entryType === "sale") {
      outputTax += e.vatAmount;
      saleCount++;
    } else {
      purchaseCount++;
      if (e.vatDeductible) inputTax += e.vatAmount;
    }
  }
  return { outputTax, inputTax, payable: outputTax - inputTax, saleCount, purchaseCount };
}
