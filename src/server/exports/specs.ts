import { hiddenPayrollNotice } from "@/lib/reports/hidden-payroll";
import { first, parseReportParams, type SearchParams } from "@/lib/reports/params";
import type { StatementLine } from "@/lib/reports/statements";
import type { ReportFilter } from "@/lib/reports/types";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { formatVoucherNo } from "@/lib/vouchers/types";
import { getAccountById } from "@/server/accounts/service";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { listPartnersByIds } from "@/server/partners/service";
import {
  countHiddenPayroll,
  getAccountLedger,
  getJournal,
  getPartnerSummary,
  type LedgerRow,
} from "@/server/reports/ledgers";
import { getBalanceSheet, getIncomeStatement, getTrialBalance } from "@/server/reports/service";
import { listDepartments, listSites } from "@/server/sites/service";
import type { Permission } from "@/lib/permissions";
import { listCardPurchases, listTaxInvoices, type TaxInvoiceRow } from "./tax-lists";
import type { SheetColumn, SheetSpec } from "./xlsx";

export type ReportKey =
  | "journal"
  | "account-ledger"
  | "partner-ledger"
  | "trial-balance"
  | "income-statement"
  | "balance-sheet";

export const REPORT_KEYS: readonly ReportKey[] = [
  "journal",
  "account-ledger",
  "partner-ledger",
  "trial-balance",
  "income-statement",
  "balance-sheet",
];

type Row = Record<string, string | number | null>;

const toId = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** "사업장: x" / "부서: y" lines for the active filters. */
async function filterLines(db: Db, f: ReportFilter): Promise<string[]> {
  const out: string[] = [];
  if (f.siteId !== null) {
    const site = (await listSites(db)).find((s) => s.id === f.siteId);
    if (site) out.push(`사업장: ${site.name}`);
  }
  if (f.departmentId !== null) {
    const dept = (await listDepartments(db)).find((d) => d.id === f.departmentId);
    if (dept) out.push(`부서: ${dept.name}`);
  }
  return out;
}

const period = (f: ReportFilter) => `기간: ${f.from} ~ ${f.to}`;
const asOfText = (f: ReportFilter) => `기준일: ${f.to}`;

const ledgerColumns: SheetColumn[] = [
  { header: "일자", key: "date", width: 12 },
  { header: "전표번호", key: "no", width: 14 },
  { header: "적요", key: "description", width: 32 },
  { header: "거래처", key: "partner", width: 20 },
  { header: "차변", key: "debit", width: 14, money: true },
  { header: "대변", key: "credit", width: 14, money: true },
  { header: "잔액", key: "balance", width: 14, money: true },
];

function ledgerRows(ledger: LedgerRow[]): { rows: Row[]; emphasis: number[] } {
  const rows: Row[] = [];
  const emphasis: number[] = [];
  const blank = { date: null, no: null, partner: null };
  for (const r of ledger) {
    switch (r.kind) {
      case "opening":
        emphasis.push(rows.length);
        rows.push({ ...blank, description: "이월", debit: null, credit: null, balance: r.balance });
        break;
      case "line":
        rows.push({
          date: r.date,
          no: formatVoucherNo(r.date, r.no),
          description: r.description,
          partner: r.partnerName,
          debit: r.debit || null,
          credit: r.credit || null,
          balance: r.balance,
        });
        break;
      case "month":
        emphasis.push(rows.length);
        rows.push({ ...blank, description: `월계 (${r.month})`, debit: r.debit, credit: r.credit, balance: null });
        break;
      case "cumulative":
        emphasis.push(rows.length);
        rows.push({ ...blank, description: "누계", debit: r.debit, credit: r.credit, balance: null });
        break;
    }
  }
  return { rows, emphasis };
}

function statementRows(lines: StatementLine[]): { rows: Row[]; emphasis: number[] } {
  const rows: Row[] = [];
  const emphasis: number[] = [];
  for (const l of lines) {
    if (l.kind === "account") {
      rows.push({ name: `    ${l.code} ${l.name}`, amount: l.amount, prior: l.prior });
    } else {
      emphasis.push(rows.length);
      rows.push({ name: l.label, amount: l.amount, prior: l.prior });
    }
  }
  return { rows, emphasis };
}

