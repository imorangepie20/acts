import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, homePathFor, type Permission } from "@/lib/permissions";
import { db } from "@/server/db";
import { getSessionUser, type SessionUserWithMfa } from "./service";

export const SESSION_COOKIE = "acts_session";

/** The signed-in user, whatever the second-factor state. Only the /2fa pages use this. */
export const verifyPartialSession = cache(async (): Promise<SessionUserWithMfa> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await getSessionUser(db, token) : null;
  if (!user) redirect("/login");
  return user;
});

/** A fully signed-in user; sends a session still missing its second factor to /2fa. */
export const verifySession = cache(async (): Promise<SessionUserWithMfa> => {
  const user = await verifyPartialSession();
  if (user.mfa === "pending") redirect("/2fa/verify");
  if (user.mfa === "unenrolled") redirect("/2fa/setup");
  return user;
});

export async function requirePermission(p: Permission): Promise<SessionUserWithMfa> {
  const user = await verifySession();
  if (!can(user.role, p)) redirect(homePathFor(user.role));
  return user;
}
