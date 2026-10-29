import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, homePathFor, type Permission } from "@/lib/permissions";
import { db } from "@/server/db";
import { getSessionUser, type SessionUser } from "./service";

export const SESSION_COOKIE = "acts_session";

export const verifySession = cache(async (): Promise<SessionUser> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await getSessionUser(db, token) : null;
  if (!user) redirect("/login");
  return user;
});

export async function requirePermission(p: Permission): Promise<SessionUser> {
  const user = await verifySession();
  if (!can(user.role, p)) redirect(homePathFor(user.role));
  return user;
}
