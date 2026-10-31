import { z } from "zod";
import { MAX_WON } from "@/lib/money";
import type { TemplateBody } from "@/lib/vouchers/templates";

const id = z.number().int().positive().nullable();
const amount = z.number().int().min(0).max(MAX_WON).nullable();
const description = z.string().trim().max(200);
const evidenceType = z.enum(["tax_invoice", "invoice", "card", "cash_receipt", "simple_receipt", "none"]);
const vatType = z.enum(["taxable", "zero_rated", "exempt"]);

export const templateBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["purchase", "sale"]),
    description,
    mainAccountId: id,
    counterAccountId: id,
    partnerId: id,
    evidenceType,
    vatType,
    vatDeductible: z.boolean(),
    supplyAmount: amount,
    vatAmount: amount,
  }),
  z.object({
    type: z.literal("transfer"),
    description,
    debitAccountId: id,
    creditAccountId: id,
    partnerId: id,
    evidenceType,
    amount,
  }),
  z.object({
    type: z.literal("general"),
    description,
    closing: z.boolean(),
    lines: z
      .array(
        z.object({
          accountId: id,
          side: z.enum(["debit", "credit"]),
          amount,
          partnerId: id,
          description,
        }),
      )
      .max(100),
  }),
]) satisfies z.ZodType<TemplateBody>;

export function parseTemplateBody(input: unknown): { ok: true; data: TemplateBody } | { ok: false } {
  const p = templateBodySchema.safeParse(input);
  return p.success ? { ok: true, data: p.data } : { ok: false };
}
