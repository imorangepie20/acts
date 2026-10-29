import { asc, eq, inArray } from "drizzle-orm";
import { type AccountGroup, VAT_INPUT_CODE, VAT_OUTPUT_CODE } from "@/lib/accounts";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { accounts } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { STANDARD_ACCOUNTS } from "./standard-chart";

export type AccountRow = {
  id: number;
  code: string;
  name: string;
  group: AccountGroup;
  requiresPartner: boolean;
  isActive: boolean;
  isSystem: boolean;
};

const columns = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  group: accounts.group,
  requiresPartner: accounts.requiresPartner,
  isActive: accounts.isActive,
  isSystem: accounts.isSystem,
};

const ERR_CODE = "계정코드는 101~999 사이의 3자리 숫자여야 합니다.";
const ERR_DUP = "이미 사용 중인 계정코드입니다.";
const ERR_NAME = "계정명을 입력하세요.";
const ERR_VAT = "부가세 계정은 숨길 수 없습니다.";
const ERR_NOT_FOUND = "계정과목을 찾을 수 없습니다.";

export async function listAccounts(
  db: Db,
  opts: { activeOnly?: boolean } = {},
): Promise<AccountRow[]> {
  const q = db.select(columns).from(accounts);
  return (opts.activeOnly ? q.where(eq(accounts.isActive, true)) : q).orderBy(asc(accounts.code));
}

export async function getAccountById(db: Db, id: number): Promise<AccountRow | null> {
  const [row] = await db.select(columns).from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ?? null;
}

export async function createAccount(
  db: Db,
  input: { code: string; name: string; group: AccountGroup; requiresPartner: boolean },
): Promise<Result<AccountRow>> {
  if (!/^\d{3}$/.test(input.code) || Number(input.code) < 101) return fail(ERR_CODE);
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  try {
    const [row] = await db
      .insert(accounts)
      .values({ code: input.code, name, group: input.group, requiresPartner: input.requiresPartner })
      .returning(columns);
    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DUP);
    throw e;
  }
}

export async function updateAccount(
  db: Db,
  id: number,
  patch: { name?: string; group?: AccountGroup; requiresPartner?: boolean; isActive?: boolean },
): Promise<Result> {
  const set: Partial<typeof accounts.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return fail(ERR_NAME);
    set.name = name;
  }
  if (patch.group !== undefined) set.group = patch.group;
  if (patch.requiresPartner !== undefined) set.requiresPartner = patch.requiresPartner;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  const [target] = await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.id, id));
  if (!target) return fail(ERR_NOT_FOUND);
  if (patch.isActive === false && (target.code === VAT_INPUT_CODE || target.code === VAT_OUTPUT_CODE)) {
    return fail(ERR_VAT);
  }
  await db.update(accounts).set(set).where(eq(accounts.id, id));
  return ok();
}

export async function getVatAccountIds(
  db: Db,
): Promise<{ inputAccountId: number; outputAccountId: number }> {
  const rows = await db
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(inArray(accounts.code, [VAT_INPUT_CODE, VAT_OUTPUT_CODE]));
  const input = rows.find((r) => r.code === VAT_INPUT_CODE);
  const output = rows.find((r) => r.code === VAT_OUTPUT_CODE);
  if (!input || !output) throw new Error("VAT accounts (135/255) are missing; run the seed");
  return { inputAccountId: input.id, outputAccountId: output.id };
}

export async function seedStandardAccounts(db: Db): Promise<void> {
  await db
    .insert(accounts)
    .values(STANDARD_ACCOUNTS.map((a) => ({ ...a, isSystem: true })))
    .onConflictDoNothing({ target: accounts.code });
}
