/**
 * 사업주만 내는 보험료율 (pure, shared with the settings screen). Unlike the other 4대보험 rates they
 * depend on the company (규모, 업종), so they are not seeded: the company enters them on 급여 설정,
 * and a kind without a row in force is 0%.
 */
export const EMPLOYER_RATE_KINDS = ["employment_stability_company", "industrial_accident_company"] as const;
export type EmployerRateKind = (typeof EMPLOYER_RATE_KINDS)[number];

export const EMPLOYER_RATE_LABELS: Record<EmployerRateKind, string> = {
  employment_stability_company: "고용안정·직업능력개발",
  industrial_accident_company: "산재보험",
};

export type EmployerRateRow = { id: number; kind: EmployerRateKind; effectiveFrom: string; value: number };
export type EmployerRateInput = { kind: EmployerRateKind; effectiveFrom: string; value: number };

/** Percent, 0 to 10, at most 3 decimals (stored like the other rates: 0.25 = 0.25%). */
export function isEmployerRateValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
}