type TbAmounts = { debitBalance: number; debitTotal: number; creditTotal: number; creditBalance: number };
const tbAmounts = (a: TbAmounts): TbAmounts => ({
  debitBalance: a.debitBalance,
  debitTotal: a.debitTotal,
  creditTotal: a.creditTotal,
  creditBalance: a.creditBalance,
});

/** The hidden-payroll notice as a meta line, when the ledger left any out. */
async function hiddenLines(
  db: Db,
  f: ReportFilter,
  opts: { accountId?: number; partnerId?: number | null } = {},
): Promise<string[]> {
  const n = await countHiddenPayroll(db, f, opts);
  return n > 0 ? [hiddenPayrollNotice(n)] : [];
}

/**
 * Builds the worksheet for one report from the same services the pages use; `null` when it cannot be built.
 * `hidePayroll` comes from the requesting user (`!can(role, "payroll:manage")`) and only affects the ledgers.
 */
export async function buildSheetSpec(
  db: Db,
  report: ReportKey,
  sp: SearchParams,
  opts: { hidePayroll: boolean },
): Promise<SheetSpec | null> {
  const company = await getCompany(db);
  const f = parseReportParams(sp, todayInSeoul(), company.fiscalYearStartMonth, opts);
  const filters = await filterLines(db, f);

  switch (report) {
    case "journal": {
      const j = await getJournal(db, f, null);
      const rows: Row[] = [];
      const emphasis: number[] = [];
      for (const e of j.entries) {
        emphasis.push(rows.length);
        rows.push({
          date: e.date,
          no: formatVoucherNo(e.date, e.no),
          account: null,
          partner: null,
          description: e.description,
          debit: null,
          credit: null,
        });
        for (const l of e.lines) {
          rows.push({
            date: null,
            no: null,
            account: `${l.code} ${l.name}`,
            partner: l.partnerName,
            description: l.description,
            debit: l.side === "debit" ? l.amount : null,
            credit: l.side === "credit" ? l.amount : null,
          });
        }
      }
      emphasis.push(rows.length);
      rows.push({
        date: null,
        no: null,
        account: null,
        partner: null,
        description: "합계",
        debit: j.debitSum,
        credit: j.creditSum,
      });
      return {
        fileName: `분개장_${f.from}_${f.to}`,
        title: "분개장",
        meta: [company.name, period(f), ...filters, ...(await hiddenLines(db, f))],
        columns: [
          { header: "일자", key: "date", width: 12 },
          { header: "전표번호", key: "no", width: 14 },
          { header: "계정과목", key: "account", width: 26 },
          { header: "거래처", key: "partner", width: 20 },
          { header: "적요", key: "description", width: 32 },
          { header: "차변", key: "debit", width: 14, money: true },
          { header: "대변", key: "credit", width: 14, money: true },
        ],
        rows,
        emphasis,
      };
    }
    case "account-ledger": {
      const accountId = toId(first(sp.account));
      if (accountId === null) return null;
      const ledger = await getAccountLedger(db, accountId, f);
      if (!ledger) return null;
      const { rows, emphasis } = ledgerRows(ledger.rows);
      const { code, name } = ledger.account;
      return {
        fileName: `계정별원장_${code}${name}_${f.from}_${f.to}`,
        title: "계정별 원장",
        meta: [
          company.name,
          `계정과목: ${code} ${name}`,
          period(f),
          ...filters,
          ...(await hiddenLines(db, f, { accountId })),
        ],
        columns: ledgerColumns,
        rows,
        emphasis,
      };
    }
    case "partner-ledger": {
      const accountId = toId(first(sp.account));
      if (accountId === null) return null;
      const account = await getAccountById(db, accountId);
      if (!account) return null;
      const partnerId = toId(first(sp.partner));
      const accountMeta = `계정과목: ${account.code} ${account.name}`;
      if (partnerId !== null) {
        const ledger = await getAccountLedger(db, accountId, f, { partnerId });
        if (!ledger) return null;
        const partnerName = (await listPartnersByIds(db, [partnerId]))[0]?.name ?? "";
        const { rows, emphasis } = ledgerRows(ledger.rows);
        return {
          fileName: `거래처별원장_${account.code}${account.name}${partnerName}_${f.from}_${f.to}`,
          title: "거래처별 원장",
          meta: [
            company.name,
            accountMeta,
            `거래처: ${partnerName}`,
            period(f),
            ...filters,
            ...(await hiddenLines(db, f, { accountId, partnerId })),
          ],
          columns: ledgerColumns,
          rows,
          emphasis,
        };
      }
      const summary = await getPartnerSummary(db, accountId, f);
      const rows: Row[] = summary.map((r) => ({
        partner: r.partnerName,
        opening: r.opening,
        debit: r.debit,
        credit: r.credit,
        closing: r.closing,
      }));
      const sum = (k: "opening" | "debit" | "credit" | "closing") => summary.reduce((s, r) => s + r[k], 0);
      rows.push({
        partner: "합계",
        opening: sum("opening"),
        debit: sum("debit"),
        credit: sum("credit"),
        closing: sum("closing"),
      });
      return {
        fileName: `거래처별원장_${account.code}${account.name}_${f.from}_${f.to}`,
        title: "거래처별 원장",
        meta: [company.name, accountMeta, period(f), ...filters, ...(await hiddenLines(db, f, { accountId }))],
        columns: [
          { header: "거래처", key: "partner", width: 28 },
          { header: "이월", key: "opening", width: 14, money: true },
          { header: "차변", key: "debit", width: 14, money: true },
          { header: "대변", key: "credit", width: 14, money: true },
          { header: "잔액", key: "closing", width: 14, money: true },
        ],
        rows,
        emphasis: [rows.length - 1],
      };
    }
    case "trial-balance": {
      const tb = await getTrialBalance(db, f);
      const rows: Row[] = [];
      const emphasis: number[] = [];
      for (const r of tb.rows) {
        if (r.kind === "group") {
          emphasis.push(rows.length);
          rows.push({ name: r.label, debitBalance: null, debitTotal: null, creditTotal: null, creditBalance: null });
        } else if (r.kind === "subtotal") {
          emphasis.push(rows.length);
          rows.push({ name: r.label, ...tbAmounts(r) });
        } else if (r.kind === "account") {
          rows.push({ name: `${r.code} ${r.name}`, ...tbAmounts(r) });
        } else {
          rows.push({ name: r.name, ...tbAmounts(r) });
        }
      }
      emphasis.push(rows.length);
      rows.push({ name: "합계", ...tbAmounts(tb.total) });
      return {
        fileName: `합계잔액시산표_${tb.asOf}`,
        title: "합계잔액시산표",
        meta: [company.name, asOfText(f), ...filters],
        columns: [
          { header: "차변 잔액", key: "debitBalance", width: 16, money: true },
          { header: "차변 합계", key: "debitTotal", width: 16, money: true },
          { header: "계정과목", key: "name", width: 30 },
          { header: "대변 합계", key: "creditTotal", width: 16, money: true },
          { header: "대변 잔액", key: "creditBalance", width: 16, money: true },
        ],
        rows,
        emphasis,
      };
    }
    case "income-statement": {
      const is = await getIncomeStatement(db, f);
      const { rows, emphasis } = statementRows(is.lines);
      return {
        fileName: `손익계산서_${f.from}_${f.to}`,
        title: "손익계산서",
        meta: [company.name, period(f), ...filters],
        columns: [
          { header: "과목", key: "name", width: 34 },
          { header: `당기 (${is.period.from} ~ ${is.period.to})`, key: "amount", width: 24, money: true },
          { header: `전기 (${is.priorPeriod.from} ~ ${is.priorPeriod.to})`, key: "prior", width: 24, money: true },
        ],
        rows,
        emphasis,
      };
    }
    case "balance-sheet": {
      const bs = await getBalanceSheet(db, f);
      const { rows, emphasis } = statementRows(bs.lines);
      return {
        fileName: `재무상태표_${bs.asOf}`,
        title: "재무상태표",
        meta: [company.name, asOfText(f), ...filters],
        columns: [
          { header: "과목", key: "name", width: 34 },
          { header: `당기 (${bs.asOf})`, key: "amount", width: 20, money: true },
          { header: `전기말 (${bs.priorAsOf})`, key: "prior", width: 20, money: true },
        ],
        rows,
        emphasis,
      };
    }
  }
}

