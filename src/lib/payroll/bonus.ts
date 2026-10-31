import { floor10, monthlyIncomeTax } from "./calc";
import type { WithholdingTable } from "./types";

function monthIndex(ym: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Invalid month: ${ym}`);
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
  if ((from === null) !== (to === null)) throw new Error("지급대상기간은 시작과 끝을 함께 입력해야 합니다.");
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
  const { bonusTaxable, periodRegularTaxable, periodWithheld, months } = input;
  for (const n of [bonusTaxable, periodRegularTaxable, periodWithheld]) {
    if (!Number.isInteger(n) || n < 0) throw new Error("상여 계산 금액이 올바르지 않습니다.");
  }
  if (!Number.isInteger(months) || months < 1) throw new Error("지급대상기간 월수가 올바르지 않습니다.");
  if (![80, 100, 120].includes(input.withholdingRate)) throw new Error("원천징수 비율이 올바르지 않습니다.");
  const average = Math.floor((bonusTaxable + periodRegularTaxable) / months);
  const monthly = monthlyIncomeTax(input.table, average, input.dependents, input.children);
  // UNVERIFIED: the law text does not state the order of the 80/120% rate vs x months.
  // Follows the regular-run rule: rate on the table amount, floor to 10원, then x months.
  const perMonth = floor10(Math.floor((monthly * input.withholdingRate) / 100));
  return Math.max(0, perMonth * months - periodWithheld);
}
