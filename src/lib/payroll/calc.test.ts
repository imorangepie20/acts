import { describe, expect, it } from "vitest";
import { WITHHOLDING_REVISIONS } from "@/server/payroll/seed-data/withholding";
import { computeLine, floor10, monthlyIncomeTax, splitTaxable } from "./calc";
import type { EmployeeCalcInput, ItemDef, Rates, WithholdingTable } from "./types";

const real = WITHHOLDING_REVISIONS[1].table;

const table: WithholdingTable = {
  rows: [
    { from: 0, to: 1_000_000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { from: 1_000_000, to: 2_000_000, tax: [100_000, 50_000, 30_000, 20_000, 10_000, 5_000, 0, 0, 0, 0, 0] },
    { from: 2_000_000, to: 3_000_000, tax: [12_345, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    // 10,000천원 row; family 1 = 1,507,400 as in the real table
    { from: 3_000_000, to: 4_000_000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 30_000, 10_000] },
    { from: 4_000_000, to: 5_000_000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 12_000, 10_000] },
    { from: 10_000_000, to: 10_000_001, tax: [1_507_400, 1_000_000, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  over10m: real.over10m,
  childCredit: { one: 12_500, two: 29_160, perExtra: 25_000 },
  familyOver11: { baseCount: 11, stepFromCount: 10 },
};

const rates: Rates = {
  pensionEmployee: 4.75,
  pensionCompany: 4.75,
  pensionCap: 6_590_000,
  pensionFloor: 410_000,
  healthEmployee: 3.595,
  healthCompany: 3.595,
  ltcEmployee: 13.14,
  ltcCompany: 13.14,
  employmentEmployee: 0.9,
  employmentCompany: 0.9,
};

const base: EmployeeCalcInput = {
  dependents: 1,
  children: 0,
  withholdingRate: 100,
  insPension: true,
  insHealth: true,
  insEmployment: true,
  pensionBase: 3_000_000,
  healthBase: 3_000_000,
};
const items: ItemDef[] = [
  { code: "salary", name: "기본급", taxable: true, nontaxLimit: null, inEmploymentBase: true },
  { code: "meal", name: "식대", taxable: false, nontaxLimit: 200_000, inEmploymentBase: false },
];
const calc = (over: Partial<Parameters<typeof computeLine>[0]> = {}, emp: Partial<EmployeeCalcInput> = {}) =>
  computeLine({
    items,
    amounts: { salary: 3_000_000 },
    employee: { ...base, ...emp },
    rates,
    table,
    type: "regular",
    ...over,
  });

describe("splitTaxable", () => {
  it("splits 비과세 above the monthly limit", () => {
    const s = splitTaxable(items, { salary: 3_000_000, meal: 250_000 });
    expect(s).toEqual({ gross: 3_250_000, taxable: 3_050_000, nontaxable: 200_000, employmentBase: 3_000_000 });
  });
});

describe("insurance", () => {
  it("clamps the pension base to the cap and floor", () => {
    expect(calc({}, { pensionBase: 7_000_000 }).deductions.pension).toBe(313_020);
    expect(calc({}, { pensionBase: 300_000 }).deductions.pension).toBe(19_470);
  });
  it("uses the cap effective on the 귀속월 1일", () => {
    const old = { ...rates, pensionCap: 6_370_000, pensionFloor: 400_000 };
    expect(calc({}, { pensionBase: 7_000_000 }).deductions.pension).toBe(313_020);
    expect(calc({ rates: old }, { pensionBase: 7_000_000 }).deductions.pension).toBe(302_570);
  });
  it("floors every insurance to 10원, ltc on the 건강보험료", () => {
    const l = calc();
    expect(l.deductions.pension).toBe(142_500);
    expect(l.deductions.health).toBe(107_850);
    expect(l.deductions.ltc).toBe(14_170); // 107,850 × 13.14% = 14,171.49
    expect(l.deductions.employment).toBe(27_000);
    expect(l.company).toEqual({ pension: 142_500, health: 107_850, ltc: 14_170, employment: 27_000 });
  });
  it("does not drift at an exact 10원 boundary", () => {
    const emp = (salary: number) => calc({ amounts: { salary } }).deductions.employment;
    expect(emp(1_111_000)).toBe(9_990); // 9,999.0 -> 9,990
    expect(emp(1_111_112)).toBe(10_000); // 10,000.008 -> 10,000
    expect(emp(1_111_111)).toBe(9_990); // 9,999.999 -> 9,990
    expect(calc({}, { pensionBase: 1_200_000 }).deductions.pension).toBe(57_000); // exact 57,000.0
    expect(calc({}, { pensionBase: 2_300_000 }).deductions.pension).toBe(109_250);
  });
  it("employee not enrolled in an insurance pays 0 for it, company too", () => {
    const l = calc({}, { insPension: false, insHealth: false, insEmployment: false });
    expect(l.deductions.pension + l.deductions.health + l.deductions.ltc + l.deductions.employment).toBe(0);
    expect(l.company).toEqual({ pension: 0, health: 0, ltc: 0, employment: 0 });
  });
  it("bonus run has no pension, health or ltc", () => {
    const l = calc({ type: "bonus", bonusTax: 50_000 });
    expect(l.deductions.pension).toBe(0);
    expect(l.deductions.health).toBe(0);
    expect(l.deductions.ltc).toBe(0);
    expect(l.company.pension + l.company.health + l.company.ltc).toBe(0);
    expect(l.deductions.employment).toBe(27_000);
    expect(l.company.employment).toBe(27_000);
    expect(l.deductions.incomeTax).toBe(50_000);
    expect(l.deductions.localTax).toBe(5_000);
  });
});

describe("income tax", () => {
  it("applies 80% and 120% to the table amount", () => {
    const at = (rate: 80 | 100 | 120, taxable: number) =>
      calc({ amounts: { salary: taxable } }, { withholdingRate: rate }).deductions.incomeTax;
    expect(at(80, 1_500_000)).toBe(80_000);
    expect(at(120, 1_500_000)).toBe(120_000);
    expect(at(100, 1_500_000)).toBe(100_000);
    expect(at(80, 2_500_000)).toBe(9_870); // 12,345 × 80% = 9,876 -> 9,870
  });
  it("subtracts the 자녀 credit and never goes negative", () => {
    expect(monthlyIncomeTax(table, 1_500_000, 1, 1)).toBe(87_500);
    expect(monthlyIncomeTax(table, 1_500_000, 1, 2)).toBe(70_840);
    expect(monthlyIncomeTax(table, 1_500_000, 1, 3)).toBe(45_840);
    expect(monthlyIncomeTax(table, 1_500_000, 6, 3)).toBe(0);
  });
  it("override of incomeTax recomputes localTax", () => {
    const l = calc({ overrides: { incomeTax: 123_450 } });
    expect(l.deductions.incomeTax).toBe(123_450);
    expect(l.deductions.localTax).toBe(12_340);
    const l2 = calc({ overrides: { incomeTax: 123_450, localTax: 1 } });
    expect(l2.deductions.localTax).toBe(1);
    expect(l2.netPay).toBe(l2.gross - l2.totalDeductions);
  });
  it("floor10 floors", () => {
    expect(floor10(14_171.49)).toBe(14_170);
  });
  // [별표 2] 제6호: 10,000천원 초과 14,000천원 이하 =
  //   (10,000천원 세액) + 25,000 + (초과액 × 98% × 35%)
  // 12,000,000, 1명: 1,507,400 + 25,000 + 2,000,000 × 0.98 × 0.35 (= 686,000) = 2,218,400
  it("over 10,000천원, first band", () => {
    expect(monthlyIncomeTax(table, 12_000_000, 1, 0)).toBe(2_218_400);
  });
  // 14,000천원 초과 28,000천원 이하 = (10,000천원 세액) + 1,397,000 + (14,000천원 초과액 × 98% × 38%)
  // 20,000,000, 1명: 1,507,400 + 1,397,000 + 6,000,000 × 0.98 × 0.38 (= 2,234,400) = 5,138,800
  it("over 10,000천원, second band", () => {
    expect(monthlyIncomeTax(table, 20_000_000, 1, 0)).toBe(5_138_800);
  });
  it("floors the over-10,000천원 amount to 10원 (국고금 관리법 제47조)", () => {
    // 1,507,400 + 25,000 + floor(1 x 0.98 x 0.35) = 1,532,400
    expect(monthlyIncomeTax(table, 10_000_001, 1, 0)).toBe(1_532_400);
    // 100 x 0.98 x 0.35 = 34.3 -> 34; 1,532,400 + 34 = 1,532,434 -> 1,532,430
    expect(monthlyIncomeTax(table, 10_000_100, 1, 0)).toBe(1_532_430);
  });
  it("throws on an unsupported over10m base", () => {
    const bad = { ...table, over10m: [{ ...real.over10m[0], base: "prev" as const }] };
    expect(() => monthlyIncomeTax(bad, 12_000_000, 1, 0)).toThrow();
  });
  it("more than 11 family: tax(11) - (tax(10) - tax(11)) x extra", () => {
    // 3,500,000: tax(11) 10,000, tax(10) 30,000 -> 10,000 - 20,000 = -10,000 -> 0
    expect(monthlyIncomeTax(table, 3_500_000, 12, 0)).toBe(0);
    // 4,500,000: 10,000 - 2,000 x 1 = 8,000 (12명); 6,000 (13명)
    expect(monthlyIncomeTax(table, 4_500_000, 12, 0)).toBe(8_000);
    expect(monthlyIncomeTax(table, 4_500_000, 13, 0)).toBe(6_000);
  });
  it("band edges: from inclusive, to exclusive, below the first band", () => {
    expect(monthlyIncomeTax(table, 999_999, 1, 0)).toBe(0); // row 0
    expect(monthlyIncomeTax(table, 1_000_000, 1, 0)).toBe(100_000); // row 1
    expect(monthlyIncomeTax(table, 1_999_999, 1, 0)).toBe(100_000);
    expect(monthlyIncomeTax(table, 2_000_000, 1, 0)).toBe(12_345);
    expect(monthlyIncomeTax({ ...table, rows: table.rows.slice(1) }, 999_999, 1, 0)).toBe(0); // below first band
  });
  it("override of health recomputes employee ltc unless ltc is overridden", () => {
    expect(calc({ overrides: { health: 100_000 } }).deductions.ltc).toBe(13_140);
    expect(calc({ overrides: { health: 100_000, ltc: 5 } }).deductions.ltc).toBe(5);
  });
});
