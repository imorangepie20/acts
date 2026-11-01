import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Conn } from "@/server/vouchers/snapshot";
import { payrollRateKind, payrollRates, withholdingTables } from "@/server/db/schema";
import type { Rates, WithholdingTable } from "@/lib/payroll/types";
import {
  EMPLOYER_RATE_KINDS,
  isEmployerRateValue,
  type EmployerRateInput,
  type EmployerRateKind,
  type EmployerRateRow,
} from "@/lib/payroll/employer-rates";
import { isIsoDate } from "@/lib/vouchers/dates";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { fail, ok, type Result } from "@/server/result";
import { canManagePayroll, ERR_FORBIDDEN } from "./items";
import type { RateKind } from "./seed-data/rates";

const FIELD: Record<RateKind, keyof Rates> = {
  pension_employee: "pensionEmployee",
  pension_company: "pensionCompany",
  pension_cap: "pensionCap",
  pension_floor: "pensionFloor",
  health_employee: "healthEmployee",
  health_company: "healthCompany",
  ltc_employee: "ltcEmployee",
  ltc_company: "ltcCompany",
  employment_employee: "employmentEmployee",
  employment_company: "employmentCompany",
  employment_stability_company: "employmentStabilityCompany",
  industrial_accident_company: "industrialAccidentCompany",
};

const isEmployerKind = (k: unknown): k is EmployerRateKind =>
  typeof k === "string" && (EMPLOYER_RATE_KINDS as readonly string[]).includes(k);

/**
 * Per kind, the row with the latest effective_from <= date (the 귀속월 1일). A seeded kind without a
 * row throws; the company-entered 사업주 부담 kinds (고용안정·직업능력개발, 산재) are 0 without one.
 */
export async function loadRates(db: Conn, date: string): Promise<Rates> {
  const rows = await db
    .selectDistinctOn([payrollRates.kind], { kind: payrollRates.kind, value: payrollRates.value })
    .from(payrollRates)
    .where(lte(payrollRates.effectiveFrom, date))
    .orderBy(payrollRates.kind, desc(payrollRates.effectiveFrom));
  const byKind = new Map(rows.map((r) => [r.kind, Number(r.value)]));
  const rates = {} as Rates;
  for (const kind of payrollRateKind.enumValues) {
    const v = byKind.get(kind) ?? (isEmployerKind(kind) ? 0 : undefined);
    if (v === undefined) throw new Error(`${date} 기준 ${kind} 요율이 없습니다.`);
    rates[FIELD[kind]] = v;
  }
  return rates;
}

/** The 간이세액표 in force on date (the run's 지급일). */
export async function loadWithholdingTable(db: Conn, date: string): Promise<WithholdingTable> {
  const [row] = await db
    .select({ data: withholdingTables.data })
    .from(withholdingTables)
    .where(lte(withholdingTables.effectiveFrom, date))
    .orderBy(desc(withholdingTables.effectiveFrom))
    .limit(1);
  if (!row) throw new Error(`${date} 기준 근로소득 간이세액표가 없습니다.`);
  return row.data;
}

export const ERR_RATE_KIND = "요율 종류가 올바르지 않습니다.";
export const ERR_RATE_DATE = "적용 시작일을 입력하세요.";
export const ERR_RATE_VALUE = "요율은 0% 이상 10% 이하, 소수점 셋째 자리까지 입력하세요.";
export const ERR_RATE_DUPLICATE = "같은 종류와 적용 시작일의 요율이 이미 있습니다.";
export const ERR_RATE_NOT_FOUND = "요율을 찾을 수 없습니다.";

/** The 사업주 부담 rows entered on 급여 설정, by kind then date. */
export async function listEmployerRates(db: Db): Promise<EmployerRateRow[]> {
  const rows = await db
    .select()
    .from(payrollRates)
    .where(inArray(payrollRates.kind, [...EMPLOYER_RATE_KINDS]))
    .orderBy(asc(payrollRates.kind), asc(payrollRates.effectiveFrom));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as EmployerRateKind,
    effectiveFrom: r.effectiveFrom,
    value: Number(r.value),
  }));
}

/**
 * Adds a dated 사업주 부담 rate. Draft runs whose 귀속월 it covers need 재계산 (confirm refuses them
 * until then); confirmed runs keep the amounts they were confirmed with.
 */
export async function addEmployerRate(db: Db, actor: SessionUser, input: EmployerRateInput): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!isEmployerKind(input.kind)) return fail(ERR_RATE_KIND);
  if (!isIsoDate(input.effectiveFrom)) return fail(ERR_RATE_DATE);
  if (!isEmployerRateValue(input.value)) return fail(ERR_RATE_VALUE);
  try {
    await db
      .insert(payrollRates)
      .values({ kind: input.kind, effectiveFrom: input.effectiveFrom, value: String(input.value) });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_RATE_DUPLICATE);
    throw e;
  }
  return ok();
}

/** Deletes a 사업주 부담 row; the seeded statutory rates cannot be deleted here. */
export async function deleteEmployerRate(db: Db, actor: SessionUser, id: number): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!Number.isInteger(id)) return fail(ERR_RATE_NOT_FOUND);
  const deleted = await db
    .delete(payrollRates)
    .where(and(eq(payrollRates.id, id), inArray(payrollRates.kind, [...EMPLOYER_RATE_KINDS])))
    .returning({ id: payrollRates.id });
  return deleted.length ? ok() : fail(ERR_RATE_NOT_FOUND);
}
