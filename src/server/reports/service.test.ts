import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, sites, users } from "@/server/db/schema";
import { createSite } from "@/server/sites/service";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { priorYearPeriod } from "@/lib/reports/fiscal";
import type { StatementLine } from "@/lib/reports/statements";
import { updateAccount } from "@/server/accounts/service";
import { partners } from "@/server/db/schema";
import { getAccountLedger, getPartnerSummary } from "./ledgers";
import { getBalanceSheet, getIncomeStatement, getTrialBalance } from "./service";

const db = getTestDb();
let staff: SessionUser;
let acc: Record<string, number>;
let siteId: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "s", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: u.id, email: "s@test.kr", name: "s", role: "staff" };
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, fiscalYearStartMonth: 1, approvalRequired: false }, u.id);
  if (!r.ok) throw new Error(r.error);
});

const line = (code: string, side: LineInput["side"], amount: number, sid = siteId): LineInput => ({
  accountId: acc[code], side, amount, partnerId: null, siteId: sid, departmentId: null, description: "",
});
async function create(date: string, lines: LineInput[]) {
  const input: VoucherInput = {
    date, description: "t", entryType: "general", kind: "general", partnerId: null, evidenceType: "none",
    vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null, lines,
  };
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
}
const f = (to: string, site: number | null = null) => ({ from: "2000-01-01", to, siteId: site, departmentId: null });
const acct = (tb: Awaited<ReturnType<typeof getTrialBalance>>, code: string) =>
  tb.rows.find((r) => r.kind === "account" && r.code === code);

describe("getTrialBalance", () => {
  it("last year's expense goes to priorProfit, not P&L rows", async () => {
    await create("2025-06-01", [line("811", "debit", 400), line("101", "credit", 400)]);
    const tb = await getTrialBalance(db, f("2026-03-01"));
    expect(tb.fiscalStart).toBe("2026-01-01");
    expect(tb.asOf).toBe("2026-03-01");
    expect(acct(tb, "811")).toBeUndefined();
    expect(acct(tb, "101")).toMatchObject({ creditBalance: 400 });
    expect(tb.rows.find((r) => r.kind === "auto")).toMatchObject({ debitBalance: 400 });
    expect(tb.balanced).toBe(true);
  });

  it("last year's 101 voucher stays in the balance sheet totals", async () => {
    await create("2025-06-01", [line("101", "debit", 900), line("331", "credit", 900)]);
    const tb = await getTrialBalance(db, f("2026-03-01"));
    expect(acct(tb, "101")).toMatchObject({ debitBalance: 900 });
    expect(tb.rows.some((r) => r.kind === "auto")).toBe(false);
  });

  it("current-year P&L appears as an account row", async () => {
    await create("2026-02-01", [line("811", "debit", 400), line("101", "credit", 400)]);
    const tb = await getTrialBalance(db, f("2026-03-01"));
    expect(acct(tb, "811")).toMatchObject({ debitBalance: 400 });
    expect(tb.rows.some((r) => r.kind === "auto")).toBe(false);
  });

  it("filtered trial balance can be unbalanced", async () => {
    const r = await createSite(db, { name: "B", businessNumber: null });
    if (!r.ok) throw new Error(r.error);
    await create("2026-02-01", [line("811", "debit", 700, siteId), line("101", "credit", 700, r.value.id)]);
    const tb = await getTrialBalance(db, f("2026-03-01", siteId));
    expect(tb.balanced).toBe(false);
    expect(tb.total.debitTotal).toBe(700);
    expect(tb.total.creditTotal).toBe(0);
  });
});

const key = (lines: StatementLine[], k: string) =>
  lines.find((l) => (l.kind === "section" || l.kind === "computed") && l.key === k);
const row = (lines: StatementLine[], name: string) =>
  lines.find((l) => l.kind === "account" && (l.code === name || l.name === name));
const setStartMonth = async (m: number) => {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, fiscalYearStartMonth: m }, staff.id);
  if (!r.ok) throw new Error(r.error);
};

