"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Recommendation } from "@/lib/recommend";
import { buildSimpleVoucher } from "@/lib/vouchers/simple";
import type { VoucherInput } from "@/lib/vouchers/types";
import { getVatAccountIds } from "@/server/accounts/service";
import { addAttachment, removeAttachment } from "@/server/attachments/service";
import { MAX_ATTACHMENT_BYTES } from "@/server/attachments/storage";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import { searchPartners } from "@/server/partners/service";
import { recommendAccounts } from "@/server/recommend/service";
import { fail, type Result } from "@/server/result";
import { parseVoucherPayload } from "@/server/vouchers/form";
import { approveVoucher, createVoucher, deleteVoucher, rejectVoucher, updateVoucher } from "@/server/vouchers/service";

const INVALID = "입력값이 올바르지 않습니다.";
const version = z.number().int().nonnegative();

/** Parses the entry payload and turns a simple trade/transfer into a full voucher. */
async function toVoucher(input: unknown): Promise<Result<VoucherInput>> {
  const p = parseVoucherPayload(input);
  if (!p.ok) return fail(INVALID);
  if (p.data.mode === "general") return { ok: true, value: p.data.voucher };
  return buildSimpleVoucher(p.data.simple, await getVatAccountIds(db));
}

function revalidate(id: string) {
  revalidatePath("/vouchers");
  revalidatePath(`/vouchers/${id}`);
}

export async function createVoucherAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requirePermission("voucher:create");
  const v = await toVoucher(input);
  if (!v.ok) return v;
  const r = await createVoucher(db, user, v.value);
  if (r.ok) revalidate(r.value.id);
  return r;
}

export async function updateVoucherAction(id: string, ver: number, input: unknown): Promise<Result> {
  const user = await requirePermission("voucher:create");
  if (typeof id !== "string" || !version.safeParse(ver).success) return fail(INVALID);
  const v = await toVoucher(input);
  if (!v.ok) return v;
  const r = await updateVoucher(db, user, id, ver, v.value);
  if (r.ok) revalidate(id);
  return r;
}

export async function deleteVoucherAction(id: string, ver: number): Promise<Result> {
  const user = await requirePermission("voucher:create");
  if (typeof id !== "string" || !version.safeParse(ver).success) return fail(INVALID);
  const r = await deleteVoucher(db, user, id, ver);
  if (r.ok) revalidate(id);
  return r;
}

export async function approveVoucherAction(id: string, ver: number): Promise<Result> {
  const user = await requirePermission("voucher:approve");
  if (typeof id !== "string" || !version.safeParse(ver).success) return fail(INVALID);
  const r = await approveVoucher(db, user, id, ver);
  if (r.ok) revalidate(id);
  return r;
}

export async function rejectVoucherAction(id: string, ver: number, reason: string): Promise<Result> {
  const user = await requirePermission("voucher:approve");
  if (typeof id !== "string" || typeof reason !== "string" || !version.safeParse(ver).success) {
    return fail(INVALID);
  }
  const r = await rejectVoucher(db, user, id, ver, reason.slice(0, 500));
  if (r.ok) revalidate(id);
  return r;
}

export async function uploadAttachmentAction(voucherId: string, fd: FormData): Promise<Result<{ id: string }>> {
  const user = await requirePermission("voucher:create");
  if (typeof voucherId !== "string" || !(fd instanceof FormData)) return fail(INVALID);
  const file = fd.get("file");
  if (!(file instanceof File)) return fail(INVALID);
  // Fail fast with the size message before copying the file into memory; the service re-checks.
  if (file.size > MAX_ATTACHMENT_BYTES) return fail("파일은 10MB 이하여야 합니다.");
  const r = await addAttachment(db, user, voucherId, {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (r.ok) revalidatePath(`/vouchers/${voucherId}`);
  return r;
}

export async function removeAttachmentAction(id: string): Promise<Result> {
  const user = await requirePermission("voucher:create");
  if (typeof id !== "string") return fail(INVALID);
  const r = await removeAttachment(db, user, id);
  if (r.ok) revalidatePath("/vouchers/[id]", "page");
  return r;
}

export type PartnerOption = { id: number; name: string; businessNumber: string | null };

/** Partner picker search (active partners only). */
export async function searchPartnersAction(q: string): Promise<PartnerOption[]> {
  await requirePermission("voucher:create");
  const text = typeof q === "string" ? q.slice(0, 100) : "";
  const rows = await searchPartners(db, text);
  return rows.map(({ id, name, businessNumber }) => ({ id, name, businessNumber }));
}

const recommendSchema = z.object({
  entryType: z.enum(["purchase", "sale"]),
  partnerId: z.number().int().positive().nullable(),
  text: z.string().max(200),
});

export async function recommendAccountsAction(input: unknown): Promise<Result<Recommendation[]>> {
  await requirePermission("voucher:create");
  const p = recommendSchema.safeParse(input);
  if (!p.success) return fail(INVALID);
  return { ok: true, value: await recommendAccounts(db, p.data) };
}
