import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/server/auth/password";
import { createDb, type Db } from "../src/server/db/client";
import { sessions, users, userTotp } from "../src/server/db/schema";

/**
 * Sets a new password, clears lock/failed counter, and deletes the user's sessions.
 * With `reset2fa` it also deletes the TOTP enrolment, so the next login enrols again.
 */
export async function resetUserPassword(
  db: Db,
  emailInput: string,
  password: string,
  opts: { reset2fa?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailInput.trim().toLowerCase();
  if (password.length < 8) return { ok: false, error: "비밀번호는 8자 이상이어야 합니다." };
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash, lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    if (updated.length === 0) return { ok: false as const, error: "사용자를 찾을 수 없습니다." };
    await tx.delete(sessions).where(eq(sessions.userId, updated[0].id));
    if (opts.reset2fa) await tx.delete(userTotp).where(eq(userTotp.userId, updated[0].id));
    return { ok: true as const };
  });
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const args = process.argv.slice(2);
  const reset2fa = args.includes("--reset-2fa");
  const email = args.find((a) => !a.startsWith("--")) ?? "";
  const password = process.env.NEW_PASSWORD ?? "";
  if (!email) throw new Error("usage: NEW_PASSWORD=... pnpm admin:reset-password <email> [--reset-2fa]");
  const db = createDb(url);
  try {
    const r = await resetUserPassword(db, email, password, { reset2fa });
    if (!r.ok) {
      console.error(r.error);
      process.exit(1);
    }
    console.log(
      `password reset for ${email.trim().toLowerCase()}${reset2fa ? " (2단계 인증 등록 해제)" : ""}`,
    );
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
