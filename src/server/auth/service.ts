import { and, eq } from "drizzle-orm";
import type { Role } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions, users, userTotp } from "@/server/db/schema";
import { clearFailedAttempts, recordFailedAttempt } from "./lockout";
import { mfaRequired } from "./mfa";
import { hashPassword, verifyPassword } from "./password";
import { generateSessionToken, hashSessionToken } from "./token";

export { LOCK_MINUTES, MAX_FAILED_LOGINS } from "./lockout";
export const SESSION_HOURS = 12;

let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

export type SessionUser = { id: string; email: string; name: string; role: Role };

/**
 * - `pending`: enrolled in TOTP, but this session has not passed the second factor
 * - `unenrolled`: the role requires TOTP and the user has not enrolled yet
 * - `verified`: passed the second factor, or not required and not enrolled
 */
export type MfaState = "verified" | "pending" | "unenrolled";
export type SessionUserWithMfa = SessionUser & { mfa: MfaState };

export async function authenticate(
  db: Db,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<{ ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "locked" }> {
  const normalized = email.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, normalized));
  if (!u || !u.isActive) {
    // Equalize timing with the real-user path (no user enumeration).
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: "invalid" };
  }
  if (u.lockedUntil && u.lockedUntil > now) return { ok: false, reason: "locked" };

  const valid = await verifyPassword(password, u.passwordHash);
  if (!valid) return { ok: false, reason: await recordFailedAttempt(db, u.id, now) };
  // With TOTP enrolled, only the second factor clears the counter: otherwise each password login
  // would reset the TOTP failures and allow unlimited code guesses.
  const [totp] = await db
    .select({ enabledAt: userTotp.enabledAt })
    .from(userTotp)
    .where(eq(userTotp.userId, u.id));
  if (!totp?.enabledAt && !(await clearFailedAttempts(db, u.id, now))) {
    return { ok: false, reason: "locked" };
  }
  return { ok: true, user: { id: u.id, email: u.email, name: u.name, role: u.role } };
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionUserWithMfa | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      expiresAt: sessions.expiresAt,
      mfaVerified: sessions.mfaVerified,
      totpEnabledAt: userTotp.enabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userTotp, eq(userTotp.userId, users.id))
    .where(and(eq(sessions.id, hashSessionToken(token)), eq(users.isActive, true)));
  if (!row || row.expiresAt <= now) return null;
  const mfa: MfaState = row.totpEnabledAt
    ? row.mfaVerified
      ? "verified"
      : "pending"
    : mfaRequired(row.role)
      ? "unenrolled"
      : "verified";
  return { id: row.id, email: row.email, name: row.name, role: row.role, mfa };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}
