import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type AccountGroup } from "@/lib/accounts";
import type { AccountTotal } from "./types";

type Amounts = { debitBalance: number; debitTotal: number; creditTotal: number; creditBalance: number };

export type TrialBalanceRow =
  | { kind: "group"; label: string }
  | ({ kind: "account"; accountId: number; code: string; name: string } & Amounts)
  | ({ kind: "auto"; name: "이월이익잉여금(전기 손익)" } & Amounts)
  | ({ kind: "subtotal"; label: string } & Amounts);

export type TrialBalance = { rows: TrialBalanceRow[]; total: Amounts; balanced: boolean };

type TbAccount = { id: number; code: string; name: string; group: AccountGroup };

const zero = (): Amounts => ({ debitBalance: 0, debitTotal: 0, creditTotal: 0, creditBalance: 0 });
const add = (a: Amounts, b: Amounts) => {
  a.debitBalance += b.debitBalance;
  a.debitTotal += b.debitTotal;
  a.creditTotal += b.creditTotal;
  a.creditBalance += b.creditBalance;
};

export function buildTrialBalance(input: {
  accounts: TbAccount[];
  bsTotals: AccountTotal[];
  plTotals: AccountTotal[];
  priorProfit: number;
}): TrialBalance {
  const totals = new Map<number, AccountTotal>();
  for (const t of [...input.bsTotals, ...input.plTotals]) totals.set(t.accountId, t);

  const rows: TrialBalanceRow[] = [];
  const total = zero();
  for (const group of ACCOUNT_GROUPS) {
    const body: TrialBalanceRow[] = [];
    const sub = zero();
    const members = input.accounts
      .filter((a) => a.group === group && totals.has(a.id))
      .sort((a, b) => a.code.localeCompare(b.code));
    for (const a of members) {
      const t = totals.get(a.id)!;
      const amounts: Amounts = {
        debitTotal: t.debit,
        creditTotal: t.credit,
        debitBalance: Math.max(t.debit - t.credit, 0),
        creditBalance: Math.max(t.credit - t.debit, 0),
      };
      body.push({ kind: "account", accountId: a.id, code: a.code, name: a.name, ...amounts });
      add(sub, amounts);
    }
    if (group === "equity" && input.priorProfit !== 0) {
      const p = input.priorProfit;
      const amounts: Amounts =
        p > 0
          ? { ...zero(), creditTotal: p, creditBalance: p }
          : { ...zero(), debitTotal: -p, debitBalance: -p };
      body.push({ kind: "auto", name: "이월이익잉여금(전기 손익)", ...amounts });
      add(sub, amounts);
    }
    if (body.length === 0) continue;
    const label = ACCOUNT_GROUP_LABELS[group];
    rows.push({ kind: "group", label }, ...body, { kind: "subtotal", label: `${label} 계`, ...sub });
    add(total, sub);
  }
  return { rows, total, balanced: total.debitTotal === total.creditTotal };
}
