import { and, asc, eq, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { accounts, employees, payrollItems, payrollRunLines } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export const ERR_FORBIDDEN = "급여 관리 권한이 없습니다.";

/** The seeded items: they can be deactivated but never deleted. */
export const BUILTIN_ITEM_CODES: readonly string[] = ["basic", "bonus", "meal", "car", "position", "overtime"];

const CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;

export type PayItemRow = {
  code: string;
  name: string;
  taxable: boolean;
  /** 비과세 월 한도 (won); null = no 비과세 part. */
  nontaxLimit: number | null;
  inEmploymentBase: boolean;
  /** null = 임원급여/직원급여 by 임원 여부. */
  debitAccountCode: string | null;
  sort: number;
  isActive: boolean;
};
export type PayItemInput = PayItemRow;

const columns = {
  code: payrollItems.code,
  name: payrollItems.name,
  taxable: payrollItems.taxable,
  nontaxLimit: payrollItems.nontaxLimit,
  inEmploymentBase: payrollItems.inEmploymentBase,
  debitAccountCode: payrollItems.debitAccountCode,
  sort: payrollItems.sort,
  isActive: payrollItems.isActive,
};

const ERR_CODE = "항목 코드는 영문 소문자로 시작하는 2~31자(영문 소문자, 숫자, _)여야 합니다.";
const ERR_NAME = "항목 이름을 입력하세요.";
const ERR_LIMIT = "비과세 한도는 0 이상의 원 단위 정수로 입력하세요.";
const ERR_SORT = "정렬 순서는 정수로 입력하세요.";
const ERR_ACCOUNT = "전표 계정을 찾을 수 없거나 사용하지 않는 계정입니다.";
const ERR_BUILTIN = "기본 항목은 삭제할 수 없습니다. 사용 여부를 끄세요.";
const ERR_IN_USE = "급여 대장이나 사원 기본 금액에 쓰인 항목은 삭제할 수 없습니다. 사용 여부를 끄세요.";
const ERR_NOT_FOUND = "급여 항목을 찾을 수 없습니다.";
const ERR_EXISTS = "이미 있는 항목 코드입니다.";

export const canManagePayroll = (actor: SessionUser) => can(actor.role, "payroll:manage");

export async function listItems(db: Db): Promise<PayItemRow[]> {
  return db.select(columns).from(payrollItems).orderBy(asc(payrollItems.sort), asc(payrollItems.code));
}

/** An active account with this code exists. */
export async function isActiveAccountCode(db: Db, code: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.code, code), eq(accounts.isActive, true)))
    .limit(1);
  return row !== undefined;
}

/** "create" fails on an existing code; "update" fails on an unknown one. */
export async function saveItem(
  db: Db,
  actor: SessionUser,
  item: PayItemInput,
  mode: "create" | "update",
): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  const code = item.code.trim();
  if (!CODE_RE.test(code)) return fail(ERR_CODE);
  const name = item.name.trim();
  if (!name) return fail(ERR_NAME);
  const limit = item.taxable ? null : item.nontaxLimit;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) return fail(ERR_LIMIT);
  if (!Number.isSafeInteger(item.sort)) return fail(ERR_SORT);
  const debit = item.debitAccountCode?.trim() || null;
  if (debit !== null && !(await isActiveAccountCode(db, debit))) return fail(ERR_ACCOUNT);
  const values = {
    name,
    taxable: item.taxable,
    nontaxLimit: limit,
    inEmploymentBase: item.inEmploymentBase,
    debitAccountCode: debit,
    sort: item.sort,
    isActive: item.isActive,
  };
  if (mode === "create") {
    const rows = await db
      .insert(payrollItems)
      .values({ code, kind: "earning", ...values })
      .onConflictDoNothing()
      .returning({ code: payrollItems.code });
    return rows.length ? ok() : fail(ERR_EXISTS);
  }
  const rows = await db.update(payrollItems).set(values).where(eq(payrollItems.code, code)).returning({ code: payrollItems.code });
  return rows.length ? ok() : fail(ERR_NOT_FOUND);
}

/** Deletes an added item that no run line or employee default uses. */
export async function deleteItem(db: Db, actor: SessionUser, code: string): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (BUILTIN_ITEM_CODES.includes(code)) return fail(ERR_BUILTIN);
  const [used] = await db
    .select({ one: sql`1` })
    .from(payrollRunLines)
    .where(sql`${payrollRunLines.amounts} ? ${code}`)
    .limit(1);
  const [usedByEmployee] = await db
    .select({ one: sql`1` })
    .from(employees)
    .where(sql`${employees.defaultAmounts} ? ${code}`)
    .limit(1);
  if (used || usedByEmployee) return fail(ERR_IN_USE);
  const rows = await db.delete(payrollItems).where(eq(payrollItems.code, code)).returning({ code: payrollItems.code });
  return rows.length ? ok() : fail(ERR_NOT_FOUND);
}
