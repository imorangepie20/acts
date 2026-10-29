import { normalSideOf, type AccountGroup } from "@/lib/accounts";
import type { AccountTotal } from "./types";

export type StatementLine =
  | { kind: "section"; key: string; label: string; amount: number; prior: number }
  | { kind: "account"; code: string; name: string; accountId: number | null; amount: number; prior: number }
  | { kind: "computed"; key: string; label: string; amount: number; prior: number };

/** Structural account type, so this module stays independent of src/server. */
export type AccountRow = { id: number; code: string; name: string; group: AccountGroup };

/** Balance-sheet input for one column (as-of date). */
export type BsInput = { bsTotals: AccountTotal[]; priorProfit: number; currentProfit: number };

export const PRIOR_PROFIT_LABEL = "이월이익잉여금(전기 손익)";
export const CURRENT_PROFIT_LABEL = "당기순이익";

type Pair = { amount: number; prior: number };
type Section = { lines: StatementLine[] } & Pair;

/** Signed balance per account id: debit − credit for debit-normal groups, else credit − debit. */
function signedBalances(accounts: AccountRow[], totals: AccountTotal[]): Map<number, number> {
  const groupOf = new Map(accounts.map((a) => [a.id, a.group]));
  const out = new Map<number, number>();
  for (const t of totals) {
    const g = groupOf.get(t.accountId);
    if (g === undefined) continue;
    const signed = normalSideOf(g) === "debit" ? t.debit - t.credit : t.credit - t.debit;
    out.set(t.accountId, (out.get(t.accountId) ?? 0) + signed);
  }
  return out;
}

/** A section header followed by the group's accounts (by code) whose current or prior amount is non-zero. */
function groupSection(
  key: string,
  label: string,
  group: AccountGroup,
  accounts: AccountRow[],
  current: Map<number, number>,
  prior: Map<number, number>,
): Section {
  const body: StatementLine[] = [];
  let amount = 0;
  let priorAmount = 0;
  const members = accounts.filter((a) => a.group === group).sort((a, b) => a.code.localeCompare(b.code));
  for (const a of members) {
    const c = current.get(a.id) ?? 0;
    const p = prior.get(a.id) ?? 0;
    if (c === 0 && p === 0) continue;
    body.push({ kind: "account", code: a.code, name: a.name, accountId: a.id, amount: c, prior: p });
    amount += c;
    priorAmount += p;
  }
  return {
    amount,
    prior: priorAmount,
    lines: [{ kind: "section", key, label, amount, prior: priorAmount }, ...body],
  };
}

const computed = (key: string, label: string, v: Pair): StatementLine => ({ kind: "computed", key, label, ...v });
const pair = (f: (col: "amount" | "prior") => number): Pair => ({ amount: f("amount"), prior: f("prior") });

/** 손익계산서. `current` and `prior` are period totals; non-P&L accounts are ignored. */
export function buildIncomeStatement(
  accounts: AccountRow[],
  current: AccountTotal[],
  prior: AccountTotal[],
): StatementLine[] {
  const cur = signedBalances(accounts, current);
  const pri = signedBalances(accounts, prior);
  const s = (key: AccountGroup, label: string) => groupSection(key, label, key, accounts, cur, pri);

  const revenue = s("revenue", "Ⅰ. 매출액");
  const cost = s("cost_of_sales", "Ⅱ. 매출원가");
  const gross = pair((c) => revenue[c] - cost[c]);
  const sga = s("sga", "Ⅳ. 판매비와관리비");
  const operating = pair((c) => gross[c] - sga[c]);
  const nonOpIncome = s("non_operating_income", "Ⅵ. 영업외수익");
  const nonOpExpense = s("non_operating_expense", "Ⅶ. 영업외비용");
  const pretax = pair((c) => operating[c] + nonOpIncome[c] - nonOpExpense[c]);
  const tax = s("income_tax", "Ⅸ. 법인세비용");
  const net = pair((c) => pretax[c] - tax[c]);

  return [
    ...revenue.lines,
    ...cost.lines,
    computed("gross", "Ⅲ. 매출총이익", gross),
    ...sga.lines,
    computed("operating", "Ⅴ. 영업이익", operating),
    ...nonOpIncome.lines,
    ...nonOpExpense.lines,
    computed("pretax", "Ⅷ. 법인세비용차감전순이익", pretax),
    ...tax.lines,
    computed("net", "Ⅹ. 당기순이익", net),
  ];
}

/** 재무상태표. Each column carries its own balance-sheet totals and profit split; P&L accounts in bsTotals are ignored. */
export function buildBalanceSheet(accounts: AccountRow[], current: BsInput, prior: BsInput): StatementLine[] {
  const cur = signedBalances(accounts, current.bsTotals);
  const pri = signedBalances(accounts, prior.bsTotals);
  const s = (key: AccountGroup, label: string) => groupSection(key, label, key, accounts, cur, pri);

  const curAsset = s("current_asset", "Ⅰ. 유동자산");
  const nonCurAsset = s("noncurrent_asset", "Ⅱ. 비유동자산");
  const assets = pair((c) => curAsset[c] + nonCurAsset[c]);

  const curLiab = s("current_liability", "Ⅰ. 유동부채");
  const nonCurLiab = s("noncurrent_liability", "Ⅱ. 비유동부채");
  const liabilities = pair((c) => curLiab[c] + nonCurLiab[c]);

  const equityAccounts = s("equity", "Ⅰ. 자본");
  const profitRows: StatementLine[] = [];
  const profit = (name: string, amount: number, priorAmount: number) => {
    if (amount !== 0 || priorAmount !== 0) {
      profitRows.push({ kind: "account", code: "", name, accountId: null, amount, prior: priorAmount });
    }
  };
  profit(PRIOR_PROFIT_LABEL, current.priorProfit, prior.priorProfit);
  profit(CURRENT_PROFIT_LABEL, current.currentProfit, prior.currentProfit);
  const equity = {
    amount: equityAccounts.amount + current.priorProfit + current.currentProfit,
    prior: equityAccounts.prior + prior.priorProfit + prior.currentProfit,
  };
  const [, ...equityBody] = equityAccounts.lines;
  const liabEquity = pair((c) => liabilities[c] + equity[c]);

  return [
    { kind: "section", key: "assets", label: "자산", ...assets },
    ...curAsset.lines,
    ...nonCurAsset.lines,
    computed("total_assets", "자산총계", assets),
    { kind: "section", key: "liabilities", label: "부채", ...liabilities },
    ...curLiab.lines,
    ...nonCurLiab.lines,
    computed("total_liabilities", "부채총계", liabilities),
    { kind: "section", key: "capital", label: "자본", ...equity },
    { kind: "section", key: "equity", label: "Ⅰ. 자본", ...equity },
    ...equityBody,
    ...profitRows,
    computed("total_equity", "자본총계", equity),
    computed("total_liabilities_equity", "부채와자본총계", liabEquity),
  ];
}
