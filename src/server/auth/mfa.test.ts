import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import type { Role } from "@/lib/permissions";
import { sessions, users, userTotp } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto/secret";
import { confirmEnrolment, mfaRequired, startEnrolment, verifySecondFactor } from "./mfa";
import { hashPassword } from "./password";
import { authenticate, createSession, getSessionUser, LOCK_MINUTES } from "./service";
import { hashSessionToken } from "./token";
import { totpCode } from "./totp";

const db = getTestDb();
const NOW = new Date("2026-03-02T01:00:00Z");

async function seedUser(role: Role, email = `${role}@acts.kr`) {
  const [u] = await db
    .insert(users)
    .values({ email, name: role, role, passwordHash: "x" })
    .returning();
  return u;
}

async function enrol(userId: string) {
  const { secret } = await startEnrolment(db, userId);
  const r = await confirmEnrolment(db, userId, totpCode(secret, NOW), NOW);
  if (!r.ok) throw new Error(r.error);
  return { secret, recoveryCodes: r.value.recoveryCodes };
}

async function sessionRow(token: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, hashSessionToken(token)));
  return s;
}

beforeEach(() => resetDb(db));

describe("mfaRequired", () => {
  it("is required for manager and admin only", () => {
    expect(mfaRequired("admin")).toBe(true);
    expect(mfaRequired("manager")).toBe(true);
    expect(mfaRequired("staff")).toBe(false);
    expect(mfaRequired("executive")).toBe(false);
  });
});

describe("enrolment", () => {
  it("stores the secret encrypted and replaces a not-yet-enabled row", async () => {
    const u = await seedUser("admin");
    const first = await startEnrolment(db, u.id);
    expect(first.otpauth).toContain(`secret=${first.secret}`);
    const second = await startEnrolment(db, u.id);
    const rows = await db.select().from(userTotp).where(eq(userTotp.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].secret).not.toContain(second.secret);
    expect(decryptSecret(rows[0].secret)).toBe(second.secret);
    expect(rows[0].enabledAt).toBeNull();
  });

  it("rejects a wrong code at confirm, then returns 10 recovery codes once", async () => {
    const u = await seedUser("admin");
    const { secret } = await startEnrolment(db, u.id);
    const wrong = await confirmEnrolment(db, u.id, "000000" === totpCode(secret, NOW) ? "111111" : "000000", NOW);
    expect(wrong).toEqual({ ok: false, error: "인증 코드가 올바르지 않습니다." });

    const r = await confirmEnrolment(db, u.id, totpCode(secret, NOW), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.recoveryCodes).toHaveLength(10);
    for (const c of r.value.recoveryCodes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, u.id));
    expect(row.enabledAt).not.toBeNull();
    expect(row.recoveryCodes).toHaveLength(10);
    expect(row.recoveryCodes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });

  it("refuses to restart an enabled enrolment", async () => {
    const u = await seedUser("admin");
    await enrol(u.id);
    await expect(startEnrolment(db, u.id)).rejects.toThrow();
  });
});

