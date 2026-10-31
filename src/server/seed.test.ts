import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../tests/helpers/db";
import { eq, sql } from "drizzle-orm";
import {
  accounts,
  company,
  payrollItems,
  payrollRates,
  payrollSettings,
  sites,
  users,
  withholdingTables,
} from "@/server/db/schema";
import { seed } from "../../scripts/seed";
import { authenticate } from "@/server/auth/service";

const db = getTestDb();
beforeEach(() => resetDb(db));

it("is idempotent", async () => {
  const opts = { email: "admin@acts.kr", password: "pw-12345678" };
  await seed(db, opts);
  await seed(db, opts);
  const cs = await db.select().from(company);
  expect(cs).toHaveLength(1);
  expect(cs[0].name).toBe("우리회사");
  const us = await db.select().from(users);
  expect(us).toHaveLength(1);
  expect(us[0]).toMatchObject({ email: "admin@acts.kr", role: "admin" });
  expect((await authenticate(db, "admin@acts.kr", "pw-12345678")).ok).toBe(true);
});

it("seeds the standard chart of accounts", async () => {
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const rows = await db.select().from(accounts).where(eq(accounts.code, "103"));
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("보통예금");
});

it("seeds a single 본점 site, idempotently", async () => {
  const opts = { email: "admin@acts.kr", password: "pw-12345678" };
  await seed(db, opts);
  await seed(db, opts);
  const rows = await db.select().from(sites);
  expect(rows.map((r) => r.name)).toEqual(["본점"]);
});

it("seeds payroll rates, 간이세액표, the six default items and the settings row, idempotently", async () => {
  const opts = { email: "admin@acts.kr", password: "pw-12345678" };
  await seed(db, opts);
  await seed(db, opts);
  const dupes = await db
    .select({ kind: payrollRates.kind, from: payrollRates.effectiveFrom, n: sql<number>`count(*)::int` })
    .from(payrollRates)
    .groupBy(payrollRates.kind, payrollRates.effectiveFrom)
    .having(sql`count(*) > 1`);
  expect(dupes).toEqual([]);
  expect((await db.select().from(payrollRates)).length).toBeGreaterThan(0);
  const tables = await db.select({ from: withholdingTables.effectiveFrom }).from(withholdingTables);
  expect(tables.map((t) => t.from).sort()).toEqual(["2024-03-01", "2026-03-01"]);
  const items = await db.select().from(payrollItems).orderBy(payrollItems.sort);
  expect(items.map((i) => [i.code, i.name, i.taxable, i.nontaxLimit, i.debitAccountCode])).toEqual([
    ["basic", "기본급", true, null, null],
    ["bonus", "상여", true, null, "803"],
    ["meal", "식대", false, 200_000, null],
    ["car", "자가운전보조금", false, 200_000, null],
    ["position", "직책수당", true, null, null],
    ["overtime", "연장근로수당", true, null, null],
  ]);
  const settings = await db.select().from(payrollSettings);
  expect(settings).toHaveLength(1);
  expect(settings[0]).toMatchObject({ id: 1, withholdingCode: "254", netPayCode: "103" });
});

it("does not overwrite a pay item the user changed", async () => {
  const opts = { email: "admin@acts.kr", password: "pw-12345678" };
  await seed(db, opts);
  await db.update(payrollItems).set({ name: "식대(변경)" }).where(eq(payrollItems.code, "meal"));
  await seed(db, opts);
  const [meal] = await db.select().from(payrollItems).where(eq(payrollItems.code, "meal"));
  expect(meal.name).toBe("식대(변경)");
});
