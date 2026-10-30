import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { sessions, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "./password";

vi.mock("./password", async (orig) => {
  const m = await orig<typeof import("./password")>();
  return { ...m, verifyPassword: vi.fn(m.verifyPassword) };
});
import { hashSessionToken } from "./token";
import {
  authenticate,
  createSession,
  deleteSession,
  getSessionUser,
  LOCK_MINUTES,
} from "./service";

const db = getTestDb();
const PW = "pw-12345678";
const EMAIL = "kim@acts.kr";

async function row() {
  const [r] = await db.select().from(users).where(eq(users.email, EMAIL));
  return r;
}
async function userId() {
  return (await row()).id;
}

beforeEach(async () => {
  await resetDb(db);
  await db.insert(users).values({
    email: EMAIL,
    name: "김실무",
    role: "staff",
    passwordHash: await hashPassword(PW),
  });
});

describe("authenticate", () => {
  it("stamps updatedAt from the DB clock on login, not the injected now", async () => {
    const [{ t }] = (await db.execute(sql`select now() as t`)) as unknown as { t: Date }[];
    const r = await authenticate(db, EMAIL, PW, new Date("2020-01-01T00:00:00Z"));
    expect(r.ok).toBe(true);
    expect((await row()).updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(t).getTime());
  });

  it("normalizes email", async () => {
    const r = await authenticate(db, "  Kim@ACTS.kr ", PW);
    expect(r.ok).toBe(true);
  });

  it("locks on 5th wrong attempt and rejects correct password while locked", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      expect(await authenticate(db, EMAIL, "bad", now)).toEqual({ ok: false, reason: "invalid" });
    }
    expect((await row()).lockedUntil).toBeNull();
    expect(await authenticate(db, EMAIL, "bad", now)).toEqual({ ok: false, reason: "invalid" });
    const locked = (await row()).lockedUntil;
    expect(locked).not.toBeNull();
    expect(locked!.getTime()).toBe(now.getTime() + LOCK_MINUTES * 60_000);
    expect(await authenticate(db, EMAIL, PW, now)).toEqual({ ok: false, reason: "locked" });

    const later = new Date(now.getTime() + 16 * 60_000);
    const r = await authenticate(db, EMAIL, PW, later);
    expect(r.ok).toBe(true);
    expect((await row()).failedLoginCount).toBe(0);
  });

  it("concurrent wrong attempts still lock the account", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => authenticate(db, EMAIL, "bad", now)),
    );
    expect(rs.every((r) => !r.ok)).toBe(true);
    expect((await row()).lockedUntil).not.toBeNull();
    expect(await authenticate(db, EMAIL, PW, now)).toEqual({ ok: false, reason: "locked" });
  });

  it("attempt while locked leaves failedLoginCount unchanged", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 5; i++) await authenticate(db, EMAIL, "bad", now);
    const before = await row();
    await authenticate(db, EMAIL, "bad", now);
    await authenticate(db, EMAIL, PW, now);
    const after = await row();
    expect(after.failedLoginCount).toBe(before.failedLoginCount);
    expect(after.lockedUntil).toEqual(before.lockedUntil);
  });

  it("unknown and inactive users still run a password verification", async () => {
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    await authenticate(db, "nobody@acts.kr", PW);
    expect(spy).toHaveBeenCalledTimes(1);
    await db.update(users).set({ isActive: false }).where(eq(users.email, EMAIL));
    await authenticate(db, EMAIL, PW);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("successful login resets failed count", async () => {
    await authenticate(db, EMAIL, "bad");
    await authenticate(db, EMAIL, "bad");
    expect((await row()).failedLoginCount).toBe(2);
    expect((await authenticate(db, EMAIL, PW)).ok).toBe(true);
    expect((await row()).failedLoginCount).toBe(0);
  });

  it("rejects unknown email and inactive user", async () => {
    expect(await authenticate(db, "nobody@acts.kr", PW)).toEqual({ ok: false, reason: "invalid" });
    await db.update(users).set({ isActive: false }).where(eq(users.email, EMAIL));
    expect(await authenticate(db, EMAIL, PW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("sessions", () => {
  it("creates and resolves a session, storing only the token hash", async () => {
    const { token } = await createSession(db, await userId());
    const user = await getSessionUser(db, token);
    expect(user).toMatchObject({ email: EMAIL, name: "김실무", role: "staff" });
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashSessionToken(token));
    expect(rows[0].id).not.toBe(token);
  });

  it("expires", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { token, expiresAt } = await createSession(db, await userId(), now);
    expect(await getSessionUser(db, token, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it("rejects session of deactivated user", async () => {
    const { token } = await createSession(db, await userId());
    await db.update(users).set({ isActive: false }).where(eq(users.email, EMAIL));
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it("deleteSession invalidates", async () => {
    const { token } = await createSession(db, await userId());
    await deleteSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });
});