describe("fiscal-year boundary (start month 1)", () => {
  beforeEach(async () => {
    await create("2025-12-31", [line("811", "debit", 100), line("101", "credit", 100)]);
    await create("2026-01-01", [line("101", "debit", 2000), line("401", "credit", 2000)]);
  });

  it("trial balance: 12-31 is prior-years profit, 01-01 is current P&L", async () => {
    const tb = await getTrialBalance(db, f("2026-01-01"));
    expect(tb.fiscalStart).toBe("2026-01-01");
    expect(acct(tb, "811")).toBeUndefined();
    expect(acct(tb, "401")).toMatchObject({ creditBalance: 2000 });
    expect(tb.rows.find((r) => r.kind === "auto")).toMatchObject({ debitBalance: 100 });
  });

  it("balance sheet: 12-31 is prior-years profit, 01-01 is current profit", async () => {
    const bs = await getBalanceSheet(db, f("2026-01-01"));
    expect(bs.priorAsOf).toBe("2025-12-31");
    expect(row(bs.lines, "이월이익잉여금(전기 손익)")).toMatchObject({ amount: -100, prior: 0 });
    expect(row(bs.lines, "당기순이익")).toMatchObject({ amount: 2000, prior: -100 });
    expect(key(bs.lines, "total_assets")).toMatchObject({ amount: 1900, prior: -100 });
    expect(key(bs.lines, "total_liabilities_equity")).toMatchObject({ amount: 1900, prior: -100 });
  });
});

describe("hidden accounts with activity", () => {
  it("still appear in the trial balance and the income statement", async () => {
    await create("2026-02-01", [line("812", "debit", 300), line("101", "credit", 300)]);
    const r = await updateAccount(db, acc["812"], { isActive: false });
    if (!r.ok) throw new Error(r.error);
    const tb = await getTrialBalance(db, f("2026-03-01"));
    expect(acct(tb, "812")).toMatchObject({ debitBalance: 300 });
    const is = await getIncomeStatement(db, { ...f("2026-03-01"), from: "2026-01-01" });
    expect(row(is.lines, "812")).toMatchObject({ amount: 300 });
  });
});

describe("getIncomeStatement", () => {
  it("current and prior period columns; prior period is priorYearPeriod", async () => {
    await create("2025-02-15", [line("101", "debit", 700), line("401", "credit", 700)]);
    await create("2025-03-31", [line("811", "debit", 999), line("101", "credit", 999)]); // outside prior period
    await create("2026-02-10", [line("101", "debit", 5000), line("401", "credit", 5000)]);
    await create("2026-03-01", [line("811", "debit", 1200), line("101", "credit", 1200)]);
    await create("2026-03-02", [line("811", "debit", 50), line("101", "credit", 50)]); // after period
    const filter = { from: "2026-02-01", to: "2026-03-01", siteId: null, departmentId: null };
    const is = await getIncomeStatement(db, filter);
    expect(is.period).toEqual({ from: "2026-02-01", to: "2026-03-01" });
    expect(is.priorPeriod).toEqual(priorYearPeriod(filter));
    expect(is.priorPeriod).toEqual({ from: "2025-02-01", to: "2025-03-01" });
    expect(row(is.lines, "401")).toMatchObject({ amount: 5000, prior: 700 });
    expect(row(is.lines, "811")).toMatchObject({ amount: 1200, prior: 0 });
    expect(key(is.lines, "net")).toMatchObject({ amount: 3800, prior: 700 });
  });

  it("applies the site filter to lines", async () => {
    const r = await createSite(db, { name: "B", businessNumber: null });
    if (!r.ok) throw new Error(r.error);
    await create("2026-02-01", [line("101", "debit", 900, r.value.id), line("401", "credit", 900, siteId)]);
    const is = await getIncomeStatement(db, { from: "2026-01-01", to: "2026-03-01", siteId: r.value.id, departmentId: null });
    expect(row(is.lines, "401")).toBeUndefined();
    expect(key(is.lines, "net")).toMatchObject({ amount: 0 });
  });
});

