import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, sites, users } from "@/server/db/schema";
import { createSite } from "@/server/sites/service";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { getTrialBalance } from "./service";

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
    date, description: "t", entryType: "general", partnerId: null, evidenceType: "none",
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
