import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/server/db/client";

let testDb: Db | undefined;

export function getTestDb(): Db {
  if (!testDb) {
    if (existsSync(".env")) process.loadEnvFile(".env");
    testDb = createDb(process.env.DATABASE_URL_TEST!);
  }
  return testDb;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE sessions, users, company, accounts, partners RESTART IDENTITY CASCADE`);
}
