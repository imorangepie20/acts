"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  parseCreatePartner,
  parseQuickPartner,
  parseUpdatePartner,
} from "@/server/partners/form";
import {
  createPartner,
  updatePartner,
  type PartnerRow,
} from "@/server/partners/service";
import { fail, type Result } from "@/server/result";

export type PartnerActionState = {
  error?: string;
  success?: boolean;
  /** Submitted fields, echoed back so the form keeps them after an error. */
  values?: Record<string, string>;
  /** Changes on every submission so React re-applies the default values. */
  nonce?: number;
};

const INVALID = "입력값이 올바르지 않습니다.";
const KEYS = ["name", "businessNumber", "representative", "phone", "email", "memo", "isActive"];

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const failState = (fd: FormData, error: string): PartnerActionState => ({
  error,
  values: Object.fromEntries(KEYS.map((k) => [k, str(fd, k)])),
  nonce: Date.now(),
});

export async function createPartnerAction(
  _prev: PartnerActionState,
  fd: FormData,
): Promise<PartnerActionState> {
  await requirePermission("settings:manage");
  const p = parseCreatePartner(fd);
  if (!p.ok) return failState(fd, INVALID);
  const r = await createPartner(db, p.data);
  if (!r.ok) return failState(fd, r.error);
  revalidatePath("/admin/partners");
  return { success: true };
}

export async function updatePartnerAction(
  _prev: PartnerActionState,
  fd: FormData,
): Promise<PartnerActionState> {
  await requirePermission("settings:manage");
  const p = parseUpdatePartner(fd);
  if (!p.ok) return failState(fd, INVALID);
  const { id, ...input } = p.data;
  const r = await updatePartner(db, id, input);
  if (!r.ok) return failState(fd, r.error);
  revalidatePath("/admin/partners");
  return { success: true };
}

/** Voucher entry: staff add a partner on the spot without settings access. */
export async function quickCreatePartnerAction(input: {
  name: string;
  businessNumber: string;
}): Promise<Result<PartnerRow>> {
  await requirePermission("voucher:create");
  const p = parseQuickPartner(input);
  if (!p.ok) return fail(INVALID);
  const r = await createPartner(db, {
    name: p.data.name,
    businessNumber: p.data.businessNumber,
    representative: null,
    phone: null,
    email: null,
    memo: null,
  });
  if (r.ok) revalidatePath("/admin/partners");
  return r;
}
