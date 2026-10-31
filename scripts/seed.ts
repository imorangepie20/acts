import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../src/server/auth/password";
import { createDb, type Db } from "../src/server/db/client";
import { seedStandardAccounts } from "../src/server/accounts/service";
import { ensureMainSite } from "../src/server/sites/service";
import {
  company,
  payrollItems,
  payrollRates,
  payrollSettings,
  users,
  withholdingTables,
} from "../src/server/db/schema";
import { RATE_SEED } from "../src/server/payroll/seed-data/rates";
import { WITHHOLDING_REVISIONS } from "../src/server/payroll/seed-data/withholding";

/** The default pay items. debitAccountCode null = 801/802 by 임원 여부. */
const DEFAULT_PAY_ITEMS: (typeof payrollItems.$inferInsert)[] = [
  { code: "basic", name: "기본급", taxable: true, nontaxLimit: null, debitAccountCode: null, sort: 10 },
  { code: "bonus", name: "상여", taxable: true, nontaxLimit: null, debitAccountCode: "803", sort: 20 },
  { code: "meal", name: "식대", taxable: false, nontaxLimit: 200_000, debitAccountCode: null, sort: 30 },
  { code: "car", name: "자가운전보조금", taxable: false, nontaxLimit: 200_000, debitAccountCode: null, sort: 40 },
  { code: "position", name: "직책수당", taxable: true, nontaxLimit: null, debitAccountCode: null, sort: 50 },
  { code: "overtime", name: "연장근로수당", taxable: true, nontaxLimit: null, debitAccountCode: null, sort: 60 },
];

/**
 * Rates and 간이세액표 follow the seed data files (a corrected value is updated in place);
 * pay items and the settings row are created once and then belong to the user.
 */
export async function seedPayroll(db: Db): Promise<void> {
  await db
    .insert(payrollRates)
    .values(RATE_SEED)
    .onConflictDoUpdate({
      target: [payrollRates.kind, payrollRates.effectiveFrom],
      set: { value: sql`excluded.value` },
    });
  await db
    .insert(withholdingTables)
    .values(WITHHOLDING_REVISIONS.map((r) => ({ effectiveFrom: r.effectiveFrom, data: r.table })))
    .onConflictDoUpdate({ target: withholdingTables.effectiveFrom, set: { data: sql`excluded.data` } });
  await db.insert(payrollItems).values(DEFAULT_PAY_ITEMS).onConflictDoNothing();
  await db.insert(payrollSettings).values({ id: 1 }).onConflictDoNothing();
}

export async function seed(
  db: Db,
  opts: { email: string; password: string },
): Promise<"created" | "exists" | "exists-not-admin"> {
  const email = opts.email.trim().toLowerCase();
  await db.insert(company).values({ id: 1, name: "우리회사" }).onConflictDoNothing();
  await seedStandardAccounts(db);
  await ensureMainSite(db);
  await seedPayroll(db);
  const [existing] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, email));
  if (existing) return existing.role === "admin" && existing.isActive ? "exists" : "exists-not-admin";
  await db.insert(users).values({
    email,
    name: "시스템 관리자",
    role: "admin",
    passwordHash: await hashPassword(opts.password),
  });
  return "created";
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL is invalid");
  if (!password || password === "change-me-now") {
    console.error("ADMIN_PASSWORD must be set to a non-default value (empty and 'change-me-now' are refused).");
    process.exit(1);
  }
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");

  const db = createDb(url);
  try {
    const status = await seed(db, { email, password });
    if (status === "created") console.log(`seeded admin ${email}`);
    else if (status === "exists") console.log(`admin ${email} already exists; nothing to do`);
    else console.warn(`warning: user ${email} exists but is not an active admin; nothing seeded`);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
