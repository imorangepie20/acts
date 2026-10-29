import { expect, test } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { company, users } from "./schema";

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
