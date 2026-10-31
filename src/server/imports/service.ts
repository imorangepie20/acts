import { eq, inArray } from "drizzle-orm";
import { parseCardPurchases } from "@/lib/imports/card";
import { parseTaxInvoices } from "@/lib/imports/tax-invoice";
import type { ImportMeta, ParsedRow } from "@/lib/imports/types";
import type { Recommendation } from "@/lib/recommend";
import { buildSimpleVoucher } from "@/lib/vouchers/simple";
import type { EvidenceType, VatType } from "@/lib/vouchers/types";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { closedMonthMessage, isMonthClosed, monthOf } from "@/server/closing/periods";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { partners, voucherImports } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { recommendMany } from "@/server/recommend/service";
import { fail, ok, type Result } from "@/server/result";
import { listSites } from "@/server/sites/service";
import { ERR_ALREADY_IMPORTED, createVoucher, errBeforeCutoff, getOpeningCutoff } from "@/server/vouchers/service";
import { readFirstSheet } from "./read-xlsx";

export type ImportKind = "tax_invoice" | "card";

export type PreviewRow = ParsedRow & {
  direction: "purchase" | "sale";
  partnerId: number | null;
  partnerName: string | null;
  status: "ready" | "duplicate" | "blocked";
  reason: string | null;
  recommendations: Recommendation[];
};

const errWrongDirection = (direction: "purchase" | "sale") =>
  `이 파일의 ${direction === "purchase" ? "공급받는자" : "공급자"}가 우리 회사가 아닙니다. 매입·매출 선택을 확인하세요.`;
const errPartnerInactive = (name: string) => `거래처(${name})가 사용 중지 상태입니다.`;

export async function previewImport(
  db: Db,
  kind: ImportKind,
  direction: "purchase" | "sale",
  bytes: Uint8Array,
): Promise<Result<{ rows: PreviewRow[] }>> {
  const dir = kind === "card" ? "purchase" : direction;
  const sheet = await readFirstSheet(bytes);
  if (!sheet.ok) return sheet;
  const parsed = kind === "card" ? parseCardPurchases(sheet.value) : parseTaxInvoices(sheet.value, dir);
  if (!parsed.ok) return parsed;
  const rows = parsed.value.rows;

  if (kind === "tax_invoice" && rows.length > 0) {
    const [c, sites] = await Promise.all([getCompany(db), listSites(db)]);
    const own = new Set([c.businessNumber, ...sites.map((s) => s.businessNumber)].filter((b): b is string => !!b));
    if (own.size > 0 && !rows.some((r) => r.ownBusinessNumber !== null && own.has(r.ownBusinessNumber))) {
      return fail(errWrongDirection(dir));
    }
  }

  const bns = [...new Set(rows.map((r) => r.counterpartyBusinessNumber).filter((b): b is string => !!b))];
  const partnerByBn = new Map<string, { id: number; name: string; isActive: boolean }>();
  if (kind === "tax_invoice" && bns.length > 0) {
    const found = await db
      .select({ id: partners.id, name: partners.name, isActive: partners.isActive, bn: partners.businessNumber })
      .from(partners)
      .where(inArray(partners.businessNumber, bns));
    for (const p of found) partnerByBn.set(p.bn!, p);
  }

  const keys = rows.filter((r) => !r.problem).map((r) => r.key);
  const seen = new Set<string>();
  if (keys.length > 0) {
    const found = await db
      .select({ k: voucherImports.importKey })
      .from(voucherImports)
      .where(inArray(voucherImports.importKey, keys));
    for (const r of found) seen.add(r.k);
  }

  const cutoff = await getOpeningCutoff(db);
  const closedCache = new Map<string, boolean>();
  const closed = async (month: string) => {
    if (!closedCache.has(month)) closedCache.set(month, await isMonthClosed(db, month));
    return closedCache.get(month)!;
  };

  const partnerOf = (r: ParsedRow) =>
    (r.counterpartyBusinessNumber && partnerByBn.get(r.counterpartyBusinessNumber)) || null;
  const recs = await recommendMany(
    db,
    dir,
    rows.map((r) => ({ partnerId: partnerOf(r)?.id ?? null, text: r.description })),
  );

  const out: PreviewRow[] = [];
  for (const [i, r] of rows.entries()) {
    const partner = partnerOf(r);
    let status: PreviewRow["status"] = "ready";
    let reason: string | null = null;
    if (r.problem) {
      status = "blocked";
      reason = r.problem;
    } else if (seen.has(r.key)) {
      status = "duplicate";
      reason = ERR_ALREADY_IMPORTED;
    } else if (r.date && (await closed(monthOf(r.date)))) {
      status = "blocked";
      reason = closedMonthMessage(monthOf(r.date));
    } else if (r.date && cutoff !== null && r.date <= cutoff) {
      status = "blocked";
      reason = errBeforeCutoff(cutoff);
    } else if (partner && !partner.isActive) {
      status = "blocked";
      reason = errPartnerInactive(partner.name);
    }
    out.push({
      ...r,
      direction: dir,
      partnerId: partner?.id ?? null,
      partnerName: partner?.name ?? null,
      status,
      reason,
      recommendations: recs[i],
    });
  }
  return ok({ rows: out });
}

