import { and, asc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { isPnlGroup, normalSideOf } from "@/lib/accounts";
import { fiscalYearStart } from "@/lib/reports/fiscal";
import type { ReportFilter } from "@/lib/reports/types";
import { POSTED_STATUSES, type Side } from "@/lib/vouchers/types";
import { getAccountById, type AccountRow } from "@/server/accounts/service";
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
  const lastPage = Math.max(1, Math.ceil(Number(sums.total) / JOURNAL_PAGE_SIZE));
  const heads =
    page === null
      ? await base
      : await base.limit(JOURNAL_PAGE_SIZE).offset((Math.min(Math.max(1, page), lastPage) - 1) * JOURNAL_PAGE_SIZE);

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

export const LEDGER_PAGE_SIZE = 1000;

export type AccountLedger = {
  account: AccountRow;
  rows: LedgerRow[];
  /** Balance after the last returned line (the period closing when unpaged or on the last page). */
  closing: number;
  /** Lines in the whole period (all pages). */
  totalLines: number;
  /** 1-based page, or null for the full ledger. */
  page: number | null;
  pages: number;
  /** P&L accounts are read one fiscal year at a time: the new `from` (fiscal year start) when it was moved up, else null. */
  clampedFrom: string | null;
};

/** P&L ranges never span fiscal years: `from` moves up to the fiscal year start of `to`. */
function clampPnl(f: ReportFilter, startMonth: number): { f: ReportFilter; clampedFrom: string | null } {
  const start = fiscalYearStart(f.to, startMonth);
  return f.from < start ? { f: { ...f, from: start }, clampedFrom: start } : { f, clampedFrom: null };
}

/**
 * 계정별 원장 with running balance, 월계 and 누계. `null` for an unknown account.
 * Without `opts.page` it returns the full ledger (exports). With `opts.page` (1-based) it returns
 * `opts.pageSize` lines (default LEDGER_PAGE_SIZE; pages past the end are clamped to the last); the opening row carries the balance brought forward from earlier pages,
 * and 월계/누계 rows cover the whole month and period, emitted on the page where the month ends.
 */
export async function getAccountLedger(
  db: Db,
  accountId: number,
  filter: ReportFilter,
  opts: { partnerId?: number | null; page?: number | null; pageSize?: number } = {},
): Promise<AccountLedger | null> {
  const account = await getAccountById(db, accountId);
  if (!account) return null;
  const company = await getCompany(db);
  const sign = normalSideOf(account.group) === "debit" ? 1 : -1;
  const pnl = isPnlGroup(account.group);
  const { f, clampedFrom } = pnl ? clampPnl(filter, company.fiscalYearStartMonth) : { f: filter, clampedFrom: null };
  const openFrom = pnl ? fiscalYearStart(f.from, company.fiscalYearStartMonth) : null;
  const partnerCond = opts.partnerId == null ? undefined : eq(voucherLines.partnerId, opts.partnerId);
  const common = [...scope(f), eq(voucherLines.accountId, accountId), partnerCond];
  const inPeriod = and(...common, gte(vouchers.date, f.from), lte(vouchers.date, f.to));
  const order = [asc(vouchers.date), asc(vouchers.no), asc(voucherLines.lineNo)];
  let page = opts.page != null ? Math.max(1, Math.floor(opts.page!)) : null;
  const size = opts.pageSize ?? LEDGER_PAGE_SIZE;

  const [open] = await db
    .select({ debit: debitSum, credit: creditSum })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(and(...common, openFrom === null ? undefined : gte(vouchers.date, openFrom), lt(vouchers.date, f.from)));
  let balance = sign * (Number(open.debit) - Number(open.credit));

  const query = db
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
    .where(inPeriod)
    .orderBy(...order)
    .$dynamic();

  let lines: Awaited<typeof query>;
  let totalLines: number;
  let cumDebit = 0;
  let cumCredit = 0;
  let monthDebit = 0;
  let monthCredit = 0;
  /** Month of the first line after this page, when the page ends mid-month. */
  let continuesInto: string | null = null;
  if (page === null) {
    lines = await query;
    totalLines = lines.length;
  } else {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .where(inPeriod);
    totalLines = Number(count.n);
    // Out-of-range pages show the last page.
    page = Math.min(page, Math.max(1, Math.ceil(totalLines / size)));
    const offset = (page - 1) * size;
    const [fetched, prefix] = await Promise.all([
      // One extra line tells whether the last month continues on the next page.
      query.limit(size + 1).offset(offset),
      offset === 0 ? Promise.resolve([]) : ledgerPrefixByMonth(db, inPeriod, order, offset),
    ]);
    lines = fetched.slice(0, size);
    if (fetched.length > size) continuesInto = fetched[size].date.slice(0, 7);
    const firstMonth = lines[0]?.date.slice(0, 7);
    for (const m of prefix) {
      const d = Number(m.debit);
      const c = Number(m.credit);
      balance += sign * (d - c);
      cumDebit += d;
      cumCredit += c;
      if (m.month === firstMonth) {
        monthDebit = d;
        monthCredit = c;
      }
    }
  }

  const rows: LedgerRow[] = [{ kind: "opening", balance }];
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
    const next = i === lines.length - 1 ? continuesInto : lines[i + 1].date.slice(0, 7);
    if (next !== month) {
      rows.push({ kind: "month", month, debit: monthDebit, credit: monthCredit });
      rows.push({ kind: "cumulative", debit: cumDebit, credit: cumCredit });
      monthDebit = 0;
      monthCredit = 0;
    }
  });
  const pages = page === null ? 1 : Math.max(1, Math.ceil(totalLines / size));
  return { account, rows, closing: balance, totalLines, page, pages, clampedFrom };
}

