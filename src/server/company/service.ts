import { eq } from "drizzle-orm";
import {
  isValidBusinessNumber,
  normalizeBusinessNumber,
} from "@/lib/business-number";
import type { Db } from "@/server/db/client";
import { company } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { approveAllPending } from "@/server/vouchers/snapshot";

export type Company = {
  name: string;
  businessNumber: string | null;
  representative: string | null;
  fiscalYearStartMonth: number;
  approvalRequired: boolean;
};

const ERR_NAME = "회사명을 입력하세요.";
const ERR_BN = "사업자등록번호가 올바르지 않습니다.";
const ERR_MONTH = "회계연도 시작 월은 1~12 사이여야 합니다.";
const MISSING = "회사 정보가 없습니다. 시드를 실행하세요.";

export async function getCompany(db: Db): Promise<Company> {
  const [row] = await db
    .select({
      name: company.name,
      businessNumber: company.businessNumber,
      representative: company.representative,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      approvalRequired: company.approvalRequired,
    })
    .from(company)
    .where(eq(company.id, 1));
  if (!row) throw new Error(MISSING);
  return row;
}

/**
 * Switching approval off approves every pending voucher in the same transaction, so the
 * "posted" rule stays a single `status = 'approved'` check. `actorId` is the approver of record.
 */
export async function updateCompany(db: Db, input: Company, actorId: string): Promise<Result> {
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  if (
    !Number.isInteger(input.fiscalYearStartMonth) ||
    input.fiscalYearStartMonth < 1 ||
    input.fiscalYearStartMonth > 12
  )
    return fail(ERR_MONTH);

  if (/[^\d\s-]/.test(input.businessNumber ?? "")) return fail(ERR_BN);
  const bnDigits = normalizeBusinessNumber(input.businessNumber ?? "");
  if (bnDigits && !isValidBusinessNumber(bnDigits)) return fail(ERR_BN);
  const representative = input.representative?.trim() || null;

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ approvalRequired: company.approvalRequired })
      .from(company)
      .where(eq(company.id, 1))
      .for("update");
    if (!before) throw new Error(MISSING);
    await tx
      .update(company)
      .set({
        name,
        businessNumber: bnDigits || null,
        representative,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        approvalRequired: input.approvalRequired,
        updatedAt: new Date(),
      })
      .where(eq(company.id, 1));
    if (before.approvalRequired && !input.approvalRequired) {
      await approveAllPending(tx, actorId);
    }
    return ok();
  });
}
