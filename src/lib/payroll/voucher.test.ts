import { describe, expect, it } from "vitest";
import type { LineResult } from "./types";
import { buildPayrollVoucher, payrollDescription } from "./voucher";

const ACC = {
  executive: 801,
  staff: 802,
  pensionCompany: 817,
  insuranceCompany: 811,
  withholding: 254,
  companyPayable: 262,
  netPay: 103,
};
const PARTNERS = { pension: 11, health: 12, employment: 13, tax: 14, localTax: 15 };
const ITEMS = [
  { code: "basic", accountId: null },
  { code: "meal", accountId: null },
  { code: "bonus", accountId: 803 },
];

/** A line whose result is consistent with its amounts: deductions and company parts as given. */
function line(
  employee: { isExecutive: boolean; siteId: number; departmentId: number | null },
  amounts: Record<string, number>,
  d: Partial<LineResult["deductions"]> = {},
  c: Partial<LineResult["company"]> = {},
) {
  const gross = Object.values(amounts).reduce((s, x) => s + x, 0);
  const deductions = { pension: 0, health: 0, ltc: 0, employment: 0, incomeTax: 0, localTax: 0, ...d };
  const company = { pension: 0, health: 0, ltc: 0, employment: 0, ...c };
  const totalDeductions = Object.values(deductions).reduce((s, x) => s + x, 0);
  const result: LineResult = {
    gross,
    taxable: gross,
    nontaxable: 0,
    employmentBase: gross,
    deductions,
    company,
    totalDeductions,
    netPay: gross - totalDeductions,
  };
  return { employee, amounts, result };
}

const FULL_D = { pension: 135_000, health: 107_850, ltc: 14_170, employment: 27_000, incomeTax: 74_350, localTax: 7_430 };
const FULL_C = { pension: 135_000, health: 107_850, ltc: 14_170, employment: 27_000 };

const build = (lines: ReturnType<typeof line>[]) =>
  buildPayrollVoucher({
    payDate: "2026-06-25",
    description: payrollDescription("regular", "2026-06"),
    lines,
    items: ITEMS,
    accounts: ACC,
    partners: PARTNERS,
  });

const sum = (v: ReturnType<typeof build>, side: "debit" | "credit") =>
  v.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);

describe("buildPayrollVoucher", () => {
  it("builds a general payroll voucher on the pay date", () => {
    const v = build([line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000 }, FULL_D, FULL_C)]);
    expect(v).toMatchObject({
      date: "2026-06-25",
      kind: "payroll",
      entryType: "general",
      evidenceType: "none",
      description: "2026년 6월 급여",
      partnerId: null,
      vatType: null,
      vatDeductible: null,
      supplyAmount: null,
      vatAmount: null,
    });
    expect(payrollDescription("bonus", "2026-12")).toBe("2026년 12월 상여");
  });

  it("debits 801 and 802 separately for 2 staff and 1 executive at one site", () => {
    const v = build([
      line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000, meal: 200_000 }),
      line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 2_500_000 }),
      line({ isExecutive: true, siteId: 1, departmentId: null }, { basic: 5_000_000, bonus: 1_000_000 }),
    ]);
    const debits = v.lines.filter((l) => l.side === "debit");
    expect(debits.find((l) => l.accountId === 802)?.amount).toBe(5_700_000);
    expect(debits.find((l) => l.accountId === 801)?.amount).toBe(5_000_000);
    expect(debits.find((l) => l.accountId === 803)?.amount).toBe(1_000_000);
    expect(debits).toHaveLength(3);
  });

  it("splits lines per site and department", () => {
    const v = build([
      line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000 }),
      line({ isExecutive: false, siteId: 2, departmentId: 7 }, { basic: 2_000_000 }),
    ]);
    const staff = v.lines.filter((l) => l.side === "debit" && l.accountId === 802);
    expect(staff.map((l) => [l.siteId, l.departmentId, l.amount])).toEqual([
      [1, null, 3_000_000],
      [2, 7, 2_000_000],
    ]);
    const net = v.lines.filter((l) => l.accountId === 103);
    expect(net.map((l) => [l.siteId, l.departmentId, l.amount])).toEqual([
      [1, null, 3_000_000],
      [2, 7, 2_000_000],
    ]);
  });

  it("balances debits and credits and books the company parts", () => {
    const v = build([
      line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000, meal: 200_000 }, FULL_D, FULL_C),
      line({ isExecutive: true, siteId: 1, departmentId: 3 }, { basic: 4_000_000 }, FULL_D, FULL_C),
    ]);
    expect(sum(v, "debit")).toBe(sum(v, "credit"));
    expect(sum(v, "debit")).toBe(7_200_000 + 2 * (135_000 + 107_850 + 14_170 + 27_000));
    const at = (account: number, dept: number | null) =>
      v.lines.find((l) => l.side === "debit" && l.accountId === account && l.departmentId === dept)?.amount;
    expect(at(817, null)).toBe(135_000);
    expect(at(811, null)).toBe(107_850 + 14_170 + 27_000);
    expect(v.lines.every((l) => Number.isInteger(l.amount) && l.amount > 0)).toBe(true);
  });

  it("drops a zero 고용보험 line", () => {
    const v = build([
      line(
        { isExecutive: true, siteId: 1, departmentId: null },
        { basic: 5_000_000 },
        { ...FULL_D, employment: 0 },
        { ...FULL_C, employment: 0 },
      ),
    ]);
    expect(v.lines.some((l) => l.partnerId === PARTNERS.employment)).toBe(false);
    expect(v.lines.every((l) => l.amount > 0)).toBe(true);
    expect(sum(v, "debit")).toBe(sum(v, "credit"));
  });

  it("puts the partner ids on the right credit lines", () => {
    const v = build([line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000 }, FULL_D, FULL_C)]);
    const credit = (account: number, partner: number | null) =>
      v.lines.find((l) => l.side === "credit" && l.accountId === account && l.partnerId === partner)?.amount;
    expect(credit(254, PARTNERS.pension)).toBe(135_000);
    expect(credit(254, PARTNERS.health)).toBe(107_850 + 14_170);
    expect(credit(254, PARTNERS.employment)).toBe(27_000);
    expect(credit(254, PARTNERS.tax)).toBe(74_350);
    expect(credit(254, PARTNERS.localTax)).toBe(7_430);
    expect(credit(262, PARTNERS.pension)).toBe(135_000);
    expect(credit(262, PARTNERS.health)).toBe(107_850 + 14_170);
    expect(credit(262, PARTNERS.employment)).toBe(27_000);
    expect(credit(103, null)).toBe(3_000_000 - (135_000 + 107_850 + 14_170 + 27_000 + 74_350 + 7_430));
    expect(v.lines.filter((l) => l.side === "debit").every((l) => l.partnerId === null)).toBe(true);
  });

  it("keeps null partners null", () => {
    const v = buildPayrollVoucher({
      payDate: "2026-06-25",
      description: "2026년 6월 급여",
      lines: [line({ isExecutive: false, siteId: 1, departmentId: null }, { basic: 3_000_000 }, FULL_D, FULL_C)],
      items: ITEMS,
      accounts: ACC,
      partners: { pension: null, health: null, employment: null, tax: null, localTax: null },
    });
    expect(v.lines.every((l) => l.partnerId === null)).toBe(true);
    expect(sum(v, "debit")).toBe(sum(v, "credit"));
  });
});