/** Debit/credit per month over the first `n` ledger lines (the pages before the current one). */
async function ledgerPrefixByMonth(db: Db, where: SQL | undefined, order: SQL[], n: number) {
  const prefix = db
    .select({ date: vouchers.date, side: voucherLines.side, amount: voucherLines.amount })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(where)
    .orderBy(...order)
    .limit(n)
    .as("prefix");
  return db
    .select({
      month: sql<string>`to_char(${prefix.date}::date, 'YYYY-MM')`,
      debit: sql<number>`coalesce(sum(case when ${prefix.side} = 'debit' then ${prefix.amount} else 0 end), 0)::bigint`,
      credit: sql<number>`coalesce(sum(case when ${prefix.side} = 'credit' then ${prefix.amount} else 0 end), 0)::bigint`,
    })
    .from(prefix)
    .groupBy(sql`1`);
}

export type PartnerSummaryRow = {
  partnerId: number | null;
  /** "(거래처 없음)" for lines without a partner. */
  partnerName: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export const NO_PARTNER_LABEL = "(거래처 없음)";

/** 거래처별 원장 summary for one account: one aggregate query, grouped by partner. */
export async function getPartnerSummary(db: Db, accountId: number, filter: ReportFilter): Promise<PartnerSummaryRow[]> {
  const account = await getAccountById(db, accountId);
  if (!account) return [];
  const company = await getCompany(db);
  const sign = normalSideOf(account.group) === "debit" ? 1 : -1;
  const pnl = isPnlGroup(account.group);
  const f = pnl ? clampPnl(filter, company.fiscalYearStartMonth).f : filter;
  const openFrom = pnl ? fiscalYearStart(f.from, company.fiscalYearStartMonth) : null;

  const before = sql`${vouchers.date} < ${f.from}${openFrom === null ? sql`` : sql` and ${vouchers.date} >= ${openFrom}`}`;
  const inPeriod = sql`${vouchers.date} >= ${f.from} and ${vouchers.date} <= ${f.to}`;
  const sumWhen = (cond: SQL, side: "debit" | "credit") =>
    sql<number>`coalesce(sum(case when ${cond} and ${voucherLines.side} = ${side} then ${voucherLines.amount} else 0 end), 0)::bigint`;

  const grouped = await db
    .select({
      partnerId: voucherLines.partnerId,
      partnerName: partners.name,
      openDebit: sumWhen(before, "debit"),
      openCredit: sumWhen(before, "credit"),
      debit: sumWhen(inPeriod, "debit"),
      credit: sumWhen(inPeriod, "credit"),
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .leftJoin(partners, eq(partners.id, voucherLines.partnerId))
    .where(and(...scope(f), eq(voucherLines.accountId, accountId), lte(vouchers.date, f.to)))
    .groupBy(voucherLines.partnerId, partners.name);

  const rows = grouped
    .map((g): PartnerSummaryRow => {
      const opening = sign * (Number(g.openDebit) - Number(g.openCredit));
      const debit = Number(g.debit);
      const credit = Number(g.credit);
      return {
        partnerId: g.partnerId,
        partnerName: g.partnerId === null ? NO_PARTNER_LABEL : (g.partnerName ?? ""),
        opening,
        debit,
        credit,
        closing: opening + sign * (debit - credit),
      };
    })
    .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0);
  return rows.sort((a, b) => {
    if ((a.partnerId === null) !== (b.partnerId === null)) return a.partnerId === null ? 1 : -1;
    return a.partnerName.localeCompare(b.partnerName, "ko");
  });
}
