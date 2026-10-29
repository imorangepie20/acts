import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { cleanBusinessNumber, normalizeBusinessNumber } from "@/lib/business-number";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { partners } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export type PartnerRow = {
  id: number;
  name: string;
  businessNumber: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  isActive: boolean;
};
export type PartnerInput = Omit<PartnerRow, "id" | "isActive">;

const columns = {
  id: partners.id,
  name: partners.name,
  businessNumber: partners.businessNumber,
  representative: partners.representative,
  phone: partners.phone,
  email: partners.email,
  memo: partners.memo,
  isActive: partners.isActive,
};

const ERR_NAME = "거래처명을 입력하세요.";
const ERR_DUP = "이미 등록된 사업자등록번호입니다.";
const ERR_NOT_FOUND = "거래처를 찾을 수 없습니다.";

const orNull = (v: string | null | undefined) => v?.trim() || null;

/** Validates and normalizes input into column values. */
function clean(input: PartnerInput): Result<Omit<typeof partners.$inferInsert, "id" | "isActive">> {
  const name = input.name.trim();
  if (!name) return fail(ERR_NAME);
  const bn = cleanBusinessNumber(input.businessNumber);
  if (!bn.ok) return bn;
  const businessNumber = bn.value;
  return ok({
    name,
    businessNumber,
    representative: orNull(input.representative),
    phone: orNull(input.phone),
    email: orNull(input.email),
    memo: orNull(input.memo),
  });
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

function matches(q: string): SQL | undefined {
  const text = q.trim();
  if (!text) return undefined;
  const digits = normalizeBusinessNumber(text);
  return or(
    ilike(partners.name, `%${escapeLike(text)}%`),
    digits ? ilike(partners.businessNumber, `%${digits}%`) : undefined,
  );
}

export async function listPartners(
  db: Db,
  opts: { q?: string; activeOnly?: boolean } = {},
): Promise<PartnerRow[]> {
  return db
    .select(columns)
    .from(partners)
    .where(and(opts.activeOnly ? eq(partners.isActive, true) : undefined, matches(opts.q ?? "")))
    .orderBy(asc(partners.name), asc(partners.id));
}

export async function searchPartners(db: Db, q: string, limit = 20): Promise<PartnerRow[]> {
  return db
    .select(columns)
    .from(partners)
    .where(and(eq(partners.isActive, true), matches(q)))
    .orderBy(asc(partners.name), asc(partners.id))
    .limit(limit);
}

export async function createPartner(db: Db, input: PartnerInput): Promise<Result<PartnerRow>> {
  const v = clean(input);
  if (!v.ok) return v;
  try {
    const [row] = await db.insert(partners).values(v.value).returning(columns);
    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DUP);
    throw e;
  }
}

export async function updatePartner(
  db: Db,
  id: number,
  input: PartnerInput & { isActive: boolean },
): Promise<Result> {
  const v = clean(input);
  if (!v.ok) return v;
  try {
    const rows = await db
      .update(partners)
      .set({ ...v.value, isActive: input.isActive, updatedAt: new Date() })
      .where(eq(partners.id, id))
      .returning({ id: partners.id });
    return rows.length ? ok() : fail(ERR_NOT_FOUND);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(ERR_DUP);
    throw e;
  }
}
