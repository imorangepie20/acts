import { and, asc, between, eq, inArray } from "drizzle-orm";
import type { VatEntry } from "@/lib/vat/types";
import { formatVoucherNo, POSTED_STATUSES } from "@/lib/vouchers/types";
import type { Db } from "@/server/db/client";
import { accounts, partners, voucherImports, voucherLines, vouchers } from "@/server/db/schema";

const tenDigits = (v: string | null | undefined): string | null => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 10 ? d : null;
};

/** Posted purchase and sale vouchers in [from, to] as the VAT return builder reads them. */
export async function loadVatEntries(db: Db, from: string, to: string): Promise<VatEntry[]> {
  const rows = await db
    .select({
      id: vouchers.id,
      no: vouchers.no,
      date: vouchers.date,
      entryType: vouchers.entryType,
      evidenceType: vouchers.evidenceType,
      vatType: vouchers.vatType,
      vatDeductible: vouchers.vatDeductible,
      supplyAmount: vouchers.supplyAmount,
      vatAmount: vouchers.vatAmount,
      paperTaxInvoice: vouchers.paperTaxInvoice,
      unregisteredCard: vouchers.unregisteredCard,
      partnerId: vouchers.partnerId,
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
        inArray(vouchers.entryType, ["purchase", "sale"]),
      ),
    )
    .orderBy(asc(vouchers.date), asc(vouchers.no));
  if (rows.length === 0) return [];

  // The main account is the first line (buildSimpleVoucher emits it first), not any non-VAT line.
  const purchaseIds = rows.filter((r) => r.entryType === "purchase").map((r) => r.id);
  const mainGroup = new Map<string, string>();
  if (purchaseIds.length > 0) {
    const lines = await db
      .select({ voucherId: voucherLines.voucherId, group: accounts.group })
      .from(voucherLines)
      .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
      .where(inArray(voucherLines.voucherId, purchaseIds))
      .orderBy(asc(voucherLines.voucherId), asc(voucherLines.lineNo));
    for (const l of lines) if (!mainGroup.has(l.voucherId)) mainGroup.set(l.voucherId, l.group);
  }

  return rows.flatMap((r) => {
    // Trade vouchers always carry a vat type (buildSimpleVoucher sets it); skip a row without one rather than guess.
    if (r.vatType === null) return [];
    const businessNumber = tenDigits(r.meta?.merchantBusinessNumber ?? r.partnerBn);
    const entry = {
      voucherId: r.id,
      voucherNo: formatVoucherNo(r.date, r.no),
      date: r.date,
      entryType: r.entryType === "sale" ? "sale" : "purchase",
      evidenceType: r.evidenceType,
      vatType: r.vatType,
      vatDeductible: r.vatDeductible,
      supplyAmount: r.supplyAmount ?? 0,
      vatAmount: r.vatAmount ?? 0,
      fixedAsset: r.entryType === "purchase" && mainGroup.get(r.id) === "noncurrent_asset",
      paperTaxInvoice: r.paperTaxInvoice,
      unregisteredCard: r.unregisteredCard,
      businessNumber,
      partnerName: r.meta?.merchantName ?? r.partnerName,
      partnerKey: businessNumber ?? (r.partnerId !== null ? `p:${r.partnerId}` : "none"),
      cardNo: r.meta?.cardNo ?? null,
    } satisfies VatEntry;
    return [entry];
  });
}
