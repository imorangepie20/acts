import { expect, test } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { sql } from "drizzle-orm";
import { company, payrollRuns, users } from "./schema";

test("company table accepts only id 1", async () => {
  const db = getTestDb();
  await resetDb(db);
  await db.insert(company).values({ name: "테스트" });
  await expect(db.insert(company).values({ id: 2, name: "x" })).rejects.toThrow();
});

test("email is unique", async () => {
  const db = getTestDb();
  await resetDb(db);
  const u = { email: "a@x.kr", name: "A", role: "staff" as const, passwordHash: "x" };
  await db.insert(users).values(u);
  await expect(db.insert(users).values(u)).rejects.toThrow();
});

test("payroll tables exist and only one regular run per month", async () => {
  const db = getTestDb();
  await resetDb(db);
  const names = [
    "employees",
    "payroll_items",
    "payroll_settings",
    "payroll_rates",
    "withholding_tables",
    "payroll_runs",
    "payroll_run_lines",
    "payroll_audit",
  ];
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const have = new Set(rows.map((r) => r.table_name));
  for (const n of names) expect(have.has(n), n).toBe(true);

  const [u] = await db.insert(users).values({ email: "p@x.kr", name: "P", role: "admin", passwordHash: "x" }).returning();
  const run = (type: "regular" | "bonus") => ({
    type,
    yearMonth: "2026-01",
    payDate: "2026-01-25",
    createdBy: u.id,
  });
  await db.insert(payrollRuns).values(run("regular"));
  await expect(db.insert(payrollRuns).values(run("regular"))).rejects.toThrow();
  await db.insert(payrollRuns).values([run("bonus"), run("bonus")]);
  await db.execute(sql`TRUNCATE payroll_runs CASCADE`);
});

test("voucher_kind accepts payroll", async () => {
  const db = getTestDb();
  const r = await db.execute<{ e: string }>(sql`select unnest(enum_range(null::voucher_kind))::text as e`);
  expect(r.map((x) => x.e)).toContain("payroll");
});
