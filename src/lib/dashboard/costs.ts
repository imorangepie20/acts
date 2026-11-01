// 비용 구성: 판매비와관리비 by account, plus 인건비.

import { changePct } from "./kpi";

export type CostAccount = { accountId: number; code: string; name: string; amount: number; prior: number | null };

export type CostRow = {
  /** null for the 기타 row. */
  accountId: number | null;
  label: string;
  amount: number;
  /** Share of total 판관비, percent with one decimal. */
  share: number;
  /** Change against the prior-year same period; null without prior data. */
  changePct: number | null;
};

export type CostComposition = {
  total: number;
  rows: CostRow[];
  labor: { amount: number; shareOfCosts: number | null; shareOfRevenue: number | null; codes: string[] };
};

/** 임원급여, 직원급여, 상여금, 퇴직급여 (codes resolved at runtime; missing ones are skipped). */
export const LABOR_CODES = ["801", "802", "803", "806"] as const;

const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/** Top `top` accounts by amount (positive only), the rest as 기타. `hasPrior` false hides every change. */
export function costComposition(
  accounts: CostAccount[],
  revenue: number,
  opts: { top?: number; hasPrior: boolean },
): CostComposition {
  const top = opts.top ?? 7;
  const used = accounts.filter((a) => a.amount !== 0).sort((a, b) => b.amount - a.amount);
  const total = used.reduce((s, a) => s + a.amount, 0);
  const head = used.slice(0, top);
  const tail = used.slice(top);
  const rows: CostRow[] = head.map((a) => ({
    accountId: a.accountId,
    label: `${a.code} ${a.name}`,
    amount: a.amount,
    share: pct(a.amount, total) ?? 0,
    changePct: opts.hasPrior ? changePct(a.amount, a.prior ?? 0) : null,
  }));
  if (tail.length > 0) {
    const amount = tail.reduce((s, a) => s + a.amount, 0);
    const prior = tail.reduce((s, a) => s + (a.prior ?? 0), 0);
    rows.push({
      accountId: null,
      label: `기타 ${tail.length}개 계정`,
      amount,
      share: pct(amount, total) ?? 0,
      changePct: opts.hasPrior ? changePct(amount, prior) : null,
    });
  }
  const laborAccounts = accounts.filter((a) => (LABOR_CODES as readonly string[]).includes(a.code));
  const labor = laborAccounts.reduce((s, a) => s + a.amount, 0);
  return {
    total,
    rows,
    labor: {
      amount: labor,
      shareOfCosts: pct(labor, total),
      shareOfRevenue: pct(labor, revenue),
      codes: laborAccounts.map((a) => a.code),
    },
  };
}
