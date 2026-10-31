import type {
  DeductionKey,
  EmployeeCalcInput,
  ItemDef,
  LineResult,
  Rates,
  WithholdingTable,
} from "./types";

export function floor10(n: number): number {
  return Math.floor(n / 10) * 10;
}

/** Percent to thousandths of a percent, as an integer (4.75 -> 4750). Rates have at most 3 decimals. */
function milli(percent: number): number {
  return Math.round(percent * 1000);
}

/** floor10(amount × percent / 100) in integer math, so float drift cannot cross a 10원 boundary. */
function pct10(amount: number, percent: number): number {
  return Math.floor(Math.floor((amount * milli(percent)) / 100_000) / 10) * 10;
}

export function splitTaxable(
  items: ItemDef[],
  amounts: Record<string, number>,
): { gross: number; taxable: number; nontaxable: number; employmentBase: number } {
  let gross = 0;
  let taxable = 0;
  let nontaxable = 0;
  let employmentBase = 0;
  for (const item of items) {
    const amount = Math.max(0, amounts[item.code] ?? 0);
    const nontax = item.taxable ? 0 : Math.min(amount, item.nontaxLimit ?? amount);
    const tax = amount - nontax;
    gross += amount;
    nontaxable += nontax;
    taxable += tax;
    if (item.inEmploymentBase) employmentBase += tax;
  }
  return { gross, taxable, nontaxable, employmentBase };
}

/** Table amount for 1..11 family members at this wage (before the 자녀 credit). */
function taxForFamily(table: WithholdingTable, wage: number, family: number): number {
  const idx = family - 1;
  if (wage > 10_000_000) {
    const row10 = table.rows.find((r) => r.from <= 10_000_000 && 10_000_000 < r.to);
    const base = row10?.tax[idx] ?? 0;
    let rule: (typeof table.over10m)[number] | undefined;
    for (const r of table.over10m) if (wage > r.above) rule = r;
    if (!rule) return base;
    // (wage - above) × plusRate% × plusPercent%, integer math in 1/10000 steps
    const extra = Math.floor(((wage - rule.above) * rule.plusRate * rule.plusPercentOfExcess) / 10_000);
    return floor10(base + rule.addFixed + extra);
  }
  const row = table.rows.find((r) => r.from <= wage && wage < r.to);
  return row?.tax[idx] ?? 0;
}

export function monthlyIncomeTax(
  table: WithholdingTable,
  monthlyTaxable: number,
  dependents: number,
  children: number,
): number {
  const family = Math.max(1, Math.floor(dependents));
  const { baseCount, stepFromCount } = table.familyOver11;
  let tax: number;
  if (family > baseCount) {
    const t11 = taxForFamily(table, monthlyTaxable, baseCount);
    const t10 = taxForFamily(table, monthlyTaxable, stepFromCount);
    tax = t11 - (t10 - t11) * (family - baseCount);
  } else {
    tax = taxForFamily(table, monthlyTaxable, family);
  }
  const { one, two, perExtra } = table.childCredit;
  const credit = children <= 0 ? 0 : children === 1 ? one : two + (children - 2) * perExtra;
  return Math.max(0, tax - credit);
}

export function computeLine(input: {
  items: ItemDef[];
  amounts: Record<string, number>;
  employee: EmployeeCalcInput;
  rates: Rates;
  table: WithholdingTable;
  type: "regular" | "bonus";
  bonusTax?: number;
  overrides?: Partial<Record<DeductionKey, number>>;
}): LineResult {
  const { employee: e, rates: r, type, overrides = {} } = input;
  const split = splitTaxable(input.items, input.amounts);

  const insured = type === "regular";
  const pensionBase = e.insPension && insured
    ? Math.min(Math.max(Math.floor(e.pensionBase / 1000) * 1000, r.pensionFloor), r.pensionCap)
    : 0;
  const pensionEmp = pct10(pensionBase, r.pensionEmployee);
  const pensionCo = pct10(pensionBase, r.pensionCompany);

  const healthOn = e.insHealth && insured;
  const healthEmp = healthOn ? pct10(e.healthBase, r.healthEmployee) : 0;
  const healthCo = healthOn ? pct10(e.healthBase, r.healthCompany) : 0;
  // 장기요양 is a share of that side's 건강보험료.
  const ltcEmp = pct10(healthEmp, r.ltcEmployee);
  const ltcCo = pct10(healthCo, r.ltcCompany);

  const employmentEmp = e.insEmployment ? pct10(split.employmentBase, r.employmentEmployee) : 0;
  const employmentCo = e.insEmployment ? pct10(split.employmentBase, r.employmentCompany) : 0;

  let incomeTax: number;
  if (type === "bonus") {
    incomeTax = input.bonusTax ?? 0;
  } else {
    const t = monthlyIncomeTax(input.table, split.taxable, e.dependents, e.children);
    incomeTax = e.withholdingRate === 100 ? t : Math.floor((t * e.withholdingRate) / 1000) * 10;
  }

  const incomeTaxFinal = overrides.incomeTax ?? incomeTax;
  const deductions: Record<DeductionKey, number> = {
    pension: overrides.pension ?? pensionEmp,
    health: overrides.health ?? healthEmp,
    ltc: overrides.ltc ?? ltcEmp,
    employment: overrides.employment ?? employmentEmp,
    incomeTax: incomeTaxFinal,
    localTax: overrides.localTax ?? floor10(incomeTaxFinal / 10),
  };
  const totalDeductions =
    deductions.pension +
    deductions.health +
    deductions.ltc +
    deductions.employment +
    deductions.incomeTax +
    deductions.localTax;

  return {
    ...split,
    deductions,
    company: { pension: pensionCo, health: healthCo, ltc: ltcCo, employment: employmentCo },
    totalDeductions,
    netPay: split.gross - totalDeductions,
  };
}