export type TaxListKey = "tax-invoices" | "card-purchases";
export const TAX_LIST_KEYS: readonly TaxListKey[] = ["tax-invoices", "card-purchases"];

/** The 급여 대장 of one run (`?run=<id>`). */
export const PAYROLL_RUN_KEY = "payroll-run";

/**
 * Permission an export key needs: tax lists are `export:tax`, the 급여 대장 `payroll:manage`, the
 * 1C reports `ledger:view`.
 */
export function exportPermission(key: string): Permission {
  if (key === PAYROLL_RUN_KEY) return "payroll:manage";
  return (TAX_LIST_KEYS as readonly string[]).includes(key) ? "export:tax" : "ledger:view";
}

const sumOf = (rows: { supplyAmount: number; vatAmount: number }[]) => ({
  supplyAmount: rows.reduce((s, r) => s + r.supplyAmount, 0),
  vatAmount: rows.reduce((s, r) => s + r.vatAmount, 0),
});

function taxInvoiceSheet(title: "매출" | "매입", rows: TaxInvoiceRow[], meta: string[], fileName: string): SheetSpec {
  const mine = rows.filter((r) => r.direction === title);
  const t = sumOf(mine);
  return {
    fileName,
    title,
    meta,
    columns: [
      { header: "일자", key: "date", width: 12 },
      { header: "전표번호", key: "voucherNo", width: 14 },
      { header: "구분", key: "evidence", width: 12 },
      { header: "거래처", key: "partnerName", width: 26 },
      { header: "사업자등록번호", key: "businessNumber", width: 16 },
      { header: "공급가액", key: "supplyAmount", width: 14, money: true },
      { header: "부가세", key: "vatAmount", width: 14, money: true },
      { header: "합계", key: "total", width: 14, money: true },
      { header: "승인번호", key: "approvalNo", width: 28 },
      { header: "사업장", key: "siteName", width: 14 },
    ],
    rows: [
      ...mine.map((r): Row => ({ ...r })),
      { partnerName: "합계", ...t, total: t.supplyAmount + t.vatAmount },
    ],
    emphasis: [mine.length],
  };
}

