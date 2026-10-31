import { and, asc, between, eq, inArray } from "drizzle-orm";
import { formatBusinessNumber } from "@/lib/business-number";
import { POSTED_STATUSES, formatVoucherNo } from "@/lib/vouchers/types";
import type { Db } from "@/server/db/client";
import { partners, sites, voucherImports, voucherLines, vouchers } from "@/server/db/schema";

export type TaxInvoiceRow = {
  date: string;
  voucherNo: string;
  direction: "매출" | "매입";
  evidence: "세금계산서" | "계산서";
  partnerName: string | null;
  businessNumber: string | null;
  supplyAmount: number;
  vatAmount: number;
  total: number;
  approvalNo: string | null;
  siteName: string;
};

export type CardPurchaseRow = {
  date: string;
  voucherNo: string;
  evidence: "신용카드" | "현금영수증";
  merchantName: string | null;
  merchantBusinessNumber: string | null;
  supplyAmount: number;
  vatAmount: number;
  deductible: boolean;
  cardNo: string | null;
  description: string;
  siteName: string;
};

type Entry = "purchase" | "sale";
type Evidence = "tax_invoice" | "invoice" | "card" | "cash_receipt";

/** Posted vouchers of the given kinds in [from, to], with partner, import meta and first-line site. */
async function loadVouchers(db: Db, from: string, to: string, entryTypes: Entry[], evidence: Evidence[]) {
  const rows = await db
    .select({
      id: vouchers.id,
      date: vouchers.date,
      no: vouchers.no,
      entryType: vouchers.entryType,
      evidenceType: vouchers.evidenceType,
      description: vouchers.description,
      vatDeductible: vouchers.vatDeductible,
      supplyAmount: vouchers.supplyAmount,
      vatAmount: vouchers.vatAmount,
      partnerName: partners.name,
      partnerBn: partners.businessNumber,
      meta: voucherImports.meta,
    })
    .from(vouchers)
    .leftJoin(partners, eq(partners.id, vouchers.partnerId))
    .leftJoin(voucherImports, eq(voucherImports.voucherId, vouchers.id))
    .where(
      and(
        between(vouchers.date, from, to),
        inArray(vouchers.status, [...POSTED_STATUSES]),
        inArray(vouchers.entryType, entryTypes),
        inArray(vouchers.evidenceType, evidence),
      ),
    )
    .orderBy(asc(vouchers.date), asc(vouchers.no));
  if (rows.length === 0) return { rows, siteOf: new Map<string, string>() };

  const lines = await db
    .select({ voucherId: voucherLines.voucherId, siteName: sites.name })
    .from(voucherLines)
    .innerJoin(sites, eq(sites.id, voucherLines.siteId))
    .where(inArray(voucherLines.voucherId, rows.map((r) => r.id)))
    .orderBy(asc(voucherLines.voucherId), asc(voucherLines.lineNo));
  const siteOf = new Map<string, string>();
  for (const l of lines) if (!siteOf.has(l.voucherId)) siteOf.set(l.voucherId, l.siteName);
  return { rows, siteOf };
}

const bn = (v: string | null | undefined) => (v ? formatBusinessNumber(v) : null);

export async function listTaxInvoices(db: Db, from: string, to: string): Promise<TaxInvoiceRow[]> {
  const { rows, siteOf } = await loadVouchers(db, from, to, ["purchase", "sale"], ["tax_invoice", "invoice"]);
  return rows.map((r) => {
    const supplyAmount = r.supplyAmount ?? 0;
    const vatAmount = r.vatAmount ?? 0;
    return {
      date: r.date,
      voucherNo: formatVoucherNo(r.date, r.no),
      direction: r.entryType === "sale" ? "매출" : "매입",
      evidence: r.evidenceType === "invoice" ? "계산서" : "세금계산서",
      partnerName: r.meta?.merchantName ?? r.partnerName,
      businessNumber: bn(r.meta?.merchantBusinessNumber ?? r.partnerBn),
      supplyAmount,
      vatAmount,
      total: supplyAmount + vatAmount,
      approvalNo: r.meta?.approvalNo ?? null,
      siteName: siteOf.get(r.id) ?? "",
    };
  });
}

export async function listCardPurchases(db: Db, from: string, to: string): Promise<CardPurchaseRow[]> {
  const { rows, siteOf } = await loadVouchers(db, from, to, ["purchase"], ["card", "cash_receipt"]);
  return rows.map((r) => ({
    date: r.date,
    voucherNo: formatVoucherNo(r.date, r.no),
    evidence: r.evidenceType === "cash_receipt" ? "현금영수증" : "신용카드",
    merchantName: r.meta?.merchantName ?? r.partnerName,
    merchantBusinessNumber: bn(r.meta?.merchantBusinessNumber ?? r.partnerBn),
    supplyAmount: r.supplyAmount ?? 0,
    vatAmount: r.vatAmount ?? 0,
    deductible: r.vatDeductible === true,
    cardNo: r.meta?.cardNo ?? null,
    description: r.description,
    siteName: siteOf.get(r.id) ?? "",
  }));
}
