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

  it("monthOperatingProfit covers only the as-of month", async () => {
    await create("2026-09-15", [line("101", "debit", 9000), line("401", "credit", 9000)]);
    await create("2026-10-02", [line("101", "debit", 5000), line("401", "credit", 5000)]);
    await create("2026-10-03", [line("811", "debit", 1200), line("101", "credit", 1200)]);
    await create("2026-10-31", [line("811", "debit", 300), line("101", "credit", 300)]);
    expect((await get("2026-10-30")).monthOperatingProfit).toBe(3800);
    expect((await get("2026-10-31")).monthOperatingProfit).toBe(3500);
  });

  it("builds a zero-filled trend with revenue and operating profit per month", async () => {
    await create("2026-01-10", [line("101", "debit", 1000), line("401", "credit", 1000)]);
    await create("2026-01-11", [line("811", "debit", 400), line("101", "credit", 400)]);
    await create("2026-03-05", [line("101", "debit", 2000), line("401", "credit", 2000)]);
    await create("2026-03-06", [line("951", "debit", 100), line("101", "credit", 100)]);
    const d = await get("2026-04-10");
    expect(d.fiscalStart).toBe("2026-01-01");
    expect(d.trend.map((t) => t.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(d.trend[0]).toEqual({ month: "2026-01", revenue: 1000, operatingProfit: 600, netProfit: 600 });
    expect(d.trend[1]).toEqual({ month: "2026-02", revenue: 0, operatingProfit: 0, netProfit: 0 });
    expect(d.trend[2]).toEqual({ month: "2026-03", revenue: 2000, operatingProfit: 2000, netProfit: 1900 });
    expect(d.trend[3]).toEqual({ month: "2026-04", revenue: 0, operatingProfit: 0, netProfit: 0 });
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
    expect(d.monthOperatingProfit).toBe(0);
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
