import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@/lib/permissions";
import { hashPassword } from "@/server/auth/password";
import type { Db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
};

const columns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
};

const ERR_EMAIL = "올바른 이메일 주소를 입력하세요.";
const ERR_DUP = "이미 사용 중인 이메일입니다.";
const ERR_PW = "비밀번호는 8자 이상이어야 합니다.";
const ERR_NAME = "이름을 입력하세요.";
const ERR_LAST_ADMIN = "활성 시스템 관리자가 최소 1명 있어야 합니다.";
const ERR_NOT_FOUND = "사용자를 찾을 수 없습니다.";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

function isUniqueViolation(e: unknown): boolean {
  for (let cur = e as { code?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.code === "23505") return true;
  }
  return false;
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  return db.select(columns).from(users).orderBy(asc(users.createdAt), asc(users.email));
}

export async function createUser(
  db: Db,
  input: { email: string; name: string; role: Role; password: string },
): Promise<Result<UserRow>> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return fail(ERR_EMAIL);
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  if (input.password.length < 8) return fail(ERR_PW);

  const passwordHash = await hashPassword(input.password);
  try {
    const [row] = await db
      .insert(users)
      .values({ email: email.data, name, role: input.role, passwordHash })
      .returning(columns);
    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DUP);
    throw e;
  }
}

export async function updateUser(
  db: Db,
  id: string,
  patch: { name?: string; role?: Role; isActive?: boolean },
): Promise<Result> {
  const set: { name?: string; role?: Role; isActive?: boolean; updatedAt: SQL } = {
    updatedAt: sql`now()`,
  };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return fail(ERR_NAME);
    set.name = name;
  }
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  return db.transaction(async (tx): Promise<Result> => {
    // Lock all active admins so concurrent demotions serialize.
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
      .for("update");
    const [target] = await tx.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id));
    if (!target) return fail(ERR_NOT_FOUND);

    const wasActiveAdmin = target.role === "admin" && target.isActive;
    const willBeActiveAdmin =
      (set.role ?? target.role) === "admin" && (set.isActive ?? target.isActive);
    if (wasActiveAdmin && !willBeActiveAdmin && admins.length <= 1) return fail(ERR_LAST_ADMIN);

    await tx.update(users).set(set).where(eq(users.id, id));
    if (patch.isActive === false) await tx.delete(sessions).where(eq(sessions.userId, id));
    return ok();
  });
}

export async function resetPassword(db: Db, id: string, password: string): Promise<Result> {
  if (password.length < 8) return fail(ERR_PW);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx): Promise<Result> => {
    const updated = await tx
      .update(users)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (updated.length === 0) return fail(ERR_NOT_FOUND);
    await tx.delete(sessions).where(eq(sessions.userId, id));
    return ok();
  });
}

export async function unlockUser(db: Db, id: string): Promise<Result> {
  const updated = await db
    .update(users)
    .set({ lockedUntil: null, failedLoginCount: 0, updatedAt: sql`now()` })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return updated.length === 0 ? fail(ERR_NOT_FOUND) : ok();
}
