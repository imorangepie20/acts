import type { LineInput, StoredVoucherInput } from "@/lib/vouchers/types";
import type { LineResult } from "./types";

export type PayrollVoucherAccounts = {
  executive: number;
  staff: number;
  pensionCompany: number;
  insuranceCompany: number;
  withholding: number;
  companyPayable: number;
  netPay: number;
};

export type PayrollVoucherPartners = {
  pension: number | null;
  health: number | null;
  employment: number | null;
  tax: number | null;
  localTax: number | null;
};

export type PayrollVoucherLine = {
  employee: { isExecutive: boolean; siteId: number; departmentId: number | null };
  amounts: Record<string, number>;
  result: LineResult;
};

/** `2026년 6월 급여` / `2026년 6월 상여`, from the 귀속월. */
export function payrollDescription(type: "regular" | "bonus", yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${y}년 ${m}월 ${type === "regular" ? "급여" : "상여"}`;
}

/**
 * The single payroll voucher of a confirmed run: account totals, not one line per employee,
 * split per (site, department).
 * - Debit: each item's amount on its account (null = executive / staff by 임원 여부); company
 *   국민연금 on `pensionCompany`; company 건강 + 장기요양 + 고용 on `insuranceCompany`.
 * - Credit: the employee parts on `withholding` and the company parts on `companyPayable`, one line
 *   per 기관 partner (국민연금 / 건강·장기요양 / 고용 / 소득세 / 지방소득세); 실지급액 on `netPay`.
 * Zero lines are dropped.
 */
export function buildPayrollVoucher(input: {
  payDate: string;
  description: string;
  lines: PayrollVoucherLine[];
  items: { code: string; accountId: number | null }[];
  accounts: PayrollVoucherAccounts;
  partners: PayrollVoucherPartners;
}): StoredVoucherInput & { kind: "payroll" } {
  const { accounts: a, partners: p } = input;
  type Key = string;
  const groups = new Map<Key, { siteId: number; departmentId: number | null }>();
  const debits = new Map<Key, Map<number, number>>();
  const credits = new Map<Key, number[]>();

  // Fixed credit order per group: [account, partner, description].
  const CREDITS: [number, number | null, string][] = [
    [a.withholding, p.pension, "국민연금 근로자 부담분"],
    [a.withholding, p.health, "건강·장기요양보험 근로자 부담분"],
    [a.withholding, p.employment, "고용보험 근로자 부담분"],
    [a.withholding, p.tax, "근로소득세"],
    [a.withholding, p.localTax, "지방소득세"],
    [a.companyPayable, p.pension, "국민연금 사업주 부담분"],
    [a.companyPayable, p.health, "건강·장기요양보험 사업주 부담분"],
    [a.companyPayable, p.employment, "고용보험 사업주 부담분"],
    [a.netPay, null, "실지급액"],
  ];

  for (const line of input.lines) {
    const { siteId, departmentId } = line.employee;
    const key = `${siteId}|${departmentId ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, { siteId, departmentId });
      debits.set(key, new Map());
      credits.set(key, CREDITS.map(() => 0));
    }
    const debit = debits.get(key)!;
    const addDebit = (account: number, amount: number) => debit.set(account, (debit.get(account) ?? 0) + amount);
    for (const item of input.items) {
      const amount = Math.max(0, line.amounts[item.code] ?? 0);
      addDebit(item.accountId ?? (line.employee.isExecutive ? a.executive : a.staff), amount);
    }
    const { deductions: d, company: c } = line.result;
    addDebit(a.pensionCompany, c.pension);
    addDebit(a.insuranceCompany, c.health + c.ltc + c.employment);

    const credit = credits.get(key)!;
    [
      d.pension,
      d.health + d.ltc,
      d.employment,
      d.incomeTax,
      d.localTax,
      c.pension,
      c.health + c.ltc,
      c.employment,
      line.result.netPay,
    ].forEach((amount, i) => (credit[i] += amount));
  }

  const keys = [...groups.keys()].sort((x, y) => {
    const gx = groups.get(x)!;
    const gy = groups.get(y)!;
    return gx.siteId - gy.siteId || (gx.departmentId ?? -1) - (gy.departmentId ?? -1);
  });
  const lines: LineInput[] = [];
  for (const key of keys) {
    const g = groups.get(key)!;
    for (const [accountId, amount] of [...debits.get(key)!].sort((x, y) => x[0] - y[0])) {
      if (amount !== 0) lines.push({ accountId, side: "debit", amount, partnerId: null, ...g, description: "" });
    }
  }
  for (const key of keys) {
    const g = groups.get(key)!;
    credits.get(key)!.forEach((amount, i) => {
      const [accountId, partnerId, description] = CREDITS[i];
      if (amount !== 0) lines.push({ accountId, side: "credit", amount, partnerId, ...g, description });
    });
  }

  return {
    date: input.payDate,
    description: input.description,
    entryType: "general",
    kind: "payroll",
    partnerId: null,
    evidenceType: "none",
    vatType: null,
    vatDeductible: null,
    supplyAmount: null,
    vatAmount: null,
    lines,
  };
}
