import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../tests/helpers/db";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import { createSession } from "../src/server/auth/service";
import { sessions, users, userTotp } from "../src/server/db/schema";
import { resetUserPassword } from "./reset-admin-password";

const db = getTestDb();

describe("resetUserPassword", () => {
  beforeEach(() => resetDb(db));

  it("sets the password, clears lock and sessions", async () => {
    const [u] = await db
      .insert(users)
      .values({
        email: "admin@acts.kr",
        name: "관리자",
        role: "admin",
        passwordHash: await hashPassword("old-password-1"),
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 600_000),
      })
      .returning();
    await createSession(db, u.id);

    const r = await resetUserPassword(db, " Admin@Acts.kr ", "new-password-1");
    expect(r.ok).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword("new-password-1", after.passwordHash)).toBe(true);
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginCount).toBe(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });

  it("rejects short passwords and unknown users", async () => {
    expect((await resetUserPassword(db, "x@acts.kr", "short")).ok).toBe(false);
    expect((await resetUserPassword(db, "nobody@acts.kr", "long-enough-1")).ok).toBe(false);
  });

  it("keeps the TOTP enrolment unless --reset-2fa is given", async () => {
    const [u] = await db
      .insert(users)
      .values({ email: "admin@acts.kr", name: "관리자", role: "admin", passwordHash: "x" })
      .returning();
    await db.insert(userTotp).values({ userId: u.id, secret: "v1:x:y:z", enabledAt: new Date() });

    expect((await resetUserPassword(db, "admin@acts.kr", "new-password-1")).ok).toBe(true);
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, u.id))).toHaveLength(1);

    const r = await resetUserPassword(db, "admin@acts.kr", "new-password-2", { reset2fa: true });
    expect(r.ok).toBe(true);
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, u.id))).toHaveLength(0);
  });
});
