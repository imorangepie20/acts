import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { updateAccount } from "@/server/accounts/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, partners, sites, users } from "@/server/db/schema";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { getDashboard } from "./service";

const db = getTestDb();
let staff: SessionUser;
let acc: Record<string, number>;
let siteId: number;
let partnerId: number;

async function setStartMonth(m: number) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, fiscalYearStartMonth: m, approvalRequired: false }, staff.id);
  if (!r.ok) throw new Error(r.error);
}

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
  [{ id: partnerId }] = await db.insert(partners).values({ name: "거래처" }).returning({ id: partners.id });
  await setStartMonth(1);
});

const line = (code: string, side: LineInput["side"], amount: number): LineInput => ({
  accountId: acc[code], side, amount, partnerId: ["108", "253"].includes(code) ? partnerId : null, siteId, departmentId: null, description: "",
});
async function create(date: string, lines: LineInput[], kind: "general" | "closing" = "general") {
  const input: VoucherInput = {
    date, description: "t", entryType: "general", kind, partnerId: null, evidenceType: "none",
    vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null, lines,
  };
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
}
const get = (asOf: string, site: number | null = null) =>
  getDashboard(db, { asOf, siteId: site, departmentId: null });

describe("getDashboard", () => {
  it("sums cash, receivable and payable by dashboardRole", async () => {
    await create("2026-10-01", [line("101", "debit", 1000), line("331", "credit", 1000)]);
    await create("2026-10-02", [line("103", "debit", 2000), line("331", "credit", 2000)]);
    await create("2026-10-03", [line("108", "debit", 800), line("331", "credit", 800)]);
    await create("2026-10-04", [line("811", "debit", 500), line("253", "credit", 500)]);
    const d = await get("2026-10-30");
    expect(d.cash).toBe(3000);
    expect(d.receivable).toBe(800);
    expect(d.payable).toBe(500);
    expect(d.roles).toEqual({ cash: true, receivable: true, payable: true });
  });

  it("reports a role with no accounts as absent", async () => {
    for (const code of ["101", "102", "103", "104", "105", "106"]) {
      await updateAccount(db, acc[code], { dashboardRole: null });
    }
    const d = await get("2026-10-30");
    expect(d.roles.cash).toBe(false);
    expect(d.roles.receivable).toBe(true);
  });

  it("KPIs: YTD totals, the last whole month against the one before, cash against last month-end", async () => {
    await create("2026-09-15", [line("101", "debit", 9000), line("401", "credit", 9000)]);
    await create("2026-10-02", [line("101", "debit", 5000), line("401", "credit", 5000)]);
    await create("2026-10-03", [line("811", "debit", 1200), line("101", "credit", 1200)]);
    await create("2026-10-31", [line("811", "debit", 300), line("101", "credit", 300)]);
    const early = await get("2026-10-30");
    expect(early.kpi.revenue.current).toBe(14000);
    expect(early.kpi.revenue.pct).toBeNull(); // no prior-year data
    expect(early.kpi.lastMonth.month).toBe("2026-09");
    expect(early.kpi.lastMonth.revenue).toEqual({ current: 9000, previous: null, pct: null });
    expect(early.kpi.cash).toMatchObject({ current: 12800, previous: 9000, prevMonthEnd: "2026-09-30" });
    const end = await get("2026-10-31");
    expect(end.kpi.lastMonth.month).toBe("2026-10");
    expect(end.kpi.lastMonth.operatingProfit).toEqual({ current: 3500, previous: 9000, pct: -61.1 });
    expect(end.kpi.margin).toBe(89.3);
  });

  it("compares with the same span of the prior year", async () => {
    await create("2025-03-10", [line("101", "debit", 1000), line("401", "credit", 1000)]);
    await create("2025-05-10", [line("101", "debit", 9999), line("401", "credit", 9999)]); // after asOf − 1 year
    await create("2026-03-10", [line("101", "debit", 1500), line("401", "credit", 1500)]);
    const d = await get("2026-04-30");
    expect(d.prior).toEqual({ from: "2025-01-01", to: "2025-04-30", hasData: true });
    expect(d.kpi.revenue).toEqual({ current: 1500, previous: 1000, pct: 50 });
    expect(d.trend[2].priorRevenue).toBe(1000);
    expect(d.trend[1].priorRevenue).toBe(0);
  });

  it("builds a zero-filled trend with revenue and operating profit per month", async () => {
    await create("2026-01-10", [line("101", "debit", 1000), line("401", "credit", 1000)]);
    await create("2026-01-11", [line("811", "debit", 400), line("101", "credit", 400)]);
    await create("2026-03-05", [line("101", "debit", 2000), line("401", "credit", 2000)]);
    await create("2026-03-06", [line("951", "debit", 100), line("101", "credit", 100)]);
    const d = await get("2026-04-10");
    expect(d.fiscalStart).toBe("2026-01-01");
    expect(d.trend.map((t) => t.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(d.trend[0]).toEqual({ month: "2026-01", revenue: 1000, operatingProfit: 600, netProfit: 600, priorRevenue: null });
    expect(d.trend[1]).toEqual({ month: "2026-02", revenue: 0, operatingProfit: 0, netProfit: 0, priorRevenue: null });
    expect(d.trend[2]).toEqual({ month: "2026-03", revenue: 2000, operatingProfit: 2000, netProfit: 1900, priorRevenue: null });
    expect(d.trend[3]).toEqual({ month: "2026-04", revenue: 0, operatingProfit: 0, netProfit: 0, priorRevenue: null });
  });

  it("position satisfies assets = liabilities + equity", async () => {
    await create("2026-02-01", [line("101", "debit", 10000), line("331", "credit", 10000)]);
    await create("2026-10-02", [line("101", "debit", 5000), line("401", "credit", 5000)]);
    await create("2026-10-03", [line("811", "debit", 1200), line("253", "credit", 1200)]);
    const d = await get("2026-10-30");
    expect(d.position.assets).toBe(15000);
    expect(d.position.liabilities).toBe(1200);
    expect(d.position.equity).toBe(13800);
    expect(d.position.assets).toBe(d.position.liabilities + d.position.equity);
  });

  it("counts only closing vouchers in the fiscal year, with their P&L effect", async () => {
    await create("2026-03-31", [line("811", "debit", 700), line("262", "credit", 700)], "closing");
    await create("2026-06-30", [line("262", "debit", 200), line("811", "credit", 200)], "closing");
    await create("2026-07-01", [line("811", "debit", 50), line("101", "credit", 50)]);
    await create("2025-12-31", [line("811", "debit", 90), line("262", "credit", 90)], "closing");
    const d = await get("2026-10-30");
    expect(d.closing).toEqual({ count: 2, profitEffect: -500 });
    expect((await get("2026-05-01")).closing).toEqual({ count: 1, profitEffect: -700 });
  });

  it("lastClosedMonth is null when nothing is closed", async () => {
    expect((await get("2026-10-30")).lastClosedMonth).toBeNull();
  });

  it("filters by site", async () => {
    await create("2026-10-02", [line("101", "debit", 5000), line("401", "credit", 5000)]);
    const [other] = await db.insert(sites).values({ name: "other" }).returning({ id: sites.id });
    const d = await get("2026-10-30", other.id);
    expect(d.cash).toBe(0);
    expect(d.kpi.revenue.current).toBe(0);
  });
});

describe("analysis sections", () => {
  it("ranks partners, ages receivables FIFO, schedules card and VAT payables, splits costs and cash flow", async () => {
    const [{ id: card }] = await db.insert(partners).values({ name: "OO카드" }).returning({ id: partners.id });
    const withPartner = (l: LineInput, p: number) => ({ ...l, partnerId: p });
    await create("2026-06-01", [line("108", "debit", 1000), line("401", "credit", 1000)]);
    await create("2026-08-15", [line("108", "debit", 2000), line("401", "credit", 2000)]);
    await create("2026-09-01", [line("103", "debit", 1500), line("108", "credit", 1500)]);
    await create("2026-10-10", [withPartner(line("811", "debit", 400), card), withPartner(line("253", "credit", 400), card)]);
    await create("2026-10-12", [line("819", "debit", 300), line("103", "credit", 300)]);
    await create("2026-09-30", [line("255", "debit", 0 + 100), line("261", "credit", 100)]);
    const d = await get("2026-11-01");

    expect(d.partners.receivables).toEqual([{ partnerId, name: "거래처", amount: 1500 }]);
    expect(d.partners.payables).toEqual([{ partnerId: card, name: "OO카드", amount: 400 }]);
    // 1,000 (06-01) and 500 of 2,000 (08-15) settled; 1,500 open from 08-15 = 78 days
    expect(d.aging.buckets).toEqual({ "0–30일": 0, "31–60일": 0, "61–90일": 1500, "90일 초과": 0 });

    expect(d.schedule.map((s) => [s.kind, s.due, s.amount])).toEqual([
      ["card", "2026-11-16", 400],
      ["vat", "2027-01-25", 100],
    ]);

    expect(d.costs.total).toBe(700);
    expect(d.costs.rows.map((r) => r.label)).toEqual(["811 복리후생비", "819 지급임차료"]);
    expect(d.costs.labor.amount).toBe(0);

    const oct = d.cashFlow.find((c) => c.month === "2026-10")!;
    expect(oct).toEqual({ month: "2026-10", inflow: 0, outflow: 300, net: -300 });
    expect(d.runway).toEqual({ months: 4, avgOutflow: 300, basisMonths: ["2026-10"] });
    expect(d.vat.period).toMatchObject({ from: "2026-10-01", to: "2026-12-31", kind: "final" });
    expect(d.vat.estimate.payable).toBe(0);
  });
});

describe("as-of yesterday crosses month and fiscal-year boundaries", () => {
  it("asOf on the last day of a month stays in that month", async () => {
    const d = await get("2026-10-31");
    expect(d.month).toBe("2026-10");
    expect(d.trend.at(-1)?.month).toBe("2026-10");
  });

  it("December asOf with a January fiscal year covers the whole year", async () => {
    const d = await get("2026-12-31");
    expect(d.trend.map((t) => t.month)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("fiscal start month 4 with asOf 2026-03-31 covers 2025-04..2026-03", async () => {
    await setStartMonth(4);
    const d = await get("2026-03-31");
    expect(d.fiscalStart).toBe("2025-04-01");
    expect(d.trend[0].month).toBe("2025-04");
    expect(d.trend.at(-1)?.month).toBe("2026-03");
    expect(d.trend).toHaveLength(12);
  });
});
