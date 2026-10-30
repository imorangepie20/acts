import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { accounts, fiscalYearCloses, sites, users, vouchers } from "@/server/db/schema";
import { getBalanceSheet, getIncomeStatement, getTrialBalance } from "@/server/reports/service";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { closeMonth, reopenMonth } from "./periods";
import { closeFiscalYear, getYearEnd, reopenFiscalYear, saveTaxFigures } from "./year";

const db = getTestDb();

const MSG = {
  noPermission: "마감 권한이 없습니다.",
  monthsOpen: "회계연도의 모든 월을 먼저 마감하세요.",
  already: "이미 마감된 회계연도입니다.",
  notLatest: "가장 최근에 마감한 회계연도부터 해제할 수 있습니다.",
  yearFirst: "회계연도 마감을 먼저 해제하세요.",
};

let admin: SessionUser;
let staff: SessionUser;
let acc: Record<string, number>;
let siteId: number;

async function mkUser(email: string, name: string, role: SessionUser["role"]): Promise<SessionUser> {
  const [u] = await db.insert(users).values({ email, name, role, passwordHash: "x" }).returning({ id: users.id });
  return { id: u.id, email, name, role };
}

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  admin = await mkUser("admin@test.kr", "관리자", "admin");
  staff = await mkUser("staff@test.kr", "직원", "staff");
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
});

const line = (code: string, side: LineInput["side"], amount: number): LineInput => ({
  accountId: acc[code],
  side,
  amount,
  partnerId: null,
  siteId,
  departmentId: null,
  description: "",
});

async function mkVoucher(date: string, debit: string, credit: string, amount: number) {
  const v: VoucherInput = {
    date,
    description: "시험",
    entryType: "general",
    kind: "general",
    partnerId: null,
    evidenceType: "none",
    vatType: null,
    vatDeductible: null,
    supplyAmount: null,
    vatAmount: null,
    lines: [line(debit, "debit", amount), line(credit, "credit", amount)],
  };
  const r = await createVoucher(db, admin, v);
  if (!r.ok) throw new Error(r.error);
}

/** 2023: capital 100,000 in (101/331), expense 10,000 out (811/101). */
async function seedYear() {
  await mkVoucher("2023-02-01", "101", "331", 100000);
  await mkVoucher("2023-03-10", "811", "101", 10000);
}

async function closeMonths(year: number, through = 12) {
  for (let m = 1; m <= through; m++) {
    const r = await closeMonth(db, admin, `${year}-${String(m).padStart(2, "0")}`);
    if (!r.ok) throw new Error(r.error);
  }
}

const total = (lines: { kind: string; key?: string; amount: number }[], key: string) =>
  lines.find((l) => l.kind === "computed" && l.key === key)!.amount;

describe("getYearEnd", () => {
  it("system figures equal the balance sheet and income statement", async () => {
    await seedYear();
    const y = await getYearEnd(db, "2023-01-01");
    const f = { siteId: null, departmentId: null };
    const bs = await getBalanceSheet(db, { from: "2023-12-31", to: "2023-12-31", ...f });
    const is = await getIncomeStatement(db, { from: "2023-01-01", to: "2023-12-31", ...f });
    expect(y.fiscalEnd).toBe("2023-12-31");
    expect(y.system).toEqual({
      totalAssets: total(bs.lines, "total_assets"),
      totalLiabilities: total(bs.lines, "total_liabilities"),
      totalEquity: total(bs.lines, "total_equity"),
      netIncome: total(is.lines, "net"),
    });
    expect(y.system).toEqual({ totalAssets: 90000, totalLiabilities: 0, totalEquity: 90000, netIncome: -10000 });
    expect(y.tax).toBeNull();
    expect(y.closed).toBe(false);
    expect(y.allMonthsClosed).toBe(false);
  });
});

describe("saveTaxFigures", () => {
  const figures = { totalAssets: 95000, totalLiabilities: 0, totalEquity: 95000, netIncome: -5000 };

  it("stores the figures, open or closed, and overwrites them", async () => {
    await seedYear();
    expect((await saveTaxFigures(db, admin, "2023-01-01", figures)).ok).toBe(true);
    expect((await getYearEnd(db, "2023-01-01")).tax).toEqual(figures);
    await closeMonths(2023);
    expect((await closeFiscalYear(db, admin, "2023-01-01")).ok).toBe(true);
    const next = { ...figures, netIncome: -10000 };
    expect((await saveTaxFigures(db, admin, "2023-01-01", next)).ok).toBe(true);
    const y = await getYearEnd(db, "2023-01-01");
    expect(y.tax).toEqual(next);
    expect(y.closed).toBe(true);
  });

  it("requires period:close and valid integer figures", async () => {
    expect(await saveTaxFigures(db, staff, "2023-01-01", figures)).toEqual({ ok: false, error: MSG.noPermission });
    expect((await saveTaxFigures(db, admin, "2023-01-01", { ...figures, netIncome: 1.5 })).ok).toBe(false);
    expect((await saveTaxFigures(db, admin, "2023-05-01", figures)).ok).toBe(false); // not a fiscal start
  });

  it("the difference is tax minus system", async () => {
    await seedYear();
    await saveTaxFigures(db, admin, "2023-01-01", figures);
    const y = await getYearEnd(db, "2023-01-01");
    expect(y.tax!.totalAssets - y.system.totalAssets).toBe(5000);
    expect(y.tax!.netIncome - y.system.netIncome).toBe(5000);
  });
});

