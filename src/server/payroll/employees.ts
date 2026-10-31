import { and, asc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { maskAccount, maskRrn, validateRrn } from "@/lib/payroll/rrn";
import { isIsoDate, todayInSeoul } from "@/lib/vouchers/dates";
import type { SessionUser, SessionUserWithMfa } from "@/server/auth/service";
import { decryptSecret, encryptSecret, hmacSecret } from "@/server/crypto/secret";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { departments, employees, payrollAudit, payrollItems, sites } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { canManagePayroll, ERR_FORBIDDEN } from "./items";

export type EmployeeInput = {
  employeeNo: string;
  name: string;
  /** 13 digits, with or without the hyphen. */
  rrn: string;
  hiredOn: string;
  leftOn: string | null;
  siteId: number;
  departmentId: number | null;
  isExecutive: boolean;
  /** 공제대상가족 including the employee (>= 1). */
  dependents: number;
  /** Children aged 8 to 20. */
  children: number;
  withholdingRate: number;
  bank: string | null;
  account: string | null;
  insPension: boolean;
  insHealth: boolean;
  insEmployment: boolean;
  pensionBase: number;
  healthBase: number;
  defaultAmounts: Record<string, number>;
};

/** An omitted `rrn` or `account` keeps the stored value; `account: null` clears it. */
export type EmployeeUpdate = Omit<EmployeeInput, "rrn" | "account"> & { rrn?: string; account?: string | null };

export type EmployeeRow = {
  id: number;
  employeeNo: string;
  name: string;
  rrnMasked: string;
  hiredOn: string;
  leftOn: string | null;
  siteName: string;
  departmentName: string | null;
  isExecutive: boolean;
};

export type EmployeeDetail = Omit<EmployeeInput, "rrn" | "account"> & {
  id: number;
  rrnMasked: string;
  accountMasked: string | null;
};

export type SecretField = "rrn" | "account";

const ERR_RRN = "주민등록번호가 올바르지 않습니다.";
const ERR_RRN_DUP = "같은 주민등록번호의 사원이 이미 있습니다.";
const ERR_NO = "사번을 입력하세요.";
const ERR_NO_DUP = "이미 사용 중인 사번입니다.";
const ERR_NAME = "이름을 입력하세요.";
const ERR_HIRED = "입사일을 YYYY-MM-DD로 입력하세요.";
const ERR_LEFT = "퇴사일은 입사일 이후의 YYYY-MM-DD로 입력하세요.";
const ERR_SITE = "사업장을 찾을 수 없습니다.";
const ERR_DEPT = "부서를 찾을 수 없습니다.";
const ERR_DEPENDENTS = "공제대상가족 수는 본인을 포함해 1명 이상이어야 합니다.";
const ERR_CHILDREN = "자녀 수는 0 이상이고 공제대상가족 수(본인 포함)보다 적어야 합니다.";
const ERR_RATE = "간이세액 비율은 80%, 100%, 120% 중 하나여야 합니다.";
const ERR_BASE = "보수월액은 0 이상의 원 단위 정수로 입력하세요.";
const ERR_AMOUNT = "기본 금액은 0 이상의 원 단위 정수로 입력하세요.";
const ERR_ITEM = "없는 급여 항목이 있습니다.";
const ERR_ACCOUNT = "계좌번호는 숫자와 -로 6~20자리를 입력하세요.";
const ERR_NOT_FOUND = "사원을 찾을 수 없습니다.";
const ERR_NO_ACCOUNT = "등록된 계좌번호가 없습니다.";
const ERR_MFA = "2단계 인증을 마친 세션에서만 원문을 볼 수 있습니다.";

const isWon = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const orNull = (v: string | null | undefined) => v?.trim() || null;

type Columns = Omit<typeof employees.$inferInsert, "id" | "rrnEnc" | "rrnHmac" | "accountEnc" | "accountLast4">;

/** Validates every field except the secrets and returns column values. */
async function clean(db: Db, input: EmployeeUpdate): Promise<Result<Columns>> {
  const employeeNo = input.employeeNo.trim();
  if (!employeeNo) return fail(ERR_NO);
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  if (!isIsoDate(input.hiredOn)) return fail(ERR_HIRED);
  const leftOn = orNull(input.leftOn);
  if (leftOn !== null && (!isIsoDate(leftOn) || leftOn < input.hiredOn)) return fail(ERR_LEFT);
  if (!Number.isSafeInteger(input.dependents) || input.dependents < 1) return fail(ERR_DEPENDENTS);
  if (!Number.isSafeInteger(input.children) || input.children < 0 || input.children >= input.dependents) {
    return fail(ERR_CHILDREN);
  }
  if (![80, 100, 120].includes(input.withholdingRate)) return fail(ERR_RATE);
  if (!isWon(input.pensionBase) || !isWon(input.healthBase)) return fail(ERR_BASE);

  const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
  if (!site) return fail(ERR_SITE);
  if (input.departmentId !== null) {
    const [d] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, input.departmentId))
      .limit(1);
    if (!d) return fail(ERR_DEPT);
  }

  const defaultAmounts: Record<string, number> = {};
  for (const [code, amount] of Object.entries(input.defaultAmounts)) {
    if (!isWon(amount)) return fail(ERR_AMOUNT);
    if (amount > 0) defaultAmounts[code] = amount;
  }
  const codes = Object.keys(defaultAmounts);
  if (codes.length) {
    const found = await db
      .select({ code: payrollItems.code })
      .from(payrollItems)
      .where(inArray(payrollItems.code, codes));
    if (found.length !== codes.length) return fail(ERR_ITEM);
  }

  return ok({
    employeeNo,
    name,
    hiredOn: input.hiredOn,
    leftOn,
    siteId: input.siteId,
    departmentId: input.departmentId,
    isExecutive: input.isExecutive,
    dependents: input.dependents,
    children: input.children,
    withholdingRate: input.withholdingRate,
    bank: orNull(input.bank),
    insPension: input.insPension,
    insHealth: input.insHealth,
    insEmployment: input.insEmployment,
    pensionBase: input.pensionBase,
    healthBase: input.healthBase,
    defaultAmounts,
  });
}

