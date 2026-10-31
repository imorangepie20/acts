"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { parsePayItem, parsePayrollSettings } from "@/server/payroll/form";
import { deleteItem, saveItem } from "@/server/payroll/items";
import { savePayrollSettings } from "@/server/payroll/settings";
import { fail, type Result } from "@/server/result";

const INVALID = "입력값이 올바르지 않습니다.";

export async function savePayItemAction(input: unknown, mode: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const p = parsePayItem(input);
  if (!p.ok || (mode !== "create" && mode !== "update")) return fail(INVALID);
  const r = await saveItem(db, user, p.data, mode);
  if (r.ok) revalidatePath("/payroll/settings");
  return r;
}

export async function deletePayItemAction(code: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  if (typeof code !== "string") return fail(INVALID);
  const r = await deleteItem(db, user, code);
  if (r.ok) revalidatePath("/payroll/settings");
  return r;
}

export async function savePayrollSettingsAction(input: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const p = parsePayrollSettings(input);
  if (!p.ok) return fail(INVALID);
  const r = await savePayrollSettings(db, user, p.data);
  if (r.ok) revalidatePath("/payroll/settings");
  return r;
}
