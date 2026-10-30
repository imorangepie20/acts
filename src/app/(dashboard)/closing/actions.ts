"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/dal";
import { closeMonth, reopenMonth } from "@/server/closing/periods";
import { db } from "@/server/db";
import { fail, type Result } from "@/server/result";

const INVALID = "입력값이 올바르지 않습니다.";
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function revalidate() {
  revalidatePath("/closing");
  // Voucher detail pages show the 마감됨 badge and hide their actions.
  revalidatePath("/vouchers", "layout");
}

export async function closeMonthAction(month: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const m = monthSchema.safeParse(month);
  if (!m.success) return fail(INVALID);
  const r = await closeMonth(db, user, m.data);
  if (r.ok) revalidate();
  return r;
}

export async function reopenMonthAction(month: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const m = monthSchema.safeParse(month);
  if (!m.success) return fail(INVALID);
  const r = await reopenMonth(db, user, m.data);
  if (r.ok) revalidate();
  return r;
}
