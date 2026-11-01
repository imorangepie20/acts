"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { parsePayItem, parsePayrollSettings } from "@/server/payroll/form";
import { deleteItem, saveItem } from "@/server/payroll/items";
import type { EmployerRateKind } from "@/lib/payroll/employer-rates";
import { addEmployerRate, deleteEmployerRate } from "@/server/payroll/rates";
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

export async function addEmployerRateAction(input: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  if (typeof input !== "object" || input === null) return fail(INVALID);
  const { kind, effectiveFrom, value } = input as Record<string, unknown>;
  if (typeof kind !== "string" || typeof effectiveFrom !== "string" || typeof value !== "number") return fail(INVALID);
  // The service checks the kind against the 사업주 부담 kinds.
  const r = await addEmployerRate(db, user, { kind: kind as EmployerRateKind, effectiveFrom, value });
  if (r.ok) revalidatePath("/payroll/settings");
  return r;
}

export async function deleteEmployerRateAction(id: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  if (typeof id !== "number") return fail(INVALID);
  const r = await deleteEmployerRate(db, user, id);
  if (r.ok) revalidatePath("/payroll/settings");
  return r;
}
