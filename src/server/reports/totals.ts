import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { accounts, voucherLines, vouchers } from "@/server/db/schema";
import { POSTED_STATUSES } from "@/lib/vouchers/types";
import { isPnlGroup } from "@/lib/accounts";
import type { AccountTotal } from "@/lib/reports/types";

/** No payroll flag on purpose: totals include payroll vouchers for every user (statements, dashboard, closing). */
export type TotalsFilter = {
  from: string | null;
  to: string;
  siteId: number | null;
  departmentId: number | null;
};


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
  const pnl = new Set(groups.filter((a) => isPnlGroup(a.group)).map((a) => a.id));
  return totals.reduce((s, t) => (pnl.has(t.accountId) ? s + t.credit - t.debit : s), 0);
}

/** Like `accountTotals` over [from, to], but one SQL query grouped by `YYYY-MM` and account. */
export async function accountTotalsByMonth(
  db: Db,
  f: { from: string; to: string; siteId: number | null; departmentId: number | null },
): Promise<Map<string, AccountTotal[]>> {
  const debit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'debit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const credit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'credit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const month = sql<string>`to_char(${vouchers.date}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, accountId: voucherLines.accountId, debit, credit })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        inArray(vouchers.status, [...POSTED_STATUSES]),
        gte(vouchers.date, f.from),
        lte(vouchers.date, f.to),
        f.siteId === null ? undefined : eq(voucherLines.siteId, f.siteId),
        f.departmentId === null ? undefined : eq(voucherLines.departmentId, f.departmentId),
      ),
    )
    .groupBy(month, voucherLines.accountId)
    .orderBy(month, voucherLines.accountId);
  const out = new Map<string, AccountTotal[]>();
  for (const r of rows) {
    const t = { accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) };
    if (t.debit === 0 && t.credit === 0) continue;
    const list = out.get(r.month);
    if (list) list.push(t);
    else out.set(r.month, [t]);
  }
  return out;
}
