"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  parseCreateDepartment,
  parseCreateSite,
  parseUpdateDepartment,
  parseUpdateSite,
} from "@/server/sites/form";
import {
  createDepartment,
  createSite,
  updateDepartment,
  updateSite,
} from "@/server/sites/service";

export type SiteActionState = {
  error?: string;
  success?: boolean;
  /** Submitted fields, echoed back so the form keeps them after an error. */
  values?: Record<string, string>;
  /** Changes on every submission so React re-applies the default values. */
  nonce?: number;
};

const INVALID = "입력값이 올바르지 않습니다.";
const KEYS = ["name", "businessNumber", "isActive"];

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const failState = (fd: FormData, error: string): SiteActionState => ({
  error,
  values: Object.fromEntries(KEYS.map((k) => [k, str(fd, k)])),
  nonce: Date.now(),
});
const done = (): SiteActionState => {
  revalidatePath("/admin/sites");
  return { success: true };
};

export async function createSiteAction(_prev: SiteActionState, fd: FormData): Promise<SiteActionState> {
  await requirePermission("settings:manage");
  const p = parseCreateSite(fd);
  if (!p.ok) return failState(fd, INVALID);
  const r = await createSite(db, p.data);
  return r.ok ? done() : failState(fd, r.error);
}

export async function updateSiteAction(_prev: SiteActionState, fd: FormData): Promise<SiteActionState> {
  await requirePermission("settings:manage");
  const p = parseUpdateSite(fd);
  if (!p.ok) return failState(fd, INVALID);
  const { id, ...input } = p.data;
  const r = await updateSite(db, id, input);
  return r.ok ? done() : failState(fd, r.error);
}

export async function createDepartmentAction(
  _prev: SiteActionState,
  fd: FormData,
): Promise<SiteActionState> {
  await requirePermission("settings:manage");
  const p = parseCreateDepartment(fd);
  if (!p.ok) return failState(fd, INVALID);
  const r = await createDepartment(db, p.data);
  return r.ok ? done() : failState(fd, r.error);
}

export async function updateDepartmentAction(
  _prev: SiteActionState,
  fd: FormData,
): Promise<SiteActionState> {
  await requirePermission("settings:manage");
  const p = parseUpdateDepartment(fd);
  if (!p.ok) return failState(fd, INVALID);
  const { id, ...input } = p.data;
  const r = await updateDepartment(db, id, input);
  return r.ok ? done() : failState(fd, r.error);
}