export type CommitRow = {
  key: string;
  date: string;
  description: string;
  mainAccountId: number;
  deductible: boolean;
  partnerId: number | null;
  counterparty: { name: string; businessNumber: string | null; representative: string | null } | null;
  evidenceType: EvidenceType;
  vatType: VatType;
  supplyAmount: number;
  vatAmount: number;
  meta: ImportMeta;
};

export type CommitInput = {
  kind: ImportKind;
  direction: "purchase" | "sale";
  counterAccountId: number;
  cardPartnerId: number | null;
  siteId: number;
  departmentId: number | null;
  rows: CommitRow[];
};

/** Existing partner by business number, else a new one; a lost creation race re-selects. */
async function resolveTaxPartner(db: Db, c: NonNullable<CommitRow["counterparty"]>): Promise<Result<number | null>> {
  const bn = c.businessNumber?.replace(/\D/g, "") || null;
  if (!bn) return ok(null);
  const find = async () => {
    const [p] = await db.select({ id: partners.id }).from(partners).where(eq(partners.businessNumber, bn));
    return p?.id ?? null;
  };
  const existing = await find();
  if (existing !== null) return ok(existing);
  try {
    const created = await createPartner(db, {
      name: c.name,
      businessNumber: bn,
      representative: c.representative,
      phone: null,
      email: null,
      memo: null,
    });
    if (created.ok) return ok(created.value.id);
    const raced = await find();
    return raced !== null ? ok(raced) : created;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return ok(await find());
  }
}

export async function commitImport(
  db: Db,
  actor: SessionUser,
  input: CommitInput,
): Promise<{ created: { key: string; id: string }[]; failed: { key: string; error: string }[] }> {
  const created: { key: string; id: string }[] = [];
  const failed: { key: string; error: string }[] = [];
  const direction = input.kind === "card" ? "purchase" : input.direction;
  const vat = await getVatAccountIds(db);

  for (const row of input.rows) {
    try {
      let partnerId: number | null = null;
      if (input.kind === "card") partnerId = input.cardPartnerId;
      else if (row.partnerId !== null) partnerId = row.partnerId;
      else if (row.counterparty) {
        const p = await resolveTaxPartner(db, row.counterparty);
        if (!p.ok) {
          failed.push({ key: row.key, error: p.error });
          continue;
        }
        partnerId = p.value;
      }

      const v = buildSimpleVoucher(
        {
          type: direction,
          date: row.date,
          description: row.description,
          mainAccountId: row.mainAccountId,
          counterAccountId: input.counterAccountId,
          partnerId,
          siteId: input.siteId,
          departmentId: input.departmentId,
          evidenceType: row.evidenceType,
          vatType: row.vatType,
          vatDeductible: row.deductible,
          supplyAmount: row.supplyAmount,
          vatAmount: row.vatAmount,
        },
        vat,
      );
      if (!v.ok) {
        failed.push({ key: row.key, error: v.error });
        continue;
      }
      const r = await createVoucher(db, actor, v.value, { key: row.key, source: input.kind, meta: row.meta });
      if (r.ok) created.push({ key: row.key, id: r.value.id });
      else failed.push({ key: row.key, error: r.error });
    } catch (e) {
      console.error("commitImport row failed", e);
      failed.push({ key: row.key, error: "저장하지 못했습니다. 잠시 후 다시 시도하세요." });
    }
  }
  return { created, failed };
}