describe("getBalanceSheet", () => {
  it("non-January fiscal year: start month 4, as-of 2026-02-10", async () => {
    await setStartMonth(4);
    await create("2024-03-31", [line("101", "debit", 1), line("401", "credit", 1)]); // prior column: prior-years
    await create("2024-04-01", [line("101", "debit", 20), line("401", "credit", 20)]); // prior column: current
    await create("2025-03-31", [line("101", "debit", 300), line("401", "credit", 300)]); // prior column: current
    await create("2025-04-01", [line("101", "debit", 4000), line("401", "credit", 4000)]);
    await create("2026-02-10", [line("101", "debit", 50000), line("401", "credit", 50000)]);
    await create("2026-02-11", [line("101", "debit", 600000), line("401", "credit", 600000)]); // after as-of
    const bs = await getBalanceSheet(db, { from: "2026-01-01", to: "2026-02-10", siteId: null, departmentId: null });
    expect(bs.asOf).toBe("2026-02-10");
    expect(bs.priorAsOf).toBe("2025-03-31");
    expect(row(bs.lines, "이월이익잉여금(전기 손익)")).toMatchObject({ amount: 321, prior: 1 });
    expect(row(bs.lines, "당기순이익")).toMatchObject({ amount: 54000, prior: 320 });
    expect(row(bs.lines, "101")).toMatchObject({ amount: 54321, prior: 321 });
    expect(key(bs.lines, "total_assets")).toMatchObject({ amount: 54321, prior: 321 });
    expect(key(bs.lines, "total_liabilities_equity")).toMatchObject({ amount: 54321, prior: 321 });
  });

  it("balance-sheet accounts accumulate from the beginning of time", async () => {
    await create("2020-05-05", [line("101", "debit", 10000), line("331", "credit", 10000)]);
    await create("2026-02-01", [line("212", "debit", 3000), line("101", "credit", 3000)]);
    const bs = await getBalanceSheet(db, f("2026-03-01"));
    expect(row(bs.lines, "101")).toMatchObject({ amount: 7000, prior: 10000 });
    expect(row(bs.lines, "212")).toMatchObject({ amount: 3000, prior: 0 });
    expect(row(bs.lines, "331")).toMatchObject({ amount: 10000, prior: 10000 });
    expect(key(bs.lines, "total_assets")).toMatchObject({ amount: 10000, prior: 10000 });
    expect(key(bs.lines, "total_liabilities_equity")).toMatchObject({ amount: 10000, prior: 10000 });
  });
});

describe("cross-report consistency", () => {
  it("trial balance, income statement, balance sheet and ledgers agree", async () => {
    const [{ id: pa }, { id: pb }] = await db
      .insert(partners)
      .values([{ name: "가거래처" }, { name: "나거래처" }])
      .returning({ id: partners.id });
    const withP = (l: LineInput, partnerId: number): LineInput => ({ ...l, partnerId });
    await create("2025-03-01", [line("101", "debit", 10_000_000), line("331", "credit", 10_000_000)]); // capital
    await create("2025-06-01", [
      withP(line("108", "debit", 1_100_000), pa),
      line("401", "credit", 1_000_000),
      line("255", "credit", 100_000),
    ]); // prior-year credit sale
    await create("2026-01-15", [line("103", "debit", 2_000_000), line("101", "credit", 2_000_000)]);
    await create("2026-02-01", [
      withP(line("108", "debit", 550_000), pb),
      line("401", "credit", 500_000),
      line("255", "credit", 50_000),
    ]); // credit sale with VAT
    await create("2026-03-01", [line("811", "debit", 200_000), line("101", "credit", 200_000)]); // expense
    await create("2026-04-01", [
      withP(line("108", "credit", 300_000), pa),
      line("101", "debit", 300_000),
    ]); // collection
    await create("2026-05-01", [
      line("401", "debit", 50_000),
      line("255", "debit", 5_000),
      withP(line("108", "credit", 55_000), pb),
    ]); // contra (sales return)

    const asOf = "2026-06-30";
    const fiscalStart = "2026-01-01";
    const tb = await getTrialBalance(db, f(asOf));
    const is = await getIncomeStatement(db, { from: fiscalStart, to: asOf, siteId: null, departmentId: null });
    const bs = await getBalanceSheet(db, f(asOf));

    expect(tb.balanced).toBe(true);
    const net = key(is.lines, "net");
    expect(net).toMatchObject({ amount: 250_000 });
    expect(row(bs.lines, "당기순이익")?.amount).toBe(net?.amount);
    expect(key(bs.lines, "total_assets")?.amount).toBe(key(bs.lines, "total_liabilities_equity")?.amount);

    const auto = tb.rows.find((r) => r.kind === "auto");
    if (!auto || auto.kind !== "auto") throw new Error("no auto row");
    expect(auto.creditBalance - auto.debitBalance).toBe(1_000_000);
    expect(row(bs.lines, "이월이익잉여금(전기 손익)")?.amount).toBe(auto.creditBalance - auto.debitBalance);

    const period = { from: fiscalStart, to: asOf, siteId: null, departmentId: null };
    const l103 = await getAccountLedger(db, acc["103"], period);
    const t103 = acct(tb, "103");
    if (!t103 || t103.kind !== "account") throw new Error("no 103");
    expect(l103!.closing).toBe(t103.debitBalance - t103.creditBalance);
    expect(l103!.closing).toBe(2_000_000);

    const l108 = await getAccountLedger(db, acc["108"], period);
    const sum = await getPartnerSummary(db, acc["108"], period);
    expect(sum.length).toBe(2);
    expect(sum.reduce((a, r) => a + r.closing, 0)).toBe(l108!.closing);
    expect(l108!.closing).toBe(1_100_000 + 550_000 - 300_000 - 55_000);
  });
});
