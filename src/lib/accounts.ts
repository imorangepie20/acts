export const ACCOUNT_GROUPS = [
  "current_asset",
  "noncurrent_asset",
  "current_liability",
  "noncurrent_liability",
  "equity",
  "revenue",
  "cost_of_sales",
  "sga",
  "non_operating_income",
  "non_operating_expense",
  "income_tax",
] as const;

export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

/** Profit-and-loss groups (accumulate within a fiscal year). */
export const PNL_GROUPS: readonly AccountGroup[] = [
  "revenue",
  "cost_of_sales",
  "sga",
  "non_operating_income",
  "non_operating_expense",
  "income_tax",
];

/** Balance-sheet groups (accumulate from the beginning of time). */
export const BS_GROUPS: readonly AccountGroup[] = [
  "current_asset",
  "noncurrent_asset",
  "current_liability",
  "noncurrent_liability",
  "equity",
];

export const isPnlGroup = (g: AccountGroup): boolean => PNL_GROUPS.includes(g);
export const isBalanceSheetGroup = (g: AccountGroup): boolean => BS_GROUPS.includes(g);

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  current_asset: "유동자산",
  noncurrent_asset: "비유동자산",
  current_liability: "유동부채",
  noncurrent_liability: "비유동부채",
  equity: "자본",
  revenue: "매출",
  cost_of_sales: "매출원가",
  sga: "판매비와관리비",
  non_operating_income: "영업외수익",
  non_operating_expense: "영업외비용",
  income_tax: "법인세비용",
};

export const DASHBOARD_ROLES = ["cash", "receivable", "payable"] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];
export const DASHBOARD_ROLE_LABELS: Record<DashboardRole, string> = {
  cash: "현금·예금",
  receivable: "받을 돈",
  payable: "줄 돈",
};

export const VAT_INPUT_CODE = "135"; // 부가세대급금
export const VAT_OUTPUT_CODE = "255"; // 부가세예수금

const DEBIT_GROUPS: ReadonlySet<AccountGroup> = new Set<AccountGroup>([
  "current_asset",
  "noncurrent_asset",
  "cost_of_sales",
  "sga",
  "non_operating_expense",
  "income_tax",
]);

export function normalSideOf(g: AccountGroup): "debit" | "credit" {
  return DEBIT_GROUPS.has(g) ? "debit" : "credit";
}

const RANGES: [number, number, AccountGroup][] = [
  [101, 175, "current_asset"],
  [176, 250, "noncurrent_asset"],
  [251, 290, "current_liability"],
  [291, 330, "noncurrent_liability"],
  [331, 400, "equity"],
  [401, 450, "revenue"],
  [451, 800, "cost_of_sales"],
  [801, 900, "sga"],
  [901, 950, "non_operating_income"],
  [951, 997, "non_operating_expense"],
  [998, 999, "income_tax"],
];

/** Douzone code-range default; a UI hint only (the stored group is authoritative). */
export function suggestGroup(code: string): AccountGroup | null {
  if (!/^\d{3}$/.test(code)) return null;
  const n = Number(code);
  return RANGES.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}
