"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { updateCompany } from "@/server/company/service";
import { db } from "@/server/db";

export type CompanyActionState = { error?: string; success?: boolean };

const INVALID = "입력값이 올바르지 않습니다.";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
};

export async function updateCompanyAction(
  _prev: CompanyActionState,
  fd: FormData,
): Promise<CompanyActionState> {
  await requirePermission("settings:manage");
  const name = str(fd, "name");
  const businessNumber = str(fd, "businessNumber");
  const representative = str(fd, "representative");
  const monthRaw = str(fd, "fiscalYearStartMonth");
  const approval = str(fd, "approvalRequired");
  if (name === null || businessNumber === null || representative === null) {
    return { error: INVALID };
  }
  if (monthRaw === null || !/^\d{1,2}$/.test(monthRaw.trim())) {
    return { error: "회계연도 시작 월은 1~12 사이여야 합니다." };
  }
  if (approval !== "true" && approval !== "false") return { error: INVALID };

  const r = await updateCompany(db, {
    name,
    businessNumber,
    representative,
    fiscalYearStartMonth: Number(monthRaw.trim()),
    approvalRequired: approval === "true",
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/company");
  return { success: true };
}
