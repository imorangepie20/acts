"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/server/auth/dal";
import { disableTotp, withEncryptionKey } from "@/server/auth/mfa";
import { db } from "@/server/db";

export type DisableTotpState = { error?: string; nonce?: number };

export async function disableTotpAction(
  _prev: DisableTotpState,
  form: FormData,
): Promise<DisableTotpState> {
  const user = await verifySession();
  const code = String(form.get("code") ?? "");
  const wrapped = await withEncryptionKey(() => disableTotp(db, user.id, code));
  const r = wrapped.ok ? wrapped.value : wrapped;
  if (!r.ok) return { error: r.error, nonce: Date.now() };
  revalidatePath("/profile");
  return { nonce: Date.now() };
}
