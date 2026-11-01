// Input and output shapes of the pure VAT return builder (src/lib/vat/return.ts).

import type { EvidenceType, VatType } from "@/lib/vouchers/types";

/** One approved purchase or sale voucher, summarised by the loader (src/server/vat/). */
export type VatEntry = {
  voucherId: string;
  /** formatVoucherNo(date, no) */
  voucherNo: string;
  date: string;
  entryType: "purchase" | "sale";
  evidenceType: EvidenceType;
  vatType: VatType;
  vatDeductible: boolean | null;
  supplyAmount: number;
  vatAmount: number;
  /** purchase only: main (first) line's account group is noncurrent_asset */
  fixedAsset: boolean;
  paperTaxInvoice: boolean;
  unregisteredCard: boolean;
  /** 10 digits, or null when the partner has none */
  businessNumber: string | null;
  partnerName: string | null;
  /** distinct-partner key: business number, else `p:<partnerId>`, else `none` */
  partnerKey: string;
  cardNo: string | null;
};

export type Amounts = { amount: number; tax: number };
export type Tally = { count: number; supplyAmount: number; vatAmount: number };
export type PartnerTally = Tally & { partners: number };

/** 매출처별 / 매입처별 세금계산서합계표(갑). */
export type InvoiceSummary = {
  total: PartnerTally;
  electronic: { bn: PartnerTally; rrn: PartnerTally; subtotal: PartnerTally };
  other: { bn: PartnerTally; rrn: PartnerTally; subtotal: PartnerTally };
  /** 전자 외 + 사업자등록번호 발급분, one row per business number, sorted by it */
  otherByPartner: (Tally & { businessNumber: string; name: string | null })[];
};

/** 신용카드매출전표등 수령명세서(갑). */
export type CardStatement = {
  total: Tally;
  cashReceipt: Tally;
  businessCard: Tally;
  otherCard: Tally;
  /** ⑧ by (cardNo, businessNumber); cardNo null = 직접 입력 */
  otherDetail: (Tally & { cardNo: string | null; businessNumber: string | null })[];
};

/** A 매입 세금계산서 whose partner has no 사업자등록번호 (it counts in the 주민등록번호 rows). */
export type PurchaseWithoutBusinessNumber = { voucherId: string; voucherNo: string; date: string; partnerName: string | null };
