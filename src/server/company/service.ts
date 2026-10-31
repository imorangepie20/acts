import { eq, isNotNull, sql } from "drizzle-orm";
import {
  isValidBusinessNumber,
  normalizeBusinessNumber,
} from "@/lib/business-number";
import type { Db } from "@/server/db/client";
import { lockPeriodsExclusive } from "@/server/closing/periods";
import { company, fiscalYearCloses, periodCloses } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { approveAllPending } from "@/server/vouchers/snapshot";

export type Company = {
  name: string;
  businessNumber: string | null;
  representative: string | null;
  fiscalYearStartMonth: number;
  approvalRequired: boolean;
  /** 원천세 신고 정보; all optional, presence is checked when a file is downloaded. */
  taxOfficeCode: string | null;
  businessType: "corporation" | "individual";
  corporateNumber: string | null;
  withholdingSemiannual: boolean;
  hometaxId: string | null;
  filingContactDept: string | null;
  filingContactName: string | null;
  filingContactPhone: string | null;
};

const ERR_NAME = "회사명을 입력하세요.";
const ERR_BN = "사업자등록번호가 올바르지 않습니다.";
const ERR_MONTH = "회계연도 시작 월은 1~12 사이여야 합니다.";
const ERR_FISCAL_LOCKED =
  "마감된 월이 있어 회계연도 시작 월을 바꿀 수 없습니다. 마감을 모두 해제한 뒤 변경하세요.";
const ERR_TAX_OFFICE = "세무서코드는 숫자 3자리입니다.";
const ERR_CORP_NO = "법인등록번호는 숫자 13자리입니다.";
const ERR_BUSINESS_TYPE = "사업자 유형이 올바르지 않습니다.";
const MISSING = "회사 정보가 없습니다. 시드를 실행하세요.";

export async function getCompany(db: Db): Promise<Company> {
  const [row] = await db
    .select({
      name: company.name,
      businessNumber: company.businessNumber,
      representative: company.representative,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      approvalRequired: company.approvalRequired,
      taxOfficeCode: company.taxOfficeCode,
      businessType: company.businessType,
      corporateNumber: company.corporateNumber,
      withholdingSemiannual: company.withholdingSemiannual,
      hometaxId: company.hometaxId,
      filingContactDept: company.filingContactDept,
      filingContactName: company.filingContactName,
      filingContactPhone: company.filingContactPhone,
    })
    .from(company)
    .where(eq(company.id, 1));
  if (!row) throw new Error(MISSING);
  return { ...row, businessType: row.businessType === "individual" ? "individual" : "corporation" };
}

const trimmed = (v: string | null) => v?.trim() || null;

/** Digits of a number typed with dashes: null when empty, undefined when not exactly `length` digits. */
function digitsOf(v: string | null, length: number): string | null | undefined {
  const raw = (v ?? "").replace(/-/g, "").trim();
  if (!raw) return null;
  return raw.length === length && /^\d+$/.test(raw) ? raw : undefined;
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

  const taxOfficeCode = digitsOf(input.taxOfficeCode, 3);
  if (taxOfficeCode === undefined) return fail(ERR_TAX_OFFICE);
  const corporateNumber = digitsOf(input.corporateNumber, 13);
  if (corporateNumber === undefined) return fail(ERR_CORP_NO);
  if (input.businessType !== "corporation" && input.businessType !== "individual")
    return fail(ERR_BUSINESS_TYPE);

  return db.transaction(async (tx) => {
    // Global period lock first (writers hold it shared, close/reopen exclusive), then the company
    // row: the same order as voucher writes. Excludes a close racing a start-month change.
    await lockPeriodsExclusive(tx);
    const [before] = await tx
      .select({
        approvalRequired: company.approvalRequired,
        fiscalYearStartMonth: company.fiscalYearStartMonth,
      })
      .from(company)
      .where(eq(company.id, 1))
      .for("update");
    if (!before) throw new Error(MISSING);
    if (input.fiscalYearStartMonth !== before.fiscalYearStartMonth) {
      // Month closes stay valid for a closed fiscal year too (it requires them), but check both.
      const [anyMonth] = await tx.select({ month: periodCloses.month }).from(periodCloses).limit(1);
      const [anyYear] = await tx
        .select({ s: fiscalYearCloses.fiscalStart })
        .from(fiscalYearCloses)
        .where(isNotNull(fiscalYearCloses.closedAt))
        .limit(1);
      if (anyMonth || anyYear) return fail(ERR_FISCAL_LOCKED);
    }
    await tx
      .update(company)
      .set({
        name,
        businessNumber: bnDigits || null,
        representative,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        approvalRequired: input.approvalRequired,
        taxOfficeCode,
        businessType: input.businessType,
        corporateNumber,
        withholdingSemiannual: input.withholdingSemiannual,
        hometaxId: trimmed(input.hometaxId),
        filingContactDept: trimmed(input.filingContactDept),
        filingContactName: trimmed(input.filingContactName),
        filingContactPhone: trimmed(input.filingContactPhone),
        updatedAt: sql`now()`,
      })
      .where(eq(company.id, 1));
    if (before.approvalRequired && !input.approvalRequired) {
      await approveAllPending(tx, actorId);
    }
    return ok();
  });
}
