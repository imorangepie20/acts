import { asc, count, eq, inArray } from "drizzle-orm";
import { MAX_TEMPLATES, MAX_TEMPLATE_NAME, templateRefs, type TemplateBody } from "@/lib/vouchers/templates";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { accounts, partners, voucherTemplates } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";

export type TemplateRow = {
  id: number;
  name: string;
  body: TemplateBody;
  /** Every partner the body refers to, so the pickers can show a name. */
  partners: { id: number; name: string }[];
};

const ERR_NAME_BLANK = "템플릿 이름을 입력하세요.";
const ERR_NAME_LONG = `템플릿 이름은 ${MAX_TEMPLATE_NAME}자 이내로 입력하세요.`;
const ERR_CAP = `템플릿은 ${MAX_TEMPLATES}개까지 저장할 수 있습니다.`;
const ERR_ACCOUNT = "계정을 찾을 수 없습니다.";
const ERR_PARTNER = "거래처를 찾을 수 없습니다.";
const ERR_NOT_FOUND = "템플릿을 찾을 수 없습니다.";

export async function listTemplates(db: Db): Promise<TemplateRow[]> {
  const rows = await db
    .select({ id: voucherTemplates.id, name: voucherTemplates.name, body: voucherTemplates.body })
    .from(voucherTemplates)
    .orderBy(asc(voucherTemplates.name), asc(voucherTemplates.id));
  const partnerIds = [...new Set(rows.flatMap((r) => templateRefs(r.body).partnerIds))];
  const found = partnerIds.length
    ? await db.select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, partnerIds))
    : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    partners: templateRefs(r.body).partnerIds.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    }),
  }));
}

/** Saves under `name`, replacing a template of the same name (the original creator is kept). */
export async function saveTemplate(
  db: Db,
  actor: SessionUser,
  name: string,
  body: TemplateBody,
): Promise<Result<{ id: number }>> {
  const trimmed = name.trim();
  if (!trimmed) return fail(ERR_NAME_BLANK);
  if (trimmed.length > MAX_TEMPLATE_NAME) return fail(ERR_NAME_LONG);

  const refs = templateRefs(body);
  if (refs.accountIds.length) {
    const found = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, refs.accountIds));
    if (found.length !== refs.accountIds.length) return fail(ERR_ACCOUNT);
  }
  if (refs.partnerIds.length) {
    const found = await db.select({ id: partners.id }).from(partners).where(inArray(partners.id, refs.partnerIds));
    if (found.length !== refs.partnerIds.length) return fail(ERR_PARTNER);
  }

  const overwrite = async (): Promise<number | null> => {
    const [row] = await db
      .update(voucherTemplates)
      .set({ entryType: body.type, body, updatedAt: new Date() })
      .where(eq(voucherTemplates.name, trimmed))
      .returning({ id: voucherTemplates.id });
    return row?.id ?? null;
  };

  const existing = await overwrite();
  if (existing !== null) return ok({ id: existing });

  const [{ n }] = await db.select({ n: count() }).from(voucherTemplates);
  if (n >= MAX_TEMPLATES) return fail(ERR_CAP);
  try {
    const [row] = await db
      .insert(voucherTemplates)
      .values({ name: trimmed, entryType: body.type, body, createdBy: actor.id })
      .returning({ id: voucherTemplates.id });
    return ok({ id: row.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A concurrent save created the same name first: overwrite it.
    const id = await overwrite();
    return id !== null ? ok({ id }) : fail(ERR_NOT_FOUND);
  }
}

export async function deleteTemplate(db: Db, id: number): Promise<Result> {
  const rows = await db
    .delete(voucherTemplates)
    .where(eq(voucherTemplates.id, id))
    .returning({ id: voucherTemplates.id });
  return rows.length ? ok() : fail(ERR_NOT_FOUND);
}
