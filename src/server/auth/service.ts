import { and, eq } from "drizzle-orm";
import type { Role } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { verifyPassword } from "./password";
import { generateSessionToken, hashSessionToken } from "./token";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 12;

export type SessionUser = { id: string; email: string; name: string; role: Role };

export async function authenticate(
  db: Db,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<{ ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "locked" }> {
  const normalized = email.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, normalized));
  if (!u || !u.isActive) return { ok: false, reason: "invalid" };
  if (u.lockedUntil && u.lockedUntil > now) return { ok: false, reason: "locked" };

  const valid = await verifyPassword(password, u.passwordHash);
  if (!valid) {
    const count = u.failedLoginCount + 1;
    if (count >= MAX_FAILED_LOGINS) {
      await db
        .update(users)
        .set({
          failedLoginCount: 0,
          lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000),
          updatedAt: now,
        })
        .where(eq(users.id, u.id));
    } else {
      await db
        .update(users)
        .set({ failedLoginCount: count, updatedAt: now })
        .where(eq(users.id, u.id));
    }
    return { ok: false, reason: "invalid" };
  }

  if (u.failedLoginCount !== 0 || u.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, u.id));
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
): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashSessionToken(token)), eq(users.isActive, true)));
  if (!row || row.expiresAt <= now) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}
