"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/dal";
import { saveOpening } from "@/server/closing/opening";
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
