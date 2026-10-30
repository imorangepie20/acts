import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { type AccountGroup, type DashboardRole, VAT_INPUT_CODE, VAT_OUTPUT_CODE } from "@/lib/accounts";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { accounts, voucherLines } from "@/server/db/schema";
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
  dashboardRole: DashboardRole | null;
};

const columns = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  group: accounts.group,
  requiresPartner: accounts.requiresPartner,
  isActive: accounts.isActive,
  isSystem: accounts.isSystem,
  dashboardRole: accounts.dashboardRole,
};

const ERR_CODE = "계정코드는 101~999 사이의 3자리 숫자여야 합니다.";
const ERR_DUP = "이미 사용 중인 계정코드입니다.";
const ERR_NAME = "계정명을 입력하세요.";
const ERR_VAT = "부가세 계정은 숨길 수 없습니다.";
const ERR_GROUP_USED = "전표가 있는 계정은 구분을 바꿀 수 없습니다.";
const ERR_ROLE = "대시보드 구분이 계정 구분과 맞지 않습니다.";
const ERR_NOT_FOUND = "계정과목을 찾을 수 없습니다.";

const ASSET_GROUPS: AccountGroup[] = ["current_asset", "noncurrent_asset"];
const LIABILITY_GROUPS: AccountGroup[] = ["current_liability", "noncurrent_liability"];

function roleFitsGroup(role: DashboardRole | null | undefined, group: AccountGroup): boolean {
  if (!role) return true;
  return (role === "payable" ? LIABILITY_GROUPS : ASSET_GROUPS).includes(group);
}

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
  input: { code: string; name: string; group: AccountGroup;
    requiresPartner: boolean;
    dashboardRole?: DashboardRole | null;
  },
): Promise<Result<AccountRow>> {
  if (!/^\d{3}$/.test(input.code) || Number(input.code) < 101) return fail(ERR_CODE);
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  if (!roleFitsGroup(input.dashboardRole, input.group)) return fail(ERR_ROLE);
  try {
    const [row] = await db
      .insert(accounts)
      .values({
        code: input.code,
        name,
        group: input.group,
        requiresPartner: input.requiresPartner,
        dashboardRole: input.dashboardRole ?? null,
      })
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
  patch: {
    name?: string;
    group?: AccountGroup;
    requiresPartner?: boolean;
    isActive?: boolean;
    dashboardRole?: DashboardRole | null;
  },
): Promise<Result> {
  const set: Partial<Omit<typeof accounts.$inferInsert, "updatedAt">> & { updatedAt: SQL } = { updatedAt: sql`now()` };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return fail(ERR_NAME);
    set.name = name;
  }
  if (patch.group !== undefined) set.group = patch.group;
  if (patch.requiresPartner !== undefined) set.requiresPartner = patch.requiresPartner;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (patch.dashboardRole !== undefined) set.dashboardRole = patch.dashboardRole;

  const [target] = await db
    .select({ code: accounts.code, group: accounts.group, dashboardRole: accounts.dashboardRole })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (!target) return fail(ERR_NOT_FOUND);
  const group = patch.group ?? target.group;
  const role = patch.dashboardRole !== undefined ? patch.dashboardRole : target.dashboardRole;
  if (patch.group !== undefined && patch.group !== target.group) {
    const [used] = await db
      .select({ id: voucherLines.id })
      .from(voucherLines)
      .where(eq(voucherLines.accountId, id))
      .limit(1);
    if (used) return fail(ERR_GROUP_USED);
  }
  if (!roleFitsGroup(role, group)) return fail(ERR_ROLE);
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