function rrnColumns(rrn: string): Result<{ rrnEnc: string; rrnHmac: string }> {
  const v = validateRrn(rrn);
  if (!v.ok) return fail(ERR_RRN);
  return ok({ rrnEnc: encryptSecret(v.digits), rrnHmac: hmacSecret(v.digits) });
}

function accountColumns(account: string | null): Result<{ accountEnc: string | null; accountLast4: string | null }> {
  const a = orNull(account);
  if (a === null) return ok({ accountEnc: null, accountLast4: null });
  const digits = a.replace(/-/g, "");
  if (!/^[0-9-]+$/.test(a) || !/^\d{6,20}$/.test(digits)) return fail(ERR_ACCOUNT);
  return ok({ accountEnc: encryptSecret(a), accountLast4: digits.slice(-4) });
}

async function rrnTaken(db: Db, hmac: string, exceptId?: number): Promise<boolean> {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.rrnHmac, hmac), exceptId === undefined ? undefined : ne(employees.id, exceptId)))
    .limit(1);
  return row !== undefined;
}

/** Maps a unique violation to its message; the hmac index is checked first, so both are covered. */
function uniqueError(e: unknown): string | null {
  if (!isUniqueViolation(e)) return null;
  for (let cur = e as { constraint_name?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.constraint_name === "employees_rrn_hmac_unique") return ERR_RRN_DUP;
  }
  return ERR_NO_DUP;
}

export async function createEmployee(
  db: Db,
  actor: SessionUser,
  input: EmployeeInput,
): Promise<Result<{ id: number }>> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  const rrn = rrnColumns(input.rrn);
  if (!rrn.ok) return rrn;
  const cols = await clean(db, input);
  if (!cols.ok) return cols;
  const acct = accountColumns(input.account);
  if (!acct.ok) return acct;
  if (await rrnTaken(db, rrn.value.rrnHmac)) return fail(ERR_RRN_DUP);
  try {
    const [row] = await db
      .insert(employees)
      .values({ ...cols.value, ...rrn.value, ...acct.value })
      .returning({ id: employees.id });
    return ok({ id: row.id });
  } catch (e) {
    const msg = uniqueError(e);
    if (msg) return fail(msg);
    throw e;
  }
}

