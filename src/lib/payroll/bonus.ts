import { floor10, monthlyIncomeTax } from "./calc";
import type { WithholdingTable } from "./types";

function monthIndex(ym: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) throw new Error(`Invalid month: ${ym}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}
function ymOf(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * 지급대상기간 in whole months, as YYYY-MM. Accepts YYYY-MM or YYYY-MM-DD.
 * No period: January of the pay year through the pay month. Over 12 months: the 12 months ending at `to`.
 * (소득세법 제136조)
 */
export function bonusPeriod(
  payDate: string,
  from: string | null,
  to: string | null,
): { from: string; to: string; months: number } {
  let start: number;
  let end: number;
  if (from && to) {
    start = monthIndex(from);
    end = monthIndex(to);
    if (start > end) throw new Error("지급대상기간의 시작이 끝보다 늦습니다.");
  } else {
    end = monthIndex(payDate);
    start = Math.floor(end / 12) * 12;
  }
  start = Math.max(start, end - 11);
  return { from: ymOf(start), to: ymOf(end), months: end - start + 1 };
}

export function bonusIncomeTax(input: {
  table: WithholdingTable;
  bonusTaxable: number;
  periodRegularTaxable: number;
  periodWithheld: number;
  months: number;
  dependents: number;
  children: number;
  withholdingRate: number;
}): number {
  const months = Math.max(1, Math.floor(input.months));
  const average = Math.floor((input.bonusTaxable + input.periodRegularTaxable) / months);
  const total = monthlyIncomeTax(input.table, average, input.dependents, input.children) * months;
  const rated = floor10(Math.floor((total * Math.round(input.withholdingRate * 1000)) / 100_000));
  return Math.max(0, rated - input.periodWithheld);
}
