import type { DeductionKey, Deductions, ManualDeductionKey } from "./types";

/** Every deduction column, in ledger order (the manual ones next to their kind). */
export const DEDUCTION_KEYS: readonly DeductionKey[] = [
  "pension",
  "health",
  "ltc",
  "healthSettlement",
  "ltcSettlement",
  "employment",
  "incomeTax",
  "localTax",
  "settlementIncomeTax",
  "settlementLocalTax",
];

/** Typed by hand, may be negative (환급), no 계산값. */
export const MANUAL_DEDUCTION_KEYS: readonly ManualDeductionKey[] = [
  "healthSettlement",
  "ltcSettlement",
  "settlementIncomeTax",
  "settlementLocalTax",
];

export const isManualDeduction = (k: DeductionKey): k is ManualDeductionKey =>
  (MANUAL_DEDUCTION_KEYS as readonly string[]).includes(k);

/** A deduction amount; manual keys are absent (0) on lines computed before they existed. */
export const deductionOf = (d: Deductions, k: DeductionKey): number => d[k] ?? 0;

export const DEDUCTION_LABELS: Record<DeductionKey, string> = {
  pension: "국민연금",
  health: "건강보험",
  ltc: "장기요양",
  healthSettlement: "건강보험 정산분",
  ltcSettlement: "장기요양 정산분",
  employment: "고용보험",
  incomeTax: "소득세",
  localTax: "지방소득세",
  settlementIncomeTax: "연말정산 소득세",
  settlementLocalTax: "연말정산 지방소득세",
};

export const RUN_TYPE_LABELS = { regular: "정기", bonus: "상여" } as const;
export const RUN_STATUS_LABELS = { draft: "작성 중", confirmed: "확정" } as const;

/** "2026-01", "regular" → "2026년 1월 정기 급여 대장" */
export function runTitle(yearMonth: string, type: "regular" | "bonus"): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${y}년 ${m}월 ${RUN_TYPE_LABELS[type]} 급여 대장`;
}

/** "급여대장_2026-01" or "급여대장_2026-01_상여" (without .xlsx). */
export function ledgerFileName(yearMonth: string, type: "regular" | "bonus"): string {
  return `급여대장_${yearMonth}${type === "bonus" ? "_상여" : ""}`;
}
