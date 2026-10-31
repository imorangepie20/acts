"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { SESSION_COOKIE } from "@/server/auth/dal";
import { LOCKED_MESSAGE } from "@/server/auth/lockout";
import { authenticate, createSession, deleteSession, getSessionUser } from "@/server/auth/service";
import { db } from "@/server/db";

export type LoginState = { error?: string; email?: string; nonce?: number };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const result = await authenticate(db, email, password);
  if (!result.ok) {
    return {
      email,
      nonce: Date.now(),
      error:
        result.reason === "locked" ? LOCKED_MESSAGE : "이메일 또는 비밀번호가 올바르지 않습니다.",
    };
  }
  const { token, expiresAt } = await createSession(db, result.user.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.COOKIE_SECURE === "true",
  });
  // Straight to the second step when one is due (verifySession would also send it there).
  const session = await getSessionUser(db, token);
  if (session?.mfa === "pending") redirect("/2fa/verify");
  if (session?.mfa === "unenrolled") redirect("/2fa/setup");
  redirect(homePathFor(result.user.role));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db, token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
