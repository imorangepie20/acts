import { and, asc, eq, ne, sql } from "drizzle-orm";
import { cleanBusinessNumber } from "@/lib/business-number";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { departments, sites } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export type SiteRow = { id: number; name: string; businessNumber: string | null; isActive: boolean };
export type DepartmentRow = { id: number; name: string; isActive: boolean };

const siteColumns = {
  id: sites.id,
  name: sites.name,
  businessNumber: sites.businessNumber,
  isActive: sites.isActive,
};
const departmentColumns = { id: departments.id, name: departments.name, isActive: departments.isActive };

const ERR_SITE_NAME = "사업장명을 입력하세요.";
const ERR_SITE_DUP = "이미 있는 사업장명입니다.";
const ERR_SITE_NOT_FOUND = "사업장을 찾을 수 없습니다.";
const ERR_LAST_SITE = "활성 사업장이 최소 1개 있어야 합니다.";
const ERR_DEPT_NAME = "부서명을 입력하세요.";
const ERR_DEPT_DUP = "이미 있는 부서명입니다.";
const ERR_DEPT_NOT_FOUND = "부서를 찾을 수 없습니다.";

type SiteInput = { name: string; businessNumber: string | null };

function cleanSite(input: SiteInput): Result<SiteInput> {
  const name = input.name.trim();
  if (!name) return fail(ERR_SITE_NAME);
  const bn = cleanBusinessNumber(input.businessNumber);
  if (!bn.ok) return bn;
  return ok({ name, businessNumber: bn.value });
}

export async function listSites(db: Db, opts: { activeOnly?: boolean } = {}): Promise<SiteRow[]> {
  return db
    .select(siteColumns)
    .from(sites)
    .where(opts.activeOnly ? eq(sites.isActive, true) : undefined)
    .orderBy(asc(sites.id));
}

export async function createSite(db: Db, input: SiteInput): Promise<Result<SiteRow>> {
  const v = cleanSite(input);
  if (!v.ok) return v;
  try {
    const [row] = await db.insert(sites).values(v.value).returning(siteColumns);
    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_SITE_DUP);
    throw e;
  }
}

export async function updateSite(
  db: Db,
  id: number,
  input: SiteInput & { isActive: boolean },
): Promise<Result> {
  const v = cleanSite(input);
  if (!v.ok) return v;
  try {
    return await db.transaction(async (tx) => {
      if (!input.isActive) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(sites)
          .where(and(eq(sites.isActive, true), ne(sites.id, id)));
        if (n === 0) return fail(ERR_LAST_SITE);
      }
      const rows = await tx
        .update(sites)
        .set({ ...v.value, isActive: input.isActive, updatedAt: new Date() })
        .where(eq(sites.id, id))
        .returning({ id: sites.id });
      return rows.length ? ok() : fail(ERR_SITE_NOT_FOUND);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_SITE_DUP);
    throw e;
  }
}

export async function listDepartments(
  db: Db,
  opts: { activeOnly?: boolean } = {},
): Promise<DepartmentRow[]> {
  return db
    .select(departmentColumns)
    .from(departments)
    .where(opts.activeOnly ? eq(departments.isActive, true) : undefined)
    .orderBy(asc(departments.id));
}

export async function createDepartment(db: Db, input: { name: string }): Promise<Result<DepartmentRow>> {
  const name = input.name.trim();
  if (!name) return fail(ERR_DEPT_NAME);
  try {
    const [row] = await db.insert(departments).values({ name }).returning(departmentColumns);
    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DEPT_DUP);
    throw e;
  }
}

export async function updateDepartment(
  db: Db,
  id: number,
  input: { name: string; isActive: boolean },
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return fail(ERR_DEPT_NAME);
  try {
    const rows = await db
      .update(departments)
      .set({ name, isActive: input.isActive, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning({ id: departments.id });
    return rows.length ? ok() : fail(ERR_DEPT_NOT_FOUND);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DEPT_DUP);
    throw e;
  }
}

/** Seeds the default 본점 when no site exists yet. */
export async function ensureMainSite(db: Db): Promise<void> {
  const [row] = await db.select({ id: sites.id }).from(sites).limit(1);
  if (!row) await db.insert(sites).values({ name: "본점" }).onConflictDoNothing();
}

/** Voucher-entry dimensions: a field shows only when it can actually vary. */
export async function getEntryOptions(db: Db): Promise<{
  sites: SiteRow[];
  departments: DepartmentRow[];
  showSite: boolean;
  showDepartment: boolean;
}> {
  const [s, d] = await Promise.all([
    listSites(db, { activeOnly: true }),
    listDepartments(db, { activeOnly: true }),
  ]);
  return { sites: s, departments: d, showSite: s.length > 1, showDepartment: d.length > 0 };
}

/** Report filters: every site/department (inactive ones labelled) so history stays filterable. */
export async function getReportFilterOptions(db: Db): Promise<{
  sites: SiteRow[];
  departments: DepartmentRow[];
  showSite: boolean;
  showDepartment: boolean;
}> {
  const [s, d] = await Promise.all([listSites(db), listDepartments(db)]);
  const label = <T extends { name: string; isActive: boolean }>(r: T): T =>
    r.isActive ? r : { ...r, name: `${r.name} (사용 안 함)` };
  return { sites: s.map(label), departments: d.map(label), showSite: s.length > 1, showDepartment: d.length > 0 };
}