export async function updateEmployee(db: Db, actor: SessionUser, id: number, input: EmployeeUpdate): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  let rrn: { rrnEnc: string; rrnHmac: string } | undefined;
  if (input.rrn !== undefined) {
    const r = rrnColumns(input.rrn);
    if (!r.ok) return r;
    rrn = r.value;
  }
  const cols = await clean(db, input);
  if (!cols.ok) return cols;
  let acct: { accountEnc: string | null; accountLast4: string | null } | undefined;
  if (input.account !== undefined) {
    const a = accountColumns(input.account);
    if (!a.ok) return a;
    acct = a.value;
  }
  if (rrn && (await rrnTaken(db, rrn.rrnHmac, id))) return fail(ERR_RRN_DUP);
  try {
    const rows = await db
      .update(employees)
      .set({ ...cols.value, ...rrn, ...acct, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning({ id: employees.id });
    return rows.length ? ok() : fail(ERR_NOT_FOUND);
  } catch (e) {
    const msg = uniqueError(e);
    if (msg) return fail(msg);
    throw e;
  }
}

/** Masked from the decrypted value inside this process; the plain value is not returned. */
const maskedRrn = (enc: string) => maskRrn(decryptSecret(enc));

export async function listEmployees(db: Db, opts: { includeLeft: boolean }): Promise<EmployeeRow[]> {
  const rows = await db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      name: employees.name,
      rrnEnc: employees.rrnEnc,
      hiredOn: employees.hiredOn,
      leftOn: employees.leftOn,
      siteName: sites.name,
      departmentName: departments.name,
      isExecutive: employees.isExecutive,
    })
    .from(employees)
    .innerJoin(sites, eq(sites.id, employees.siteId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(opts.includeLeft ? undefined : or(isNull(employees.leftOn), gte(employees.leftOn, todayInSeoul())))
    .orderBy(asc(employees.employeeNo), asc(employees.id));
  return rows.map(({ rrnEnc, ...r }) => ({ ...r, rrnMasked: maskedRrn(rrnEnc) }));
}

export async function getEmployee(db: Db, id: number): Promise<EmployeeDetail | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    name: row.name,
    rrnMasked: maskedRrn(row.rrnEnc),
    hiredOn: row.hiredOn,
    leftOn: row.leftOn,
    siteId: row.siteId,
    departmentId: row.departmentId,
    isExecutive: row.isExecutive,
    dependents: row.dependents,
    children: row.children,
    withholdingRate: row.withholdingRate,
    bank: row.bank,
    accountMasked: row.accountLast4 ? maskAccount(row.accountLast4) : null,
    insPension: row.insPension,
    insHealth: row.insHealth,
    insEmployment: row.insEmployment,
    pensionBase: row.pensionBase,
    healthBase: row.healthBase,
    defaultAmounts: row.defaultAmounts,
  };
}

/**
 * The plain 주민등록번호 (`900101-1234567`) or account number, for the 보기 button only.
 * Needs `payroll:manage` and a session that passed the second factor; the audit row is
 * written in the same transaction, so a failed write reveals nothing.
 */
export async function revealEmployeeSecret(
  db: Db,
  actor: SessionUserWithMfa,
  id: number,
  field: SecretField,
): Promise<Result<string>> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (actor.mfa !== "verified") return fail(ERR_MFA);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ rrnEnc: employees.rrnEnc, accountEnc: employees.accountEnc })
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    if (!row) return fail(ERR_NOT_FOUND);
    let plain: string;
    if (field === "rrn") {
      const d = decryptSecret(row.rrnEnc);
      plain = `${d.slice(0, 6)}-${d.slice(6)}`;
    } else {
      if (!row.accountEnc) return fail(ERR_NO_ACCOUNT);
      plain = decryptSecret(row.accountEnc);
    }
    await tx.insert(payrollAudit).values({ userId: actor.id, employeeId: id, field });
    return ok(plain);
  });
}