describe("closeFiscalYear", () => {
  it("requires period:close", async () => {
    expect(await closeFiscalYear(db, staff, "2023-01-01")).toEqual({ ok: false, error: MSG.noPermission });
    expect(await reopenFiscalYear(db, staff, "2023-01-01")).toEqual({ ok: false, error: MSG.noPermission });
  });

  it("refuses while any of the 12 months is open", async () => {
    await seedYear();
    await closeMonths(2023, 11);
    expect(await closeFiscalYear(db, admin, "2023-01-01")).toEqual({ ok: false, error: MSG.monthsOpen });
  });

  it("closes with differences, records who and when, and refuses a second close", async () => {
    await seedYear();
    await saveTaxFigures(db, admin, "2023-01-01", { totalAssets: 1, totalLiabilities: 2, totalEquity: 3, netIncome: 4 });
    await closeMonths(2023);
    expect((await getYearEnd(db, "2023-01-01")).allMonthsClosed).toBe(true);
    expect((await closeFiscalYear(db, admin, "2023-01-01")).ok).toBe(true);
    const y = await getYearEnd(db, "2023-01-01");
    expect(y.closed).toBe(true);
    expect(y.closedAt).toBeInstanceOf(Date);
    const [row] = await db.select().from(fiscalYearCloses).where(eq(fiscalYearCloses.fiscalStart, "2023-01-01"));
    expect(row.closedBy).toBe(admin.id);
    expect(await closeFiscalYear(db, admin, "2023-01-01")).toEqual({ ok: false, error: MSG.already });
  });

  it("blocks reopening a month inside a closed year until the year is reopened", async () => {
    await seedYear();
    await closeMonths(2023);
    await closeFiscalYear(db, admin, "2023-01-01");
    expect(await reopenMonth(db, admin, "2023-12")).toEqual({ ok: false, error: MSG.yearFirst });
    expect((await reopenFiscalYear(db, admin, "2023-01-01")).ok).toBe(true);
    expect((await getYearEnd(db, "2023-01-01")).closed).toBe(false);
    expect((await reopenMonth(db, admin, "2023-12")).ok).toBe(true);
  });

  it("only the latest closed year can be reopened", async () => {
    await closeMonths(2022);
    await closeMonths(2023);
    expect((await closeFiscalYear(db, admin, "2022-01-01")).ok).toBe(true);
    expect((await closeFiscalYear(db, admin, "2023-01-01")).ok).toBe(true);
    expect(await reopenFiscalYear(db, admin, "2022-01-01")).toEqual({ ok: false, error: MSG.notLatest });
    expect((await reopenFiscalYear(db, admin, "2023-01-01")).ok).toBe(true);
    expect((await reopenFiscalYear(db, admin, "2022-01-01")).ok).toBe(true);
  });

  it("reopening a year keeps the saved 세무사 figures", async () => {
    await closeMonths(2023);
    const f = { totalAssets: 1, totalLiabilities: 2, totalEquity: 3, netIncome: 4 };
    await saveTaxFigures(db, admin, "2023-01-01", f);
    await closeFiscalYear(db, admin, "2023-01-01");
    await reopenFiscalYear(db, admin, "2023-01-01");
    expect((await getYearEnd(db, "2023-01-01")).tax).toEqual(f);
  });

  it("creates no voucher: the next year opens with this year's balances and prior profit", async () => {
    await seedYear();
    await closeMonths(2023);
    const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(vouchers))[0].n;
    const before = await count();
    await closeFiscalYear(db, admin, "2023-01-01");
    expect(await count()).toBe(before);

    const f = { siteId: null, departmentId: null };
    const bs = await getBalanceSheet(db, { from: "2024-01-31", to: "2024-01-31", ...f });
    expect(bs.priorAsOf).toBe("2023-12-31");
    expect(total(bs.lines, "total_assets")).toBe(90000); // balances carry over
    const tb = await getTrialBalance(db, { from: "2024-01-31", to: "2024-01-31", ...f });
    const auto = tb.rows.find((r) => r.kind === "auto");
    expect(auto).toMatchObject({ name: "이월이익잉여금(전기 손익)", debitBalance: 10000 }); // 2023 net income -10,000
  });
});
