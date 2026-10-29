import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/server/auth/password";
import { createDb, type Db } from "../src/server/db/client";
import { company, users } from "../src/server/db/schema";

export async function seed(
  db: Db,
  opts: { email: string; password: string },
): Promise<void> {
  const email = opts.email.trim().toLowerCase();
  await db.insert(company).values({ id: 1, name: "우리회사" }).onConflictDoNothing();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return;
  await db.insert(users).values({
    email,
    name: "시스템 관리자",
    role: "admin",
    passwordHash: await hashPassword(opts.password),
  });
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL is invalid");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");

  const db = createDb(url);
  try {
    await seed(db, { email, password });
    console.log(`seeded admin ${email}`);
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
