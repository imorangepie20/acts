import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../tests/helpers/db";
import { eq } from "drizzle-orm";
import { accounts, company, sites, users } from "@/server/db/schema";
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