/** Worksheets of a tax list for the 세무사 (posted vouchers only); the file name is `specs[0].fileName`. */
export async function buildTaxListSpecs(db: Db, key: TaxListKey, from: string, to: string): Promise<SheetSpec[]> {
  const company = await getCompany(db);
  const meta = [company.name, `기간: ${from} ~ ${to}`];
  if (key === "tax-invoices") {
    const rows = await listTaxInvoices(db, from, to);
    const fileName = `세금계산서_${from}_${to}`;
    return [taxInvoiceSheet("매출", rows, meta, fileName), taxInvoiceSheet("매입", rows, meta, fileName)];
  }
  const rows = await listCardPurchases(db, from, to);
  const t = sumOf(rows);
  return [
    {
      fileName: `카드·현금영수증 매입_${from}_${to}`,
      title: "카드·현금영수증 매입",
      meta,
      columns: [
        { header: "일자", key: "date", width: 12 },
        { header: "전표번호", key: "voucherNo", width: 14 },
        { header: "구분", key: "evidence", width: 12 },
        { header: "가맹점", key: "merchantName", width: 26 },
        { header: "사업자등록번호", key: "merchantBusinessNumber", width: 16 },
        { header: "공급가액", key: "supplyAmount", width: 14, money: true },
        { header: "부가세", key: "vatAmount", width: 14, money: true },
        { header: "공제", key: "deductible", width: 10 },
        { header: "카드번호", key: "cardNo", width: 22 },
        { header: "적요", key: "description", width: 30 },
        { header: "사업장", key: "siteName", width: 14 },
      ],
      rows: [
        ...rows.map((r): Row => ({ ...r, deductible: r.deductible ? "공제" : "불공제" })),
        { merchantName: "합계", ...t },
      ],
      emphasis: [rows.length],
    },
  ];
}
