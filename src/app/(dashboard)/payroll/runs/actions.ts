"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isUuid } from "@/lib/uuid";
import { requirePermission } from "@/server/auth/dal";
import { ENCRYPTION_KEY_MISSING_PAGE } from "@/server/auth/mfa";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import {
  addEmployeeToRun,
  cancelConfirm,
  confirmRun,
  createRun,
  deleteRun,
  previewRunVoucher,
  recomputeRun,
  removeEmployeeFromRun,
  updateRunLines,
  type RunLineChange,
  type VoucherPreviewRow,
} from "@/server/payroll/runs";
import { fail, type Result } from "@/server/result";

const INVALID = "입력값이 올바르지 않습니다.";

const runId = z.string().refine(isUuid);
const version = z.number().int().nonnegative();
const employeeId = z.number().int().positive();
const won = z.number().int();

const createSchema = z.object({
  type: z.enum(["regular", "bonus"]),
  yearMonth: z.string(),
  payDate: z.string(),
  bonusFrom: z.string().nullable(),
  bonusTo: z.string().nullable(),
});

const changesSchema = z
  .array(
    z.object({
      employeeId,
      amounts: z.record(z.string(), won).optional(),
      overrides: z
        .object({
          pension: won.nullable(),
          health: won.nullable(),
          ltc: won.nullable(),
          employment: won.nullable(),
          incomeTax: won.nullable(),
          localTax: won.nullable(),
        })
        .partial()
        .strict()
        .optional(),
    }),
  )
  .min(1)
  .max(1000);

/** Creating, adding and recomputing read the masked 주민등록번호, which needs the key. */
async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingEncryptionKeyError) return fail(ENCRYPTION_KEY_MISSING_PAGE);
    throw e;
  }
}

function revalidate(id?: string, voucher = false) {
  revalidatePath("/payroll/runs");
  if (id) revalidatePath(`/payroll/runs/${id}`, "layout");
  // Confirm and cancel write or delete the payroll voucher.
  if (voucher) revalidatePath("/vouchers", "layout");
}

export async function createRunAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requirePermission("payroll:manage");
  const p = createSchema.safeParse(input);
  if (!p.success) return fail(INVALID);
  const r = await guarded(() => createRun(db, user, p.data));
  if (r.ok) revalidate();
  return r;
}

export async function updateRunLinesAction(id: unknown, v: unknown, changes: unknown): Promise<Result<{ version: number }>> {
  const user = await requirePermission("payroll:manage");
  const pid = runId.safeParse(id);
  const pv = version.safeParse(v);
  const pc = changesSchema.safeParse(changes);
  if (!pid.success || !pv.success || !pc.success) return fail(INVALID);
  const r = await updateRunLines(db, user, pid.data, pv.data, pc.data as RunLineChange[]);
  if (r.ok) revalidate(pid.data);
  return r;
}

type RunOp = (id: string, v: number) => Promise<Result>;

async function runOp(id: unknown, v: unknown, op: RunOp): Promise<Result> {
  const pid = runId.safeParse(id);
  const pv = version.safeParse(v);
  if (!pid.success || !pv.success) return fail(INVALID);
  return guarded(() => op(pid.data, pv.data));
}

export async function addEmployeeToRunAction(id: unknown, v: unknown, employee: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const pe = employeeId.safeParse(employee);
  if (!pe.success) return fail(INVALID);
  const r = await runOp(id, v, (i, ver) => addEmployeeToRun(db, user, i, ver, pe.data));
  if (r.ok) revalidate(id as string);
  return r;
}

export async function removeEmployeeFromRunAction(id: unknown, v: unknown, employee: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const pe = employeeId.safeParse(employee);
  if (!pe.success) return fail(INVALID);
  const r = await runOp(id, v, (i, ver) => removeEmployeeFromRun(db, user, i, ver, pe.data));
  if (r.ok) revalidate(id as string);
  return r;
}

export async function recomputeRunAction(id: unknown, v: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const r = await runOp(id, v, (i, ver) => recomputeRun(db, user, i, ver));
  if (r.ok) revalidate(id as string);
  return r;
}

export async function confirmRunAction(id: unknown, v: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const r = await runOp(id, v, (i, ver) => confirmRun(db, user, i, ver));
  if (r.ok) revalidate(id as string, true);
  return r;
}

export async function cancelConfirmAction(id: unknown, v: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const r = await runOp(id, v, (i, ver) => cancelConfirm(db, user, i, ver));
  if (r.ok) revalidate(id as string, true);
  return r;
}

export async function deleteRunAction(id: unknown, v: unknown): Promise<Result> {
  const user = await requirePermission("payroll:manage");
  const r = await runOp(id, v, (i, ver) => deleteRun(db, user, i, ver));
  if (r.ok) revalidate();
  return r;
}

export async function previewRunVoucherAction(id: unknown): Promise<Result<VoucherPreviewRow[]>> {
  await requirePermission("payroll:manage");
  const pid = runId.safeParse(id);
  if (!pid.success) return fail(INVALID);
  return previewRunVoucher(db, pid.data);
}
