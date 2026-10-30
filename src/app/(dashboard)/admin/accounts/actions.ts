"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { createAccount, updateAccount } from "@/server/accounts/service";
import { parseCreateAccount, parseUpdateAccount } from "@/server/accounts/form";

export type AccountActionState = {
  error?: string;
  success?: boolean;
  /** Submitted fields, echoed back so the form keeps them after an error. */
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
const failState = (fd: FormData, keys: string[], error: string): AccountActionState => ({
  error,
  values: echo(fd, keys),
  nonce: Date.now(),
});

export async function createAccountAction(
  _prev: AccountActionState,
  fd: FormData,
): Promise<AccountActionState> {
  await requirePermission("settings:manage");
  const keys = ["code", "name", "group", "requiresPartner", "dashboardRole"];
  const p = parseCreateAccount(fd);
  if (!p.ok) return failState(fd, keys, INVALID);
  const r = await createAccount(db, p.data);
  if (!r.ok) return failState(fd, keys, r.error);
  revalidatePath("/admin/accounts");
  return { success: true };
}

export async function updateAccountAction(
  _prev: AccountActionState,
  fd: FormData,
): Promise<AccountActionState> {
  await requirePermission("settings:manage");
  const keys = ["name", "group", "requiresPartner", "isActive", "dashboardRole"];
  const p = parseUpdateAccount(fd);
  if (!p.ok) return failState(fd, keys, INVALID);
  const { id, ...patch } = p.data;
  const r = await updateAccount(db, id, patch);
  if (!r.ok) return failState(fd, keys, r.error);
  revalidatePath("/admin/accounts");
  return { success: true };
}
