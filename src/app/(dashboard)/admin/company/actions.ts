"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/dal";
import { updateCompany } from "@/server/company/service";
import { db } from "@/server/db";

export type CompanyActionState = {
  error?: string;
  success?: boolean;
  /** Submitted values echoed back on error so the form keeps what the user typed. */
  values?: {
    name: string;
    businessNumber: string;
    representative: string;
    fiscalYearStartMonth: string;
    approvalRequired: boolean;
  };
  nonce?: number;
};

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
  const fail = (error: string): CompanyActionState => ({
    error,
    values: {
      name: str(fd, "name") ?? "",
      businessNumber: str(fd, "businessNumber") ?? "",
      representative: str(fd, "representative") ?? "",
      fiscalYearStartMonth: str(fd, "fiscalYearStartMonth") ?? "",
      approvalRequired: str(fd, "approvalRequired") === "true",
    },
    nonce: Date.now(),
  });
  const name = str(fd, "name");
  const businessNumber = str(fd, "businessNumber");
  const representative = str(fd, "representative");
  const monthRaw = str(fd, "fiscalYearStartMonth");
  const approval = str(fd, "approvalRequired");
  if (name === null || businessNumber === null || representative === null) {
    return fail(INVALID);
  }
  if (monthRaw === null || !/^\d{1,2}$/.test(monthRaw.trim())) {
    return fail("회계연도 시작 월은 1~12 사이여야 합니다.");
  }
  if (approval !== "true" && approval !== "false") return fail(INVALID);

  const r = await updateCompany(db, {
    name,
    businessNumber,
    representative,
    fiscalYearStartMonth: Number(monthRaw.trim()),
    approvalRequired: approval === "true",
  });
  if (!r.ok) return fail(r.error);
  revalidatePath("/admin/company");
  return { success: true };
}
