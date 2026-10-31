import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import type { Role } from "@/lib/permissions";
import { sessions, users, userTotp } from "@/server/db/schema";
import { decryptSecret, keyedHash } from "@/server/crypto/secret";
import {
  confirmEnrolment,
  disableTotp,
  ENCRYPTION_KEY_MISSING_PAGE,
  isTotpEnabled,
  mfaRequired,
  startEnrolment,
  verifySecondFactor,
  withEncryptionKey,
} from "./mfa";
import { hashPassword } from "./password";
import { authenticate, createSession, getSessionUser, LOCK_MINUTES } from "./service";
import { hashSessionToken } from "./token";
import { totpCode } from "./totp";

const db = getTestDb();
const NOW = new Date("2026-03-02T01:00:00Z");
// enrol two steps before NOW, so a code at NOW is not a replay of the enrolment code
const ENROL_AT = new Date(NOW.getTime() - 60_000);

async function seedUser(role: Role, email = `${role}@acts.kr`) {
  const [u] = await db
    .insert(users)
    .values({ email, name: role, role, passwordHash: "x" })
    .returning();
  return u;
}

async function enrol(userId: string) {
  const { secret } = await startEnrolment(db, userId);
  const r = await confirmEnrolment(db, userId, totpCode(secret, ENROL_AT), ENROL_AT);
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
  it("stores the secret encrypted and reuses a not-yet-enabled row's secret", async () => {
    const u = await seedUser("admin");
    const first = await startEnrolment(db, u.id);
    expect(first.otpauth).toContain(`secret=${first.secret}`);
    const second = await startEnrolment(db, u.id);
    expect(second.secret).toBe(first.secret);
    expect(second.otpauth).toBe(first.otpauth);
    const rows = await db.select().from(userTotp).where(eq(userTotp.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].secret).not.toContain(first.secret);
    expect(decryptSecret(rows[0].secret)).toBe(first.secret);
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
    // keyed HMAC, not a bare sha256 of a ~40-bit code
    expect(row.recoveryCodes).toContain(keyedHash("totp-recovery", r.value.recoveryCodes[0]));
    expect(row.lastUsedStep).toBe(Math.floor(NOW.getTime() / 30_000));
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

  it("rejects the same code twice (replay)", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    const a = await createSession(db, u.id, NOW);
    const code = totpCode(secret, NOW);
    expect((await verifySecondFactor(db, a.token, code, NOW)).ok).toBe(true);
    const b = await createSession(db, u.id, NOW);
    expect(await verifySecondFactor(db, b.token, code, new Date(NOW.getTime() + 10_000))).toEqual({
      ok: false,
      error: "인증 코드가 올바르지 않습니다.",
    });
    // the previous step's code is older than the last used one, so it is refused too
    const prev = totpCode(secret, new Date(NOW.getTime() - 30_000));
    expect((await verifySecondFactor(db, b.token, prev, NOW)).ok).toBe(false);
    // the next step's code is still accepted
    const next = totpCode(secret, new Date(NOW.getTime() + 30_000));
    expect((await verifySecondFactor(db, b.token, next, NOW)).ok).toBe(true);
  });

  it("rejects the enrolment code when it is replayed at the second step", async () => {
    const u = await seedUser("admin");
    const { secret } = await startEnrolment(db, u.id);
    const code = totpCode(secret, NOW);
    expect((await confirmEnrolment(db, u.id, code, NOW)).ok).toBe(true);
    const { token } = await createSession(db, u.id, NOW);
    expect((await verifySecondFactor(db, token, code, NOW)).ok).toBe(false);
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

describe("voluntary enrolment and turning it off", () => {
  it("reports whether TOTP is enabled", async () => {
    const u = await seedUser("staff");
    expect(await isTotpEnabled(db, u.id)).toBe(false);
    await startEnrolment(db, u.id);
    expect(await isTotpEnabled(db, u.id)).toBe(false);
    await db.delete(userTotp);
    await enrol(u.id);
    expect(await isTotpEnabled(db, u.id)).toBe(true);
  });

  it("lets a staff user turn TOTP off with a current code", async () => {
    const u = await seedUser("staff");
    const { secret } = await enrol(u.id);
    const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, new Date(NOW.getTime() + d))));
    const wrong = ["000000", "111111", "222222"].find((c) => !valid.has(c))!;
    expect(await disableTotp(db, u.id, wrong, NOW)).toEqual({
      ok: false,
      error: "인증 코드가 올바르지 않습니다.",
    });
    expect(await isTotpEnabled(db, u.id)).toBe(true);
    expect((await disableTotp(db, u.id, totpCode(secret, NOW), NOW)).ok).toBe(true);
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, u.id))).toHaveLength(0);
  });

  it("refuses to turn TOTP off for a role that requires it", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    const r = await disableTotp(db, u.id, totpCode(secret, NOW), NOW);
    expect(r).toEqual({ ok: false, error: "이 역할은 2단계 인증을 끌 수 없습니다." });
    expect(await isTotpEnabled(db, u.id)).toBe(true);
  });
});

describe("withEncryptionKey", () => {
  const KEY = process.env.PAYROLL_ENCRYPTION_KEY;
  afterEach(() => {
    process.env.PAYROLL_ENCRYPTION_KEY = KEY;
  });

  it("turns a missing PAYROLL_ENCRYPTION_KEY into the page message", async () => {
    const u = await seedUser("admin");
    delete process.env.PAYROLL_ENCRYPTION_KEY;
    expect(await withEncryptionKey(() => startEnrolment(db, u.id))).toEqual({
      ok: false,
      error: ENCRYPTION_KEY_MISSING_PAGE,
    });
    expect(ENCRYPTION_KEY_MISSING_PAGE).toBe(
      "서버 설정 오류: PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.",
    );
  });

  it("covers the second step too", async () => {
    const u = await seedUser("admin");
    const { secret } = await enrol(u.id);
    const { token } = await createSession(db, u.id, NOW);
    delete process.env.PAYROLL_ENCRYPTION_KEY;
    expect(await withEncryptionKey(() => verifySecondFactor(db, token, totpCode(secret, NOW), NOW))).toEqual({
      ok: false,
      error: ENCRYPTION_KEY_MISSING_PAGE,
    });
  });

  it("rethrows any other error and passes values through", async () => {
    await expect(withEncryptionKey(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withEncryptionKey(async () => 7)).toEqual({ ok: true, value: 7 });
  });
});
