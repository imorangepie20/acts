import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/server/db/client";
import { seedStandardAccounts } from "@/server/accounts/service";
import { company } from "@/server/db/schema";
import { ensureMainSite } from "@/server/sites/service";

let testDb: Db | undefined;

export function getTestDb(): Db {
  if (!testDb) {
    if (existsSync(".env")) process.loadEnvFile(".env");
    testDb = createDb(process.env.DATABASE_URL_TEST!);
  }
  return testDb;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE voucher_imports, voucher_templates, fiscal_year_closes, period_closes, voucher_history, voucher_lines, voucher_attachments, vouchers, sessions, users, company, accounts, partners, departments, sites RESTART IDENTITY CASCADE`,
  );
}

/** Reference data vouchers need: the company row, the standard chart and the main site. */
export async function seedReference(db: Db): Promise<void> {
  await db.insert(company).values({ id: 1, name: "테스트 회사" }).onConflictDoNothing();
  await seedStandardAccounts(db);
  await ensureMainSite(db);
}
