import { and, asc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { isPnlGroup, normalSideOf } from "@/lib/accounts";
import { fiscalYearStart } from "@/lib/reports/fiscal";
import type { ReportFilter } from "@/lib/reports/types";
import { POSTED_STATUSES, type Side } from "@/lib/vouchers/types";
import { listAccounts, type AccountRow } from "@/server/accounts/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { accounts, partners, voucherLines, vouchers } from "@/server/db/schema";

export const JOURNAL_PAGE_SIZE = 100;

export type JournalEntry = {
  voucherId: string;
  date: string;
  no: number;
  description: string;
  lines: { code: string; name: string; side: Side; amount: number; partnerName: string | null; description: string }[];
};

/** Posted-voucher and site/department conditions shared by the ledger queries. */
function scope(f: { siteId: number | null; departmentId: number | null }): (SQL | undefined)[] {
  return [
    inArray(vouchers.status, [...POSTED_STATUSES]),
    f.siteId === null ? undefined : eq(voucherLines.siteId, f.siteId),
    f.departmentId === null ? undefined : eq(voucherLines.departmentId, f.departmentId),
  ];
}

const debitSum = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'debit' then ${voucherLines.amount} else 0 end), 0)::bigint`;
const creditSum = sql<number>`coalesce(sum(case when ${voucherLines.side} = 'credit' then ${voucherLines.amount} else 0 end), 0)::bigint`;

/** 분개장. `page` is 1-based; `null` returns every entry (exports). */
export async function getJournal(
  db: Db,
  f: ReportFilter,
  page: number | null,
): Promise<{ entries: JournalEntry[]; total: number; debitSum: number; creditSum: number }> {
  const where = and(...scope(f), gte(vouchers.date, f.from), lte(vouchers.date, f.to));

  const [sums] = await db
    .select({ total: sql<number>`count(distinct ${vouchers.id})::int`, debit: debitSum, credit: creditSum })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(where);

  const base = db
    .selectDistinct({ id: vouchers.id, date: vouchers.date, no: vouchers.no, description: vouchers.description })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(where)
    .orderBy(asc(vouchers.date), asc(vouchers.no))
    .$dynamic();
  const heads =
    page === null ? await base : await base.limit(JOURNAL_PAGE_SIZE).offset((Math.max(1, page) - 1) * JOURNAL_PAGE_SIZE);

  const entries: JournalEntry[] = heads.map((h) => ({
    voucherId: h.id,
    date: h.date,
    no: h.no,
    description: h.description,
    lines: [],
  }));
  if (heads.length > 0) {
    const byId = new Map(entries.map((e) => [e.voucherId, e]));
    const rows = await db
      .select({
        voucherId: voucherLines.voucherId,
        code: accounts.code,
        name: accounts.name,
        side: voucherLines.side,
        amount: voucherLines.amount,
        partnerName: partners.name,
        description: voucherLines.description,
      })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
      .leftJoin(partners, eq(partners.id, voucherLines.partnerId))
      .where(and(...scope(f), inArray(voucherLines.voucherId, heads.map((h) => h.id))))
      .orderBy(asc(voucherLines.voucherId), asc(voucherLines.lineNo));
    for (const r of rows) {
      byId.get(r.voucherId)?.lines.push({
        code: r.code,
        name: r.name,
        side: r.side,
        amount: r.amount,
        partnerName: r.partnerName,
        description: r.description,
      });
    }
  }
  return { entries, total: Number(sums.total), debitSum: Number(sums.debit), creditSum: Number(sums.credit) };
}

export type LedgerRow =
  | { kind: "opening"; balance: number }
  | {
      kind: "line";
      voucherId: string;
      date: string;
      no: number;
      description: string;
      partnerName: string | null;
      debit: number;
      credit: number;
      balance: number;
    }
  | { kind: "month"; month: string; debit: number; credit: number }
  | { kind: "cumulative"; debit: number; credit: number };

/** 계정별 원장: full ledger with running balance, 월계 and 누계. `null` for an unknown account. */
export async function getAccountLedger(
  db: Db,
  accountId: number,
  f: ReportFilter,
  opts: { partnerId?: number | null } = {},
): Promise<{ account: AccountRow; rows: LedgerRow[]; closing: number } | null> {
  const account = (await listAccounts(db)).find((a) => a.id === accountId);
  if (!account) return null;
  const company = await getCompany(db);
  const sign = normalSideOf(account.group) === "debit" ? 1 : -1;
  const openFrom = isPnlGroup(account.group) ? fiscalYearStart(f.from, company.fiscalYearStartMonth) : null;
  const partnerCond = opts.partnerId == null ? undefined : eq(voucherLines.partnerId, opts.partnerId);
  const common = [...scope(f), eq(voucherLines.accountId, accountId), partnerCond];

  const [open] = await db
    .select({ debit: debitSum, credit: creditSum })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(and(...common, openFrom === null ? undefined : gte(vouchers.date, openFrom), lt(vouchers.date, f.from)));
  const opening = sign * (Number(open.debit) - Number(open.credit));

  const lines = await db
    .select({
      voucherId: vouchers.id,
      date: vouchers.date,
      no: vouchers.no,
      description: voucherLines.description,
      voucherDescription: vouchers.description,
      partnerName: partners.name,
      side: voucherLines.side,
      amount: voucherLines.amount,
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .leftJoin(partners, eq(partners.id, voucherLines.partnerId))
    .where(and(...common, gte(vouchers.date, f.from), lte(vouchers.date, f.to)))
    .orderBy(asc(vouchers.date), asc(vouchers.no), asc(voucherLines.lineNo));

  const rows: LedgerRow[] = [{ kind: "opening", balance: opening }];
  let balance = opening;
  let cumDebit = 0;
  let cumCredit = 0;
  let monthDebit = 0;
  let monthCredit = 0;
  lines.forEach((l, i) => {
    const debit = l.side === "debit" ? l.amount : 0;
    const credit = l.side === "credit" ? l.amount : 0;
    balance += sign * (debit - credit);
    monthDebit += debit;
    monthCredit += credit;
    cumDebit += debit;
    cumCredit += credit;
    rows.push({
      kind: "line",
      voucherId: l.voucherId,
      date: l.date,
      no: l.no,
      description: l.description || l.voucherDescription,
      partnerName: l.partnerName,
      debit,
      credit,
      balance,
    });
    const month = l.date.slice(0, 7);
    if (i === lines.length - 1 || lines[i + 1].date.slice(0, 7) !== month) {
      rows.push({ kind: "month", month, debit: monthDebit, credit: monthCredit });
      rows.push({ kind: "cumulative", debit: cumDebit, credit: cumCredit });
      monthDebit = 0;
      monthCredit = 0;
    }
  });
  return { account, rows, closing: balance };
}
