export type EntryType = "purchase" | "sale" | "transfer" | "general";
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  purchase: "매입·비용",
  sale: "매출",
  transfer: "입출금·대체",
  general: "일반 전표",
};

export type VoucherKind = "general" | "closing";
export const VOUCHER_KIND_LABELS: Record<VoucherKind, string> = {
  general: "일반",
  closing: "결산",
};

export type VoucherStatus = "pending" | "approved" | "rejected";
export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
};
export const POSTED_STATUSES = ["approved"] as const;

export type EvidenceType =
  | "tax_invoice"
  | "invoice"
  | "card"
  | "cash_receipt"
  | "simple_receipt"
  | "none";
export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  tax_invoice: "세금계산서",
  invoice: "계산서",
  card: "신용카드",
  cash_receipt: "현금영수증",
  simple_receipt: "간이영수증",
  none: "증빙 없음",
};

export type VatType = "taxable" | "zero_rated" | "exempt";
export const VAT_TYPE_LABELS: Record<VatType, string> = {
  taxable: "과세",
  zero_rated: "영세",
  exempt: "면세",
};

export type Side = "debit" | "credit";

export type LineInput = {
  accountId: number;
  side: Side;
  amount: number;
  partnerId: number | null;
  siteId: number;
  departmentId: number | null;
  description: string;
};

export type VoucherHeaderInput = {
  date: string;
  description: string;
  entryType: EntryType;
  /** 결산 vouchers are ordinary posted entries; 기초 (opening) is never entered through a form. */
  kind: "general" | "closing";
  partnerId: number | null;
  evidenceType: EvidenceType;
  vatType: VatType | null;
  vatDeductible: boolean | null;
  supplyAmount: number | null;
  vatAmount: number | null;
};

export type VoucherInput = VoucherHeaderInput & { lines: LineInput[] };

export type VoucherAction =
  | "created"
  | "updated"
  | "deleted"
  | "approved"
  | "rejected"
  | "attached"
  | "detached";

/** Voucher state stored in a history row; `attachments` holds file names. */
export type VoucherSnapshot = VoucherInput & {
  no: number;
  status: VoucherStatus;
  attachments: string[];
};

/** "2026-10-30", 1 → "20261030-0001" */
export function formatVoucherNo(date: string, no: number): string {
  return `${date.replaceAll("-", "")}-${String(no).padStart(4, "0")}`;
}
