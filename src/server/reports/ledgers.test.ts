import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, partners, sites, users } from "@/server/db/schema";
import { createSite } from "@/server/sites/service";
import { approveVoucher, createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { getAccountLedger, getJournal } from "./ledgers";

const db = getTestDb();
let staff: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const mk = async (email: string, role: SessionUser["role"]): Promise<SessionUser> => {
    const [u] = await db.insert(users).values({ email, name: email, role, passwordHash: "x" }).returning({ id: users.id });
    return { id: u.id, email, name: email, role };
  };
  staff = await mk("s@test.kr", "staff");
  manager = await mk("m@test.kr", "manager");
  acc = Object.fromEntries((await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]));
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, fiscalYearStartMonth: 1, approvalRequired: false }, manager.id);
  if (!r.ok) throw new Error(r.error);
});

const line = (code: string, side: LineInput["side"], amount: number, sid = siteId): LineInput => ({
  accountId: acc[code], side, amount, partnerId: null, siteId: sid, departmentId: null, description: "",
});
async function create(date: string, lines: LineInput[], description = "t") {
  const input: VoucherInput = {
    date, description, entryType: "general", partnerId: null, evidenceType: "none",
    vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null, lines,
  };
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}
const F = { from: "2026-01-01", to: "2026-12-31", siteId: null, departmentId: null };

describe("getJournal", () => {
  it("orders by date then no and excludes pending vouchers", async () => {
    await create("2026-03-02", [line("811", "debit", 20), line("101", "credit", 20)], "b");
    await create("2026-03-01", [line("811", "debit", 10), line("101", "credit", 10)], "a");
    const c = await getCompany(db);
    await updateCompany(db, { ...c, approvalRequired: true }, manager.id);
    await create("2026-03-03", [line("811", "debit", 99), line("101", "credit", 99)], "pending");
    const j = await getJournal(db, F, 1);
    expect(j.entries.map((e) => e.description)).toEqual(["a", "b"]);
    expect(j.total).toBe(2);
    expect(j.debitSum).toBe(30);
    expect(j.creditSum).toBe(30);
    expect(j.entries[0].lines.map((l) => [l.code, l.side, l.amount])).toEqual([
      ["811", "debit", 10],
      ["101", "credit", 10],
    ]);
  });

  it("site filter keeps only matching lines and skips vouchers without any", async () => {
    const s2 = await createSite(db, { name: "지점2", businessNumber: null });
    if (!s2.ok) throw new Error(s2.error);
    await create("2026-03-01", [line("811", "debit", 10), line("101", "credit", 10, s2.value.id)], "split");
    await create("2026-03-02", [line("811", "debit", 5, s2.value.id), line("101", "credit", 5, s2.value.id)], "other");
    const j = await getJournal(db, { ...F, siteId }, 1);
    expect(j.entries.map((e) => e.description)).toEqual(["split"]);
    expect(j.entries[0].lines).toHaveLength(1);
    expect(j.entries[0].lines[0].code).toBe("811");
    expect(j.debitSum).toBe(10);
    expect(j.creditSum).toBe(0);
  });

  it("paginates 100 per page; sums cover all pages; null returns everything", async () => {
    for (let i = 0; i < 101; i++) {
      await create("2026-04-01", [line("811", "debit", 1), line("101", "credit", 1)], `v${i}`);
    }
    const p1 = await getJournal(db, F, 1);
    expect(p1.entries).toHaveLength(100);
    expect(p1.total).toBe(101);
    expect(p1.debitSum).toBe(101);
    const p2 = await getJournal(db, F, 2);
    expect(p2.entries).toHaveLength(1);
    expect(p2.entries[0].no).toBe(101);
    expect((await getJournal(db, F, null)).entries).toHaveLength(101);
  });
});

describe("getAccountLedger", () => {
  it("returns null for an unknown account", async () => {
    expect(await getAccountLedger(db, 999999, F)).toBeNull();
  });

  it("opening balance, running balance, 월계 and 누계 per month", async () => {
    await create("2025-12-20", [line("103", "debit", 1000), line("101", "credit", 1000)]);
    await create("2026-02-05", [line("103", "debit", 500), line("101", "credit", 500)]);
    await create("2026-02-20", [line("101", "debit", 200), line("103", "credit", 200)]);
    await create("2026-03-03", [line("103", "debit", 100), line("101", "credit", 100)]);
    const l = await getAccountLedger(db, acc["103"], { ...F, from: "2026-02-01", to: "2026-03-31" });
    expect(l).not.toBeNull();
    const rows = l!.rows;
    expect(rows[0]).toEqual({ kind: "opening", balance: 1000 });
    expect(rows.map((r) => r.kind)).toEqual(["opening", "line", "line", "month", "cumulative", "line", "month", "cumulative"]);
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines.map((r) => r.kind === "line" && r.balance)).toEqual([1500, 1300, 1400]);
    expect(rows[3]).toEqual({ kind: "month", month: "2026-02", debit: 500, credit: 200 });
    expect(rows[4]).toEqual({ kind: "cumulative", debit: 500, credit: 200 });
    expect(rows[6]).toEqual({ kind: "month", month: "2026-03", debit: 100, credit: 0 });
    expect(rows[7]).toEqual({ kind: "cumulative", debit: 600, credit: 200 });
    expect(l!.closing).toBe(1400);
  });

  it("P&L opening balance starts at the fiscal year start", async () => {
    await create("2025-06-01", [line("811", "debit", 700), line("101", "credit", 700)]);
    await create("2026-02-01", [line("811", "debit", 300), line("101", "credit", 300)]);
    const l = await getAccountLedger(db, acc["811"], { ...F, from: "2026-03-01", to: "2026-03-31" });
    expect(l!.rows).toEqual([{ kind: "opening", balance: 300 }]);
    expect(l!.closing).toBe(300);
  });

  it("partnerId restricts lines but keeps the same opening logic", async () => {
    const [{ id: pid }] = await db.insert(partners).values({ name: "거래처" }).returning({ id: partners.id });
    await create("2026-02-05", [{ ...line("103", "debit", 500), partnerId: pid }, line("101", "credit", 500)]);
    await create("2026-02-06", [line("103", "debit", 50), line("101", "credit", 50)]);
    const l = await getAccountLedger(db, acc["103"], { ...F, from: "2026-02-01" }, { partnerId: pid });
    const ls = l!.rows.filter((r) => r.kind === "line");
    expect(ls).toHaveLength(1);
    expect(l!.closing).toBe(500);
  });

  it("excludes unapproved vouchers", async () => {
    const c = await getCompany(db);
    await updateCompany(db, { ...c, approvalRequired: true }, manager.id);
    const id = await create("2026-02-05", [line("103", "debit", 500), line("101", "credit", 500)]);
    expect((await getAccountLedger(db, acc["103"], F))!.rows).toEqual([{ kind: "opening", balance: 0 }]);
    expect((await approveVoucher(db, manager, id, 1)).ok).toBe(true);
    expect((await getAccountLedger(db, acc["103"], F))!.closing).toBe(500);
  });
});
