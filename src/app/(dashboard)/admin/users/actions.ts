"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  isUserId,
  parseCreateUser,
  parseResetPassword,
  parseUpdateUser,
} from "@/server/users/form";
import {
  createUser,
  resetPassword,
  unlockUser,
  updateUser,
} from "@/server/users/service";

export type UserActionState = {
  error?: string;
  success?: boolean;
  /** Submitted non-secret fields, echoed back so the form keeps them after an error. */
  values?: Record<string, string>;
  /** Changes on every submission so React re-applies the default values. */
  nonce?: number;
};

const INVALID = "입력값이 올바르지 않습니다.";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const echo = (fd: FormData, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, str(fd, k)]));
const failState = (fd: FormData, keys: string[], error: string): UserActionState => ({
  error,
  values: echo(fd, keys),
  nonce: Date.now(),
});

export async function createUserAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const keys = ["email", "name", "role"];
  const p = parseCreateUser(fd);
  if (!p.ok) return failState(fd, keys, INVALID);
  const r = await createUser(db, p.data);
  if (!r.ok) return failState(fd, keys, r.error);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUserAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const keys = ["name", "role", "isActive"];
  const p = parseUpdateUser(fd);
  if (!p.ok) return failState(fd, keys, INVALID);
  const { id, ...patch } = p.data;
  const r = await updateUser(db, id, patch);
  if (!r.ok) return failState(fd, keys, r.error);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function resetPasswordAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const p = parseResetPassword(fd);
  if (!p.ok) return failState(fd, [], INVALID);
  const r = await resetPassword(db, p.data.id, p.data.password);
  if (!r.ok) return failState(fd, [], r.error);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function unlockUserAction(id: string): Promise<UserActionState> {
  await requirePermission("settings:manage");
  if (!isUserId(id)) return { error: INVALID };
  const r = await unlockUser(db, id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/users");
  return { success: true };
}
