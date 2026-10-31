import "server-only";
import { createHash, randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { can, type Role } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions, users, userTotp } from "@/server/db/schema";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret";
import { fail, ok, type Result } from "@/server/result";
import { clearFailedAttempts, LOCKED_MESSAGE, recordFailedAttempt } from "./lockout";
import { hashSessionToken } from "./token";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";

export const WRONG_CODE = "인증 코드가 올바르지 않습니다.";
const RECOVERY_COUNT = 10;
// no 0/o, 1/l/i: the codes are read off paper
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** TOTP is mandatory for every role that can see payroll or change settings. */
export function mfaRequired(role: Role): boolean {
  return can(role, "payroll:manage") || can(role, "settings:manage");
}

function randomRecoveryCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function normalizeRecoveryCode(input: string): string {
  const s = input.replace(/[\s-]/g, "").toLowerCase();
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Starts (or restarts) enrolment with a fresh secret. Refuses when TOTP is already enabled. */
export async function startEnrolment(
  db: Db,
  userId: string,
): Promise<{ secret: string; otpauth: string }> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new Error("사용자를 찾을 수 없습니다.");
  const secret = generateTotpSecret();
  const stored = encryptSecret(secret);
  const saved = await db
    .insert(userTotp)
    .values({ userId, secret: stored })
    .onConflictDoUpdate({
      target: userTotp.userId,
      set: { secret: stored, recoveryCodes: sql`'{}'::text[]`, createdAt: sql`now()` },
      setWhere: isNull(userTotp.enabledAt),
    })
    .returning({ userId: userTotp.userId });
  if (saved.length === 0) throw new Error("이미 2단계 인증이 등록되어 있습니다.");
  return { secret, otpauth: otpauthUrl(secret, u.email) };
}

/** Enables TOTP once the user types a valid code; the recovery codes are returned only here. */
export async function confirmEnrolment(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<Result<{ recoveryCodes: string[] }>> {
  const [row] = await db
    .select({ secret: userTotp.secret })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt)));
  if (!row) return fail("등록 정보가 없습니다. 화면을 새로 고쳐 다시 등록하세요.");
  if (!verifyTotp(decryptSecret(row.secret), code, now)) return fail(WRONG_CODE);

  const recoveryCodes = Array.from({ length: RECOVERY_COUNT }, randomRecoveryCode);
  const updated = await db
    .update(userTotp)
    .set({ enabledAt: now, recoveryCodes: recoveryCodes.map(hashRecoveryCode) })
    .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt)))
    .returning({ userId: userTotp.userId });
  if (updated.length === 0) return fail("등록 정보가 없습니다. 화면을 새로 고쳐 다시 등록하세요.");
  return ok({ recoveryCodes });
}

export async function markSessionMfaVerified(db: Db, sessionToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerified: true })
    .where(eq(sessions.id, hashSessionToken(sessionToken)));
}

/**
 * Second login step: a TOTP code, or an unused recovery code (consumed). Failures share the
 * password rule (5 failures lock the user for 15 minutes).
 */
export async function verifySecondFactor(
  db: Db,
  sessionToken: string,
  code: string,
  now: Date = new Date(),
): Promise<Result> {
  const [row] = await db
    .select({
      userId: users.id,
      lockedUntil: users.lockedUntil,
      expiresAt: sessions.expiresAt,
      secret: userTotp.secret,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(userTotp, eq(userTotp.userId, users.id))
    .where(
      and(
        eq(sessions.id, hashSessionToken(sessionToken)),
        eq(users.isActive, true),
        isNotNull(userTotp.enabledAt),
      ),
    );
  if (!row || row.expiresAt <= now) return fail(WRONG_CODE);
  if (row.lockedUntil && row.lockedUntil > now) return fail(LOCKED_MESSAGE);

  const typed = code.trim();
  let valid: boolean;
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    valid = verifyTotp(decryptSecret(row.secret), typed, now);
  } else {
    const hash = hashRecoveryCode(typed);
    const consumed = await db
      .update(userTotp)
      .set({ recoveryCodes: sql`array_remove(${userTotp.recoveryCodes}, ${hash})` })
      .where(and(eq(userTotp.userId, row.userId), sql`${hash} = ANY(${userTotp.recoveryCodes})`))
      .returning({ userId: userTotp.userId });
    valid = consumed.length > 0;
  }

  if (!valid) {
    const reason = await recordFailedAttempt(db, row.userId, now);
    return fail(reason === "locked" ? LOCKED_MESSAGE : WRONG_CODE);
  }
  if (!(await clearFailedAttempts(db, row.userId, now))) return fail(LOCKED_MESSAGE);
  await markSessionMfaVerified(db, sessionToken);
  return ok();
}