describe("verifySecondFactor", () => {
  it("accepts the current code and marks the session verified", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    const { token } = await createSession(db, u.id, NOW);
    expect((await sessionRow(token)).mfaVerified).toBe(false);
    const r = await verifySecondFactor(db, token, totpCode(secret, NOW), NOW);
    expect(r.ok).toBe(true);
    expect((await sessionRow(token)).mfaVerified).toBe(true);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("verified");
  });

  it("accepts a recovery code once", async () => {
    const u = await seedUser("admin");
    const { recoveryCodes } = await enrol(u.id);
    const a = await createSession(db, u.id, NOW);
    expect((await verifySecondFactor(db, a.token, ` ${recoveryCodes[3].toUpperCase()} `, NOW)).ok).toBe(true);
    const b = await createSession(db, u.id, NOW);
    expect(await verifySecondFactor(db, b.token, recoveryCodes[3], NOW)).toEqual({
      ok: false,
      error: "인증 코드가 올바르지 않습니다.",
    });
    expect((await sessionRow(b.token)).mfaVerified).toBe(false);
    const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, u.id));
    expect(row.recoveryCodes).toHaveLength(9);
  });

  it("locks the user after 5 wrong codes, shared with the login rule", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    const { token } = await createSession(db, u.id, NOW);
    const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, new Date(NOW.getTime() + d))));
    const wrong = ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
    for (let i = 0; i < 4; i++) {
      expect(await verifySecondFactor(db, token, wrong, NOW)).toEqual({
        ok: false,
        error: "인증 코드가 올바르지 않습니다.",
      });
    }
    const [mid] = await db.select().from(users).where(eq(users.id, u.id));
    expect(mid.failedLoginCount).toBe(4);
    expect(mid.lockedUntil).toBeNull();

    const fifth = await verifySecondFactor(db, token, wrong, NOW);
    expect(fifth.ok).toBe(false);
    const [locked] = await db.select().from(users).where(eq(users.id, u.id));
    expect(locked.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCK_MINUTES * 60_000);

    // even the right code is refused while locked
    const r = await verifySecondFactor(db, token, totpCode(secret, NOW), NOW);
    expect(r.ok).toBe(false);
    expect((await sessionRow(token)).mfaVerified).toBe(false);
  });

  it("a password login does not reset the second-factor failures", async () => {
    const [u] = await db
      .insert(users)
      .values({ email: "pw@acts.kr", name: "pw", role: "admin", passwordHash: await hashPassword("pw-12345678") })
      .returning();
    const { secret } = await enrol(u.id);
    const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, new Date(NOW.getTime() + d))));
    const wrong = ["000000", "111111", "222222"].find((c) => !valid.has(c))!;
    const a = await createSession(db, u.id, NOW);
    for (let i = 0; i < 4; i++) await verifySecondFactor(db, a.token, wrong, NOW);
    expect((await authenticate(db, "pw@acts.kr", "pw-12345678", NOW)).ok).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after.failedLoginCount).toBe(4);
    const b = await createSession(db, u.id, NOW);
    await verifySecondFactor(db, b.token, wrong, NOW);
    const [locked] = await db.select().from(users).where(eq(users.id, u.id));
    expect(locked.lockedUntil).not.toBeNull();
  });

  it("resets the failed counter on success", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    await db.update(users).set({ failedLoginCount: 3 }).where(eq(users.id, u.id));
    const { token } = await createSession(db, u.id, NOW);
    expect((await verifySecondFactor(db, token, totpCode(secret, NOW), NOW)).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.failedLoginCount).toBe(0);
  });

  it("fails for an unknown session or a user without enrolment", async () => {
    expect((await verifySecondFactor(db, "nope", "123456", NOW)).ok).toBe(false);
    const u = await seedUser("staff");
    const { token } = await createSession(db, u.id, NOW);
    expect((await verifySecondFactor(db, token, "123456", NOW)).ok).toBe(false);
  });
});

describe("getSessionUser mfa state", () => {
  it("is unenrolled for an admin without a row", async () => {
    const u = await seedUser("admin");
    const { token } = await createSession(db, u.id, NOW);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("unenrolled");
  });

  it("is unenrolled for an admin with a not-yet-confirmed row", async () => {
    const u = await seedUser("admin");
    await startEnrolment(db, u.id);
    const { token } = await createSession(db, u.id, NOW);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("unenrolled");
  });

  it("is verified for a staff user without a row", async () => {
    const u = await seedUser("staff");
    const { token } = await createSession(db, u.id, NOW);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("verified");
  });

  it("is pending for an enrolled admin's fresh session", async () => {
    const u = await seedUser("admin");
    await enrol(u.id);
    const { token } = await createSession(db, u.id, NOW);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("pending");
  });

  it("is pending for an enrolled staff user's fresh session", async () => {
    const u = await seedUser("staff");
    await enrol(u.id);
    const { token } = await createSession(db, u.id, NOW);
    expect((await getSessionUser(db, token, NOW))?.mfa).toBe("pending");
  });
});
