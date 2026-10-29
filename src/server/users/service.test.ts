import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { sessions, users } from "@/server/db/schema";
import { createSession, getSessionUser, authenticate } from "@/server/auth/service";
import { hashPassword } from "@/server/auth/password";
import {
  createUser,
  listUsers,
  resetPassword,
  unlockUser,
  updateUser,
} from "./service";

const db = getTestDb();
const LAST_ADMIN = "활성 시스템 관리자가 최소 1명 있어야 합니다.";

async function seedAdmin(email = "admin@acts.kr") {
  const [u] = await db
    .insert(users)
    .values({ email, name: "관리자", role: "admin", passwordHash: await hashPassword("admin-pass-1") })
    .returning();
  return u;
}
async function seedStaff(email = "staff@acts.kr") {
  const r = await createUser(db, { email, name: "실무", role: "staff", password: "staff-pass-1" });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

beforeEach(async () => {
  await resetDb(db);
});

describe("createUser", () => {
  it("normalizes email and stores a working password", async () => {
    const r = await createUser(db, { email: " New@Acts.KR ", name: " 홍길동 ", role: "manager", password: "longenough1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("new@acts.kr");
      expect(r.value.name).toBe("홍길동");
    }
    const a = await authenticate(db, "new@acts.kr", "longenough1");
    expect(a.ok).toBe(true);
  });
  it("rejects invalid email", async () => {
    const r = await createUser(db, { email: "nope", name: "a", role: "staff", password: "longenough1" });
    expect(r).toEqual({ ok: false, error: "올바른 이메일 주소를 입력하세요." });
  });
  it("rejects duplicate email (case-insensitive)", async () => {
    await seedStaff("dup@acts.kr");
    const r = await createUser(db, { email: "DUP@acts.kr", name: "b", role: "staff", password: "longenough1" });
    expect(r).toEqual({ ok: false, error: "이미 사용 중인 이메일입니다." });
  });
  it("rejects short password", async () => {
    const r = await createUser(db, { email: "a@acts.kr", name: "a", role: "staff", password: "short" });
    expect(r).toEqual({ ok: false, error: "비밀번호는 8자 이상이어야 합니다." });
  });
  it("rejects blank name", async () => {
    const r = await createUser(db, { email: "a@acts.kr", name: "   ", role: "staff", password: "longenough1" });
    expect(r).toEqual({ ok: false, error: "이름을 입력하세요." });
  });
});

describe("listUsers", () => {
  it("never exposes passwordHash and sorts by createdAt ascending", async () => {
    await seedAdmin();
    await seedStaff();
    const list = await listUsers(db);
    expect(list.map((u) => u.email)).toEqual(["admin@acts.kr", "staff@acts.kr"]);
    for (const u of list) {
      expect("passwordHash" in u).toBe(false);
      expect(Object.keys(u).sort()).toEqual(
        ["createdAt", "email", "id", "isActive", "lockedUntil", "name", "role"].sort(),
      );
    }
  });
});

describe("updateUser", () => {
  it("updates name/role and bumps updatedAt", async () => {
    const s = await seedStaff();
    const [before] = await db.select().from(users).where(eq(users.id, s.id));
    await new Promise((r) => setTimeout(r, 20));
    expect(await updateUser(db, s.id, { name: "새이름", role: "manager" })).toEqual({ ok: true, value: undefined });
    const [after] = await db.select().from(users).where(eq(users.id, s.id));
    expect(after.name).toBe("새이름");
    expect(after.role).toBe("manager");
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
  it("rejects blank name", async () => {
    const s = await seedStaff();
    expect(await updateUser(db, s.id, { name: " " })).toEqual({ ok: false, error: "이름을 입력하세요." });
  });
  it("refuses to demote the last active admin", async () => {
    const a = await seedAdmin();
    expect(await updateUser(db, a.id, { role: "staff" })).toEqual({ ok: false, error: LAST_ADMIN });
  });
  it("refuses to deactivate the last active admin", async () => {
    const a = await seedAdmin();
    expect(await updateUser(db, a.id, { isActive: false })).toEqual({ ok: false, error: LAST_ADMIN });
  });
  it("allows demoting an admin when another active admin exists", async () => {
    const a = await seedAdmin();
    await seedAdmin("admin2@acts.kr");
    expect((await updateUser(db, a.id, { role: "manager" })).ok).toBe(true);
  });
  it("an inactive admin does not count as a remaining admin", async () => {
    const a = await seedAdmin();
    const b = await seedAdmin("admin2@acts.kr");
    expect((await updateUser(db, b.id, { isActive: false })).ok).toBe(true);
    expect(await updateUser(db, a.id, { role: "staff" })).toEqual({ ok: false, error: LAST_ADMIN });
  });
  it("deactivating a user deletes their sessions", async () => {
    const s = await seedStaff();
    const { token } = await createSession(db, s.id);
    expect(await getSessionUser(db, token)).not.toBeNull();
    await updateUser(db, s.id, { isActive: false });
    expect(await getSessionUser(db, token)).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, s.id))).toHaveLength(0);
    await updateUser(db, s.id, { isActive: true });
    expect(await getSessionUser(db, token)).toBeNull();
  });
});

describe("resetPassword", () => {
  it("rejects short password", async () => {
    const s = await seedStaff();
    expect(await resetPassword(db, s.id, "short")).toEqual({ ok: false, error: "비밀번호는 8자 이상이어야 합니다." });
  });
  it("changes password and deletes sessions", async () => {
    const s = await seedStaff();
    const { token } = await createSession(db, s.id);
    expect((await resetPassword(db, s.id, "brand-new-pass")).ok).toBe(true);
    expect(await getSessionUser(db, token)).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, s.id))).toHaveLength(0);
    expect((await authenticate(db, s.email, "brand-new-pass")).ok).toBe(true);
    expect((await authenticate(db, s.email, "staff-pass-1")).ok).toBe(false);
  });
});

describe("unlockUser", () => {
  it("clears lockedUntil and failedLoginCount", async () => {
    const s = await seedStaff();
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 3 })
      .where(eq(users.id, s.id));
    expect((await unlockUser(db, s.id)).ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, s.id));
    expect(u.lockedUntil).toBeNull();
    expect(u.failedLoginCount).toBe(0);
  });
});
