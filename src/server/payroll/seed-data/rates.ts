import type { payrollRateKind } from "@/server/db/schema";

/*
 * Dated 4대보험 rates, seeded into `payroll_rates` by scripts/seed.ts.
 * Percent rates are stored as percent (4.75); caps and floors in won.
 * A run uses, per kind, the row with the latest effective_from <= the 귀속월 1일.
 * Every value below was checked against the official page cited on its line (checked 2026-10-31).
 */

export type RateKind = (typeof payrollRateKind.enumValues)[number];

export type RateSeed = { kind: RateKind; effectiveFrom: string; value: string };

export const RATE_SEED: RateSeed[] = [
  // 국민연금 보험료율: 9% through 2025, then +0.5%p a year from 2026; 근로자·사용자 절반씩.
  // https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0038M0.do
  { kind: "pension_employee", effectiveFrom: "2025-01-01", value: "4.5" },
  { kind: "pension_company", effectiveFrom: "2025-01-01", value: "4.5" },
  { kind: "pension_employee", effectiveFrom: "2026-01-01", value: "4.75" },
  { kind: "pension_company", effectiveFrom: "2026-01-01", value: "4.75" },

  // 기준소득월액 상한·하한 2024-07 ~ 2025-06: 617만 원 / 39만 원.
  // https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1481895&tag=&nPage=1
  { kind: "pension_cap", effectiveFrom: "2024-07-01", value: "6170000" },
  { kind: "pension_floor", effectiveFrom: "2024-07-01", value: "390000" },
  // 2025-07-01 ~ 2026-06-30: 하한액 400,000원, 상한액 6,370,000원.
  // 2026-07-01 ~ 2027-06-30: 하한액 410,000원, 상한액 6,590,000원.
  // https://www.nps.or.kr/pnsgdnc/newgdnc/getOHAE0001M1.do?pstId=ZZ202600000000000147
  { kind: "pension_cap", effectiveFrom: "2025-07-01", value: "6370000" },
  { kind: "pension_floor", effectiveFrom: "2025-07-01", value: "400000" },
  { kind: "pension_cap", effectiveFrom: "2026-07-01", value: "6590000" },
  { kind: "pension_floor", effectiveFrom: "2026-07-01", value: "410000" },

  // 건강보험료율 2025: 7.09% (2년 연속 동결), 근로자·사업주 절반씩.
  // https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1483034&act=view
  { kind: "health_employee", effectiveFrom: "2025-01-01", value: "3.545" },
  { kind: "health_company", effectiveFrom: "2025-01-01", value: "3.545" },
  // 건강보험료율 2026: 7.19%.
  // https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1487279&tag=&nPage=1
  { kind: "health_employee", effectiveFrom: "2026-01-01", value: "3.595" },
  { kind: "health_company", effectiveFrom: "2026-01-01", value: "3.595" },

  // 장기요양보험료는 건강보험료에 "건강보험료 대비 장기요양보험료율"을 곱한다 (보건복지부), so these are
  // percent of the 건강보험료, not of 보수월액.
  // 2025: 건강보험료 대비 12.95% (소득 대비 0.9182%).
  // https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1483484&tag=&nPage=1
  { kind: "ltc_employee", effectiveFrom: "2025-01-01", value: "12.95" },
  { kind: "ltc_company", effectiveFrom: "2025-01-01", value: "12.95" },
  // 2026: 건강보험료 대비 13.14% (소득 대비 0.9448%).
  // https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1487817&tag=&nPage=1
  { kind: "ltc_employee", effectiveFrom: "2026-01-01", value: "13.14" },
  { kind: "ltc_company", effectiveFrom: "2026-01-01", value: "13.14" },

  // 고용보험 실업급여 보험료율 1.8%, 노·사 각각 1/2 ("'22.7.1. 이후 0.9%"), unchanged since.
  // https://www.moel.go.kr/info/astmgmt/employ/employList.do
  // employment_company is the 실업급여 half only; the 사업주-only 고용안정·직업능력개발 (0.25%~0.85% by size) is not included.
  { kind: "employment_employee", effectiveFrom: "2022-07-01", value: "0.9" },
  { kind: "employment_company", effectiveFrom: "2022-07-01", value: "0.9" },
];
