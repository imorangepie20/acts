"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/permissions";
import { SESSION_COOKIE } from "@/server/auth/dal";
import { authenticate, createSession, deleteSession } from "@/server/auth/service";
import { db } from "@/server/db";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const result = await authenticate(db, email, password);
  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? "로그인 실패가 반복되어 계정이 잠겼습니다. 15분 후 다시 시도하세요."
          : "이메일 또는 비밀번호가 올바르지 않습니다.",
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
  redirect(homePathFor(result.user.role));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db, token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
