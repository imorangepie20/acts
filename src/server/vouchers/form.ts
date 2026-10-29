import { z } from "zod";
import type { SimpleInput } from "@/lib/vouchers/simple";
import type { VoucherInput } from "@/lib/vouchers/types";

export type Parsed<T> = { ok: true; data: T } | { ok: false };

// Shapes only; amounts, dates and references are validated by the service.
const id = z.number().int().positive();
const amount = z.number().finite();
const evidenceType = z.enum(["tax_invoice", "invoice", "card", "cash_receipt", "simple_receipt", "none"]);
const vatType = z.enum(["taxable", "zero_rated", "exempt"]);
const dims = {
  date: z.string(),
  description: z.string().trim(),
  partnerId: id.nullable(),
};
const lineDims = { siteId: id, departmentId: id.nullable() };

const lineSchema = z.object({
  accountId: id,
  side: z.enum(["debit", "credit"]),
  amount,
  partnerId: id.nullable(),
  ...lineDims,
  description: z.string().trim(),
});

export const voucherInputSchema = z.object({
  ...dims,
  entryType: z.enum(["purchase", "sale", "transfer", "general"]),
  evidenceType,
  vatType: vatType.nullable(),
  vatDeductible: z.boolean().nullable(),
  supplyAmount: amount.nullable(),
  vatAmount: amount.nullable(),
  lines: z.array(lineSchema).max(500),
}) satisfies z.ZodType<VoucherInput>;

const tradeSchema = z.object({
  type: z.enum(["purchase", "sale"]),
  ...dims,
  ...lineDims,
  mainAccountId: id,
  counterAccountId: id,
  evidenceType,
  vatType,
  vatDeductible: z.boolean(),
  supplyAmount: amount,
  vatAmount: amount,
});
const transferSchema = z.object({
  type: z.literal("transfer"),
  ...dims,
  ...lineDims,
  debitAccountId: id,
  creditAccountId: id,
  amount,
  evidenceType,
});

export const simpleInputSchema = z.discriminatedUnion("type", [
  tradeSchema,
  transferSchema,
]) satisfies z.ZodType<SimpleInput>;

const payloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("simple"), simple: simpleInputSchema }),
  z.object({ mode: z.literal("general"), voucher: voucherInputSchema }),
]);
export type VoucherPayload = z.output<typeof payloadSchema>;

/** Parses the entry form's payload: a simple trade/transfer or a general voucher. */
export function parseVoucherPayload(input: unknown): Parsed<VoucherPayload> {
  const r = payloadSchema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false };
}
