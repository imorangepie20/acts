import type { DeductionKey } from "./types";

export const DEDUCTION_KEYS: readonly DeductionKey[] = ["pension", "health", "ltc", "employment", "incomeTax", "localTax"];

export const DEDUCTION_LABELS: Record<DeductionKey, string> = {
  pension: "국민연금",
  health: "건강보험",
  ltc: "장기요양",
  employment: "고용보험",
  incomeTax: "소득세",
  localTax: "지방소득세",
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
