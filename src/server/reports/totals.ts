import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { accounts, voucherLines, vouchers } from "@/server/db/schema";
import { POSTED_STATUSES } from "@/lib/vouchers/types";
import type { AccountGroup } from "@/lib/accounts";

export type AccountTotal = { accountId: number; debit: number; credit: number };

export type TotalsFilter = {
  from: string | null;
  to: string;
  siteId: number | null;
  departmentId: number | null;
};

export const PNL_GROUPS: readonly AccountGroup[] = [
  "revenue",
  "cost_of_sales",
  "sga",
  "non_operating_income",
  "non_operating_expense",
  "income_tax",
];

/** Debit/credit sums per account over posted lines in [from, to]. */
export async function accountTotals(db: Db, f: TotalsFilter): Promise<AccountTotal[]> {
  const debit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'debit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const credit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'credit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const rows = await db
    .select({ accountId: voucherLines.accountId, debit, credit })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        inArray(vouchers.status, [...POSTED_STATUSES]),
        f.from === null ? undefined : gte(vouchers.date, f.from),
        lte(vouchers.date, f.to),
        f.siteId === null ? undefined : eq(voucherLines.siteId, f.siteId),
        f.departmentId === null ? undefined : eq(voucherLines.departmentId, f.departmentId),
      ),
    )
    .groupBy(voucherLines.accountId)
    .orderBy(voucherLines.accountId);
  return rows
    .map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) }))
    .filter((r) => r.debit !== 0 || r.credit !== 0);
}

/** Σ (credit − debit) over posted lines on profit-and-loss accounts. */
export async function profitBetween(db: Db, f: TotalsFilter): Promise<number> {
  const [totals, groups] = await Promise.all([
    accountTotals(db, f),
    db.select({ id: accounts.id, group: accounts.group }).from(accounts),
  ]);
  const pnl = new Set(groups.filter((a) => PNL_GROUPS.includes(a.group)).map((a) => a.id));
  return totals.reduce((s, t) => (pnl.has(t.accountId) ? s + t.credit - t.debit : s), 0);
}
