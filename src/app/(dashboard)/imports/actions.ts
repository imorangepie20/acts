"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ERR_WRONG_FILE_TYPE } from "@/lib/imports/types";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { commitImport, previewImport, type PreviewRow } from "@/server/imports/service";
import { fail, ok, type Result } from "@/server/result";

const INVALID = "입력값이 올바르지 않습니다.";
const MAX_BYTES = 5 * 1024 * 1024;

export async function previewImportAction(fd: FormData): Promise<Result<{ rows: PreviewRow[] }>> {
  await requirePermission("voucher:create");
  const kind = fd.get("kind");
  const direction = fd.get("direction");
  const file = fd.get("file");
  if ((kind !== "tax_invoice" && kind !== "card") || (direction !== "purchase" && direction !== "sale")) {
    return fail(INVALID);
  }
  if (!(file instanceof File)) return fail(INVALID);
  if (!/\.xlsx?$/i.test(file.name)) return fail(ERR_WRONG_FILE_TYPE);
  if (file.size > MAX_BYTES) return fail("5MB 이하 파일만 올릴 수 있습니다.");
  return previewImport(db, kind, direction, new Uint8Array(await file.arrayBuffer()));
}

const id = z.number().int().positive();
const text = z.string().max(500);
const commitSchema = z.object({
  kind: z.enum(["tax_invoice", "card"]),
  direction: z.enum(["purchase", "sale"]),
  counterAccountId: id,
  cardPartnerId: id.nullable(),
  siteId: id,
  departmentId: id.nullable(),
  rows: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: text,
        mainAccountId: id,
        deductible: z.boolean(),
        partnerId: id.nullable(),
        counterparty: z
          .object({
            name: text,
            businessNumber: z.string().max(20).nullable(),
            representative: text.nullable(),
          })
          .nullable(),
        evidenceType: z.enum(["tax_invoice", "invoice", "card", "cash_receipt", "simple_receipt", "none"]),
        vatType: z.enum(["taxable", "zero_rated", "exempt"]),
        supplyAmount: z.number().int(),
        vatAmount: z.number().int(),
        meta: z.object({
          approvalNo: text.nullable(),
          merchantName: text.nullable(),
          merchantBusinessNumber: text.nullable(),
          cardNo: text.nullable(),
        }),
      }),
    )
    .max(1000),
});

export async function commitImportAction(
  input: unknown,
): Promise<Result<{ created: { key: string; id: string }[]; failed: { key: string; error: string }[] }>> {
  const user = await requirePermission("voucher:create");
  const p = commitSchema.safeParse(input);
  if (!p.success) return fail(INVALID);
  const r = await commitImport(db, user, p.data);
  revalidatePath("/vouchers");
  return ok(r);
}
