"use server";

import { revalidatePath } from "next/cache";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  createUser,
  resetPassword,
  unlockUser,
  updateUser,
} from "@/server/users/service";

export type UserActionState = { error?: string; success?: boolean };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const parseRole = (v: string): Role | null =>
  v in ROLE_LABELS ? (v as Role) : null;

const INVALID = "입력값이 올바르지 않습니다.";

export async function createUserAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const role = parseRole(str(fd, "role"));
  if (!role) return { error: INVALID };
  const r = await createUser(db, {
    email: str(fd, "email"),
    name: str(fd, "name"),
    role,
    password: str(fd, "password"),
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUserAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const role = parseRole(str(fd, "role"));
  if (!role) return { error: INVALID };
  const r = await updateUser(db, str(fd, "id"), {
    name: str(fd, "name"),
    role,
    isActive: str(fd, "isActive") === "true",
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function resetPasswordAction(
  _prev: UserActionState,
  fd: FormData,
): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const r = await resetPassword(db, str(fd, "id"), str(fd, "password"));
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function unlockUserAction(id: string): Promise<UserActionState> {
  await requirePermission("settings:manage");
  const r = await unlockUser(db, id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/users");
  return { success: true };
}
