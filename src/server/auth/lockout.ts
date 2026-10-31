import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const LOCKED_MESSAGE = "로그인 실패가 반복되어 계정이 잠겼습니다. 15분 후 다시 시도하세요.";

const unlocked = (now: Date) => or(isNull(users.lockedUntil), lte(users.lockedUntil, now));

/**
 * Counts one failed password or second-factor attempt; the 5th locks the user for 15 minutes.
 * Atomic increment; refuses to touch the row if a lock was set meanwhile.
 */
export async function recordFailedAttempt(
  db: Db,
  userId: string,
  now: Date,
): Promise<"invalid" | "locked"> {
  const nextCount = sql`${users.failedLoginCount} + 1`;
  const reached = sql`${nextCount} >= ${MAX_FAILED_LOGINS}`;
  const lockAt = new Date(now.getTime() + LOCK_MINUTES * 60_000);
  const updated = await db
    .update(users)
    .set({
      failedLoginCount: sql`CASE WHEN ${reached} THEN 0 ELSE ${nextCount} END`,
      lockedUntil: sql`CASE WHEN ${reached} THEN ${lockAt.toISOString()}::timestamptz ELSE ${users.lockedUntil} END`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(users.id, userId), unlocked(now)))
    .returning({ id: users.id });
  return updated.length === 0 ? "locked" : "invalid";
}

/** Clears the failed counter after a successful attempt; false if the user got locked meanwhile. */
export async function clearFailedAttempts(db: Db, userId: string, now: Date): Promise<boolean> {
  const cleared = await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: sql`now()` })
    .where(and(eq(users.id, userId), unlocked(now)))
    .returning({ id: users.id });
  return cleared.length > 0;
}
