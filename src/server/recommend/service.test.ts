import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSimpleVoucher } from "@/lib/vouchers/simple";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { accounts, sites, users, vouchers } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { recommendAccounts, recommendMany } from "./service";

const db = getTestDb();
let user: SessionUser;
let acc: Record<string, number>;
let siteId: number;
let partnerP: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "직원", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  user = { id: u.id, email: "s@test.kr", name: "직원", role: "staff" };
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  const p = await createPartner(db, {
    name: "거래처P",
    businessNumber: null,
    representative: null,
    phone: null,
    email: null,
    memo: null,
  });
  if (!p.ok) throw new Error(p.error);
  partnerP = p.value.id;
});

async function trade(type: "purchase" | "sale", main: string, counter: string, description: string) {
  const built = buildSimpleVoucher(
    {
      type,
      date: "2026-10-30",
      description,
      mainAccountId: acc[main],
      counterAccountId: acc[counter],
      partnerId: partnerP,
      siteId,
      departmentId: null,
      evidenceType: "card",
      vatType: "taxable",
      vatDeductible: true,
      supplyAmount: 10000,
      vatAmount: 1000,
    },
    await getVatAccountIds(db),
  );
  if (!built.ok) throw new Error(built.error);
  const r = await createVoucher(db, user, built.value);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

const q = { entryType: "purchase" as const, partnerId: null as number | null, text: "" };

describe("recommendAccounts", () => {
  it("recommends the account used for the same partner", async () => {
    await trade("purchase", "811", "253", "점심");
    await trade("purchase", "811", "253", "저녁");
    const r = await recommendAccounts(db, { ...q, partnerId: partnerP });
    expect(r[0].accountId).toBe(acc["811"]);
    expect(r[0].reason).toBe("이 거래처 2회");
  });

  it("ignores rejected vouchers", async () => {
    const id = await trade("purchase", "811", "253", "점심");
    await db.update(vouchers).set({ status: "rejected" }).where(eq(vouchers.id, id));
    expect(await recommendAccounts(db, { ...q, partnerId: partnerP })).toEqual([]);
  });

  it("drops accounts that are inactive now", async () => {
    await trade("purchase", "811", "253", "점심");
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.id, acc["811"]));
    expect(await recommendAccounts(db, { ...q, partnerId: partnerP })).toEqual([]);
  });

  it("does not leak sale history into purchase", async () => {
    await trade("sale", "401", "101", "매출");
    expect(await recommendAccounts(db, { ...q, partnerId: partnerP })).toEqual([]);
    const sale = await recommendAccounts(db, { ...q, entryType: "sale", partnerId: partnerP });
    expect(sale[0].accountId).toBe(acc["401"]);
  });

  it("falls back to keyword rules, skipping inactive accounts", async () => {
    const r = await recommendAccounts(db, { ...q, text: "주유소 결제" });
    expect(r).toEqual([{ accountId: acc["822"], reason: "기본 규칙(주유)" }]);
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.id, acc["822"]));
    expect(await recommendAccounts(db, { ...q, text: "주유소 결제" })).toEqual([]);
  });

  it("recommendMany answers each query in order", async () => {
    await trade("purchase", "811", "253", "점심");
    const r = await recommendMany(db, "purchase", [
      { partnerId: partnerP, text: "" },
      { partnerId: null, text: "" },
    ]);
    expect(r[0][0].accountId).toBe(acc["811"]);
    expect(r[1]).toEqual([]);
  });
});
