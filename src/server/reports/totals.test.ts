import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, departments, sites, users } from "@/server/db/schema";
import { createSite } from "@/server/sites/service";
import { approveVoucher, createVoucher, rejectVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { accountTotals, profitBetween } from "./totals";

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
});

const line = (code: string, side: LineInput["side"], amount: number, sid = siteId): LineInput => ({
  accountId: acc[code], side, amount, partnerId: null, siteId: sid, departmentId: null, description: "",
});
const voucher = (date: string, lines: LineInput[]): VoucherInput => ({
  date, description: "t", entryType: "general", partnerId: null, evidenceType: "none",
  vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null, lines,
});
async function create(input: VoucherInput): Promise<string> {
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}
async function setApproval(on: boolean) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, approvalRequired: on }, manager.id);
  if (!r.ok) throw new Error(r.error);
}
const all = { from: null, to: "2099-12-31", siteId: null, departmentId: null };
const byAcc = (t: { accountId: number; debit: number; credit: number }[], code: string) => t.find((x) => x.accountId === acc[code]);

describe("accountTotals", () => {
  it("only posted lines count", async () => {
    await setApproval(true);
    await create(voucher("2026-10-01", [line("811", "debit", 100), line("101", "credit", 100)]));
    const rejected = await create(voucher("2026-10-02", [line("811", "debit", 200), line("101", "credit", 200)]));
    const rj = await rejectVoucher(db, manager, rejected, 1, "no");
    expect(rj.ok).toBe(true);
    expect(await accountTotals(db, all)).toEqual([]);
    const ok = await create(voucher("2026-10-03", [line("811", "debit", 300), line("101", "credit", 300)]));
    expect((await approveVoucher(db, manager, ok, 1)).ok).toBe(true);
    const t = await accountTotals(db, all);
    expect(byAcc(t, "811")).toEqual({ accountId: acc["811"], debit: 300, credit: 0 });
    expect(byAcc(t, "101")).toEqual({ accountId: acc["101"], debit: 0, credit: 300 });
  });

  it("date bounds are inclusive and null from is unbounded", async () => {
    for (const d of ["2026-01-01", "2026-02-01", "2026-03-01"]) {
      await create(voucher(d, [line("811", "debit", 10), line("101", "credit", 10)]));
    }
    const sum = async (from: string | null, to: string) =>
      byAcc(await accountTotals(db, { ...all, from, to }), "811")?.debit ?? 0;
    expect(await sum("2026-02-01", "2026-02-01")).toBe(10);
    expect(await sum("2026-01-01", "2026-03-01")).toBe(30);
    expect(await sum(null, "2026-02-01")).toBe(20);
    expect(await sum("2026-03-02", "2026-12-31")).toBe(0);
  });

  it("site filter applies per line", async () => {
    const s2 = await createSite(db, { name: "지점", businessNumber: null });
    if (!s2.ok) throw new Error(s2.error);
    await create(voucher("2026-10-01", [line("811", "debit", 50, s2.value.id), line("101", "credit", 50, siteId)]));
    const t2 = await accountTotals(db, { ...all, siteId: s2.value.id });
    expect(t2).toEqual([{ accountId: acc["811"], debit: 50, credit: 0 }]);
    const t1 = await accountTotals(db, { ...all, siteId });
    expect(t1).toEqual([{ accountId: acc["101"], debit: 0, credit: 50 }]);
  });
});

describe("department filter", () => {
  it("filters lines by department", async () => {
    const [d] = await db.insert(departments).values({ name: "영업" }).returning({ id: departments.id });
    const l = line("811", "debit", 70);
    await create(voucher("2026-10-01", [{ ...l, departmentId: d.id }, line("101", "credit", 70)]));
    const t = await accountTotals(db, { ...all, departmentId: d.id });
    expect(t).toEqual([{ accountId: acc["811"], debit: 70, credit: 0 }]);
  });
});

describe("profitBetween", () => {
  it("sale 100000 less expense 30000", async () => {
    await create(voucher("2026-10-01", [line("101", "debit", 100000), line("401", "credit", 100000)]));
    await create(voucher("2026-10-02", [line("811", "debit", 30000), line("101", "credit", 30000)]));
    expect(await profitBetween(db, all)).toBe(70000);
  });
});
