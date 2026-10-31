/** One band of the 근로소득 간이세액표, in won. */
export type WithholdingRow = {
  /** 월급여액 lower bound, inclusive. */
  from: number;
  /** 월급여액 upper bound, exclusive. */
  to: number;
  /** tax[i] is the monthly 소득세 for i + 1 공제대상가족 (i = 0..10), in won, as printed. */
  tax: number[];
};

/**
 * One [별표 2] line for 월급여액 above 10,000천원:
 * tax = (base amount for the family count) + addFixed
 *       + (월급여액 - above) × plusRate% × plusPercentOfExcess%.
 * A line applies when 월급여액 > above; the lines are ordered by `above` and the last matching one wins.
 */
export type Over10mRule = {
  /** Applies to 월급여액 strictly above this amount (won). */
  above: number;
  /** "table10m": the 10,000천원 row's amount; "prev": the previous line's result at `above`. */
  base: "table10m" | "prev";
  /** Share of the excess that is taxed, in percent (98 = "98%를 곱한 금액"; 100 when the text has no such factor). */
  plusRate: number;
  /** Tax rate applied to that share, in percent (35 = "35% 상당액"). */
  plusPercentOfExcess: number;
  /** Fixed amount added, in won. */
  addFixed: number;
};

export type WithholdingTable = {
  rows: WithholdingRow[];
  over10m: Over10mRule[];
  /** [별표 2] 제3호: subtracted from the table amount for children aged 8 to 20; the result never goes below 0. */
  childCredit: { one: number; two: number; perExtra: number };
  /**
   * [별표 2] 제4호, more than 11 공제대상가족:
   * tax(n) = tax(baseCount) - (tax(stepFromCount) - tax(baseCount)) × (n - baseCount).
   */
  familyOver11: { baseCount: 11; stepFromCount: 10 };
};

/**
 * Rates as stored in `payroll_rates`: percents as percent (4.75), caps and floors in won.
 * ltcEmployee / ltcCompany are percent of the 건강보험료 (장기요양보험료 = 건강보험료 × 13.14%),
 * the base 보건복지부 states for 장기요양보험료.
 */
export type Rates = {
  pensionEmployee: number;
  pensionCompany: number;
  pensionCap: number;
  pensionFloor: number;
  healthEmployee: number;
  healthCompany: number;
  ltcEmployee: number;
  ltcCompany: number;
  employmentEmployee: number;
  employmentCompany: number;
};

export type ItemDef = {
  code: string;
  name: string;
  taxable: boolean;
  nontaxLimit: number | null;
  inEmploymentBase: boolean;
};

export type EmployeeCalcInput = {
  /** 공제대상가족 수 (본인 포함), 1 or more. */
  dependents: number;
  /** 8세 이상 20세 이하 자녀 수 for the 자녀 세액공제. */
  children: number;
  withholdingRate: 80 | 100 | 120;
  insPension: boolean;
  insHealth: boolean;
  insEmployment: boolean;
  pensionBase: number;
  healthBase: number;
};

export type DeductionKey = "pension" | "health" | "ltc" | "employment" | "incomeTax" | "localTax";

export type LineResult = {
  gross: number;
  taxable: number;
  nontaxable: number;
  employmentBase: number;
  deductions: Record<DeductionKey, number>;
  company: { pension: number; health: number; ltc: number; employment: number };
  totalDeductions: number;
  netPay: number;
};

/** The 상여 지급대상기간 basis a bonus line was computed with (소득세법 제136조, 시행령 제194조). */
export type BonusBasis = {
  from: string;
  to: string;
  months: number;
  /** 과세 급여 of the confirmed 정기 runs whose 귀속월 is in the period. */
  regularTaxable: number;
  /** 소득세 withheld on those runs. */
  withheld: number;
};

/**
 * Employee facts and rates at compute time (`payroll_run_lines.snapshot`), so payslips stay stable
 * after employee edits. Masked 주민등록번호 and account only; the plain values never go here.
 */
export type RunLineSnapshot = {
  employeeNo: string;
  name: string;
  rrnMasked: string;
  hiredOn: string;
  leftOn: string | null;
  isExecutive: boolean;
  siteId: number;
  siteName: string;
  departmentId: number | null;
  departmentName: string | null;
  bank: string | null;
  accountMasked: string | null;
  calc: EmployeeCalcInput;
  /** Rates of the 귀속월 1일. */
  rates: Rates;
  /** The deductions before overrides (the 계산값 shown next to an overridden cell). */
  calculated: Record<DeductionKey, number>;
  /** Bonus runs only. */
  bonus: BonusBasis | null;
};
