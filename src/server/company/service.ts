import { eq } from "drizzle-orm";
import {
  isValidBusinessNumber,
  normalizeBusinessNumber,
} from "@/lib/business-number";
import type { Db } from "@/server/db/client";
import { company } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

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

export async function updateCompany(db: Db, input: Company): Promise<Result> {
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  if (
    !Number.isInteger(input.fiscalYearStartMonth) ||
    input.fiscalYearStartMonth < 1 ||
    input.fiscalYearStartMonth > 12
  )
    return fail(ERR_MONTH);

  const bnDigits = normalizeBusinessNumber(input.businessNumber ?? "");
  if (bnDigits && !isValidBusinessNumber(bnDigits)) return fail(ERR_BN);
  const representative = input.representative?.trim() || null;

  const updated = await db
    .update(company)
    .set({
      name,
      businessNumber: bnDigits || null,
      representative,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      approvalRequired: input.approvalRequired,
      updatedAt: new Date(),
    })
    .where(eq(company.id, 1))
    .returning({ id: company.id });
  if (updated.length === 0) throw new Error(MISSING);
  return ok();
}
