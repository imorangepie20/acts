"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { encryptionKeyMessage } from "@/server/auth/mfa";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { createEmployee, revealEmployeeSecret, updateEmployee, type SecretField } from "@/server/payroll/employees";
import { parseCreateEmployee, parseUpdateEmployee } from "@/server/payroll/form";
import { fail, type Result } from "@/server/result";

/** Never carries submitted values back: the form keeps them itself, so no plain text is echoed. */
export type EmployeeActionState = { error?: string; id?: number };

const INVALID = "입력값이 올바르지 않습니다.";

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingEncryptionKeyError) return fail(encryptionKeyMessage(e));
    throw e;
  }
}

export async function createEmployeeAction(fd: FormData): Promise<EmployeeActionState> {
  const user = await requirePermission("payroll:manage");
  const p = parseCreateEmployee(fd);
  if (!p.ok) return { error: INVALID };
  const r = await guarded(() => createEmployee(db, user, p.data));
  if (!r.ok) return { error: r.error };
  revalidatePath("/payroll/employees");
  return { id: r.value.id };
}

export async function updateEmployeeAction(fd: FormData): Promise<EmployeeActionState> {
  const user = await requirePermission("payroll:manage");
  const p = parseUpdateEmployee(fd);
  if (!p.ok) return { error: INVALID };
  const r = await guarded(() => updateEmployee(db, user, p.data.id, p.data.input));
  if (!r.ok) return { error: r.error };
  revalidatePath("/payroll/employees");
  revalidatePath(`/payroll/employees/${p.data.id}`);
  return { id: p.data.id };
}

/** The 보기 button: the only path that returns a plain 주민등록번호 or account number. */
export async function revealEmployeeSecretAction(id: unknown, field: unknown): Promise<Result<string>> {
  const user = await requirePermission("payroll:manage");
  if (typeof id !== "number" || !Number.isSafeInteger(id) || (field !== "rrn" && field !== "account")) {
    return fail(INVALID);
  }
  return guarded(() => revealEmployeeSecret(db, user, id, field as SecretField));
}
