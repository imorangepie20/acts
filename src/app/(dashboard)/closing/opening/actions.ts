"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/dal";
import { saveOpening } from "@/server/closing/opening";
import { closeFiscalYear, reopenFiscalYear, saveTaxFigures } from "@/server/closing/year";
import { db } from "@/server/db";
import { fail, type Result } from "@/server/result";

const INVALID = "입력값이 올바르지 않습니다.";

// Ranges (date validity, integer balances, |balance| <= MAX_WON) are the service's rules and messages.
const schema = z.object({
  date: z.string().max(10),
  version: z.number().int().positive().nullable(),
  lines: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        partnerId: z.number().int().positive().nullable(),
        balance: z.number(), // zod 4 rejects NaN and ±Infinity
      }),
    )
    .max(5000),
});

export async function saveOpeningAction(input: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(INVALID);
  const r = await saveOpening(db, user, parsed.data);
  if (r.ok) {
    revalidatePath("/closing/opening");
    // Balances moved in every report and dashboard; the voucher list shows the 기초 voucher.
    revalidatePath("/", "layout");
  }
  return r;
}

const figuresSchema = z.object({
  totalAssets: z.number().int(),
  totalLiabilities: z.number().int(),
  totalEquity: z.number().int(),
  netIncome: z.number().int(),
});
const yearSchema = z.string().max(10);

function revalidateYear() {
  revalidatePath("/closing/opening");
  revalidatePath("/closing"); // months inside a closed year cannot be reopened
}

export async function saveTaxFiguresAction(fiscalStart: unknown, figures: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const fs = yearSchema.safeParse(fiscalStart);
  const f = figuresSchema.safeParse(figures);
  if (!fs.success || !f.success) return fail(INVALID);
  const r = await saveTaxFigures(db, user, fs.data, f.data);
  if (r.ok) revalidateYear();
  return r;
}

export async function closeFiscalYearAction(fiscalStart: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const fs = yearSchema.safeParse(fiscalStart);
  if (!fs.success) return fail(INVALID);
  const r = await closeFiscalYear(db, user, fs.data);
  if (r.ok) revalidateYear();
  return r;
}

export async function reopenFiscalYearAction(fiscalStart: unknown): Promise<Result> {
  const user = await requirePermission("period:close");
  const fs = yearSchema.safeParse(fiscalStart);
  if (!fs.success) return fail(INVALID);
  const r = await reopenFiscalYear(db, user, fs.data);
  if (r.ok) revalidateYear();
  return r;
}
