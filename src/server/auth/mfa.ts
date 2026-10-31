import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { can, type Role } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions, users, userTotp } from "@/server/db/schema";
import {
  decryptSecret,
  encryptSecret,
  keyedHash,
  InvalidEncryptionKeyError,
  MissingEncryptionKeyError,
} from "@/server/crypto/secret";
import { fail, ok, type Result } from "@/server/result";
import { clearFailedAttempts, LOCKED_MESSAGE, recordFailedAttempt } from "./lockout";
import { hashSessionToken } from "./token";
import { generateTotpSecret, matchTotpStep, otpauthUrl } from "./totp";

export const WRONG_CODE = "인증 코드가 올바르지 않습니다.";
export const ENCRYPTION_KEY_MISSING_PAGE =
  "서버 설정 오류: PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.";

/** Page message for a missing key, or the key's own message when it is set but malformed. */
export function encryptionKeyMessage(e: MissingEncryptionKeyError): string {
  return e instanceof InvalidEncryptionKeyError
    ? `서버 설정 오류: ${e.message} 관리자에게 문의하세요.`
    : ENCRYPTION_KEY_MISSING_PAGE;
}
const NO_ENROLMENT = "등록 정보가 없습니다. 화면을 새로 고쳐 다시 등록하세요.";
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

/** Keyed HMAC, so a leaked table cannot be brute-forced over the ~40-bit code space. */
function hashRecoveryCode(code: string): string {
  return keyedHash("totp-recovery", normalizeRecoveryCode(code));
}

/**
 * Runs `fn`, turning only a missing or malformed PAYROLL_ENCRYPTION_KEY into the page message (so the 2FA
 * screens explain the problem instead of a 500). Every other error is rethrown.
 */
export async function withEncryptionKey<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof MissingEncryptionKeyError) return fail(encryptionKeyMessage(e));
    throw e;
  }
}

export async function isTotpEnabled(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: userTotp.userId })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)));
  return !!row;
}

const stepIsNew = (step: number) =>
  or(isNull(userTotp.lastUsedStep), lt(userTotp.lastUsedStep, step));

/** Records `step` as used; false when it is not newer than the last used one (a replay). */
async function consumeStep(db: Db, userId: string, step: number): Promise<boolean> {
  const updated = await db
    .update(userTotp)
    .set({ lastUsedStep: step })
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt), stepIsNew(step)))
    .returning({ userId: userTotp.userId });
  return updated.length > 0;
}

/**
 * Starts enrolment. A not-yet-confirmed row keeps its secret (a refresh or prefetch must not
 * invalidate a QR code already scanned); a new one is created only when none exists. Refuses
 * when TOTP is already enabled.
 */
export async function startEnrolment(
  db: Db,
  userId: string,
): Promise<{ secret: string; otpauth: string }> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new Error("사용자를 찾을 수 없습니다.");
  const read = () =>
    db
      .select({ secret: userTotp.secret, enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, userId));
  let [row] = await read();
  if (!row) {
    await db
      .insert(userTotp)
      .values({ userId, secret: encryptSecret(generateTotpSecret()) })
      .onConflictDoNothing({ target: userTotp.userId });
    [row] = await read(); // a concurrent request may have inserted first: use its secret
  }
  if (!row) throw new Error("2단계 인증 등록을 시작하지 못했습니다.");
  if (row.enabledAt) throw new Error("이미 2단계 인증이 등록되어 있습니다.");
  const secret = decryptSecret(row.secret);
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
  if (!row) return fail(NO_ENROLMENT);
  const step = matchTotpStep(decryptSecret(row.secret), code, now);
  if (step === null) return fail(WRONG_CODE);

  const recoveryCodes = Array.from({ length: RECOVERY_COUNT }, randomRecoveryCode);
  const updated = await db
    .update(userTotp)
    .set({
      enabledAt: now,
      recoveryCodes: recoveryCodes.map(hashRecoveryCode),
      lastUsedStep: step,
    })
    .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt), stepIsNew(step)))
    .returning({ userId: userTotp.userId });
  if (updated.length === 0) return fail(NO_ENROLMENT);
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
    const step = matchTotpStep(decryptSecret(row.secret), typed, now);
    valid = step !== null && (await consumeStep(db, row.userId, step));
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

/**
 * Turns TOTP off after a current code. Only for roles that do not require it; failures count
 * toward the same lockout as a login.
 */
export async function disableTotp(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<Result> {
  const [row] = await db
    .select({ role: users.role, lockedUntil: users.lockedUntil, secret: userTotp.secret })
    .from(users)
    .innerJoin(userTotp, eq(userTotp.userId, users.id))
    .where(and(eq(users.id, userId), isNotNull(userTotp.enabledAt)));
  if (!row) return fail("2단계 인증을 사용하고 있지 않습니다.");
  if (mfaRequired(row.role)) return fail("이 역할은 2단계 인증을 끌 수 없습니다.");
  if (row.lockedUntil && row.lockedUntil > now) return fail(LOCKED_MESSAGE);

  const step = matchTotpStep(decryptSecret(row.secret), code, now);
  if (step === null || !(await consumeStep(db, userId, step))) {
    const reason = await recordFailedAttempt(db, userId, now);
    return fail(reason === "locked" ? LOCKED_MESSAGE : WRONG_CODE);
  }
  if (!(await clearFailedAttempts(db, userId, now))) return fail(LOCKED_MESSAGE);
  await db.delete(userTotp).where(eq(userTotp.userId, userId));
  return ok();
}
