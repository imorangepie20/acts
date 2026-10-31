"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { SESSION_COOKIE, verifyPartialSession } from "@/server/auth/dal";
import { confirmEnrolment, markSessionMfaVerified, verifySecondFactor } from "@/server/auth/mfa";
import { db } from "@/server/db";

export type TotpSetupState = { error?: string; nonce?: number; recoveryCodes?: string[] };
export type TotpVerifyState = { error?: string; nonce?: number };

export async function confirmTotpSetupAction(
  _prev: TotpSetupState,
  form: FormData,
): Promise<TotpSetupState> {
  const user = await verifyPartialSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const r = await confirmEnrolment(db, user.id, String(form.get("code") ?? ""));
  if (!r.ok) return { error: r.error, nonce: Date.now() };
  // Typing a valid code during enrolment counts as this session's second factor.
  await markSessionMfaVerified(db, token);
  return { recoveryCodes: r.value.recoveryCodes };
}

export async function verifyTotpAction(
  _prev: TotpVerifyState,
  form: FormData,
): Promise<TotpVerifyState> {
  const user = await verifyPartialSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const r = await verifySecondFactor(db, token, String(form.get("code") ?? ""));
  if (!r.ok) return { error: r.error, nonce: Date.now() };
  redirect(homePathFor(user.role));
}
