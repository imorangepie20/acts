import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { ReceivableLine } from "@/lib/dashboard/aging";
import type { PayrollMonth } from "@/lib/dashboard/schedule";
import type { LineResult } from "@/lib/payroll/types";
import { POSTED_STATUSES } from "@/lib/vouchers/types";
import type { Db } from "@/server/db/client";
import { partners, payrollRunLines, payrollRuns, voucherLines, vouchers } from "@/server/db/schema";

type Scope = { siteId: number | null; departmentId: number | null };

const scoped = (s: Scope) => [
  s.siteId === null ? undefined : eq(voucherLines.siteId, s.siteId),
  s.departmentId === null ? undefined : eq(voucherLines.departmentId, s.departmentId),
];

export type PartnerBalance = { accountId: number; partnerId: number | null; partnerName: string | null; debit: number; credit: number };

/** Debit/credit per (account, partner) over posted lines up to `asOf`, for the given accounts. */
export async function partnerBalances(db: Db, accountIds: number[], asOf: string, s: Scope): Promise<PartnerBalance[]> {
  if (accountIds.length === 0) return [];
  const debit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'debit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const credit = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'credit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
  const rows = await db
    .select({ accountId: voucherLines.accountId, partnerId: voucherLines.partnerId, partnerName: partners.name, debit, credit })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .leftJoin(partners, eq(partners.id, voucherLines.partnerId))
    .where(
      and(
        inArray(vouchers.status, [...POSTED_STATUSES]),
        lte(vouchers.date, asOf),
        inArray(voucherLines.accountId, accountIds),
        ...scoped(s),
      ),
    )
    .groupBy(voucherLines.accountId, voucherLines.partnerId, partners.name);
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Posted lines of one account up to `asOf`, for the FIFO aging. */
export async function receivableLines(db: Db, accountId: number | null, asOf: string, s: Scope): Promise<ReceivableLine[]> {
  if (accountId === null) return [];
  const rows = await db
    .select({ partnerId: voucherLines.partnerId, date: vouchers.date, side: voucherLines.side, amount: voucherLines.amount })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        inArray(vouchers.status, [...POSTED_STATUSES]),
        lte(vouchers.date, asOf),
        eq(voucherLines.accountId, accountId),
        ...scoped(s),
      ),
    );
  return rows.map((r) => ({ partnerKey: String(r.partnerId ?? "none"), date: r.date, side: r.side, amount: Number(r.amount) }));
}

const sumOf = (o: Record<string, number | undefined> | undefined, keys: string[]) =>
  keys.reduce((s, k) => s + (o?.[k] ?? 0), 0);

/**
 * 원천세 and 4대보험 owed for the confirmed runs (정기 and 상여) paid in [from, to], per 지급일 month.
 * Company-wide (payroll lines are not split by the report scope); totals only, no per-employee data.
 */
export async function payrollMonths(db: Db, from: string, to: string): Promise<PayrollMonth[]> {
  const rows = await db
    .select({ payDate: payrollRuns.payDate, result: payrollRunLines.result })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .where(and(eq(payrollRuns.status, "confirmed"), gte(payrollRuns.payDate, from), lte(payrollRuns.payDate, to)));
  const out = new Map<string, PayrollMonth>();
  for (const { payDate, result } of rows as { payDate: string; result: LineResult }[]) {
    const payMonth = payDate.slice(0, 7);
    const m = out.get(payMonth) ?? { payMonth, tax: 0, insurance: 0 };
    const d = result.deductions as Record<string, number | undefined>;
    m.tax += sumOf(d, ["incomeTax", "localTax", "settlementIncomeTax", "settlementLocalTax"]);
    m.insurance +=
      sumOf(d, ["pension", "health", "ltc", "employment", "healthSettlement", "ltcSettlement"]) +
      sumOf(result.company as Record<string, number | undefined>, [
        "pension",
        "health",
        "ltc",
        "employment",
        "employmentStability",
        "industrialAccident",
      ]);
    out.set(payMonth, m);
  }
  return [...out.values()];
}
