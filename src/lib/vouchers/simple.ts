import { MAX_WON } from "@/lib/money";
import { fail, ok, type Result } from "@/server/result";
import type { EvidenceType, LineInput, VatType, VoucherInput } from "./types";

export type TradeInput = {
  type: "purchase" | "sale";
  date: string;
  description: string;
  /** purchase: expense/asset account; sale: revenue account */
  mainAccountId: number;
  /** purchase: payment account; sale: receipt account */
  counterAccountId: number;
  partnerId: number | null;
  siteId: number;
  departmentId: number | null;
  evidenceType: EvidenceType;
  vatType: VatType;
  vatDeductible: boolean;
  /** Negative (with vatAmount 0 or negative too) for a 수정·취소분: the lines swap sides. */
  supplyAmount: number;
  vatAmount: number;
  /** 종이(전자 외) 세금계산서; `tax_invoice` evidence only. Absent = false. */
  paperTaxInvoice?: boolean;
  /** 홈택스 미등록 카드; a purchase with `card` evidence only. Absent = false. */
  unregisteredCard?: boolean;
};

export type TransferInput = {
  type: "transfer";
  date: string;
  description: string;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  partnerId: number | null;
  siteId: number;
  departmentId: number | null;
  evidenceType: EvidenceType;
};

export type SimpleInput = TradeInput | TransferInput;
export type VatAccounts = { inputAccountId: number; outputAccountId: number };

/** Receipt-total convention: VAT = floor(total / 11), remainder is supply. */
export function splitVatFromTotal(total: number): { supplyAmount: number; vatAmount: number } {
  const vatAmount = Math.floor(total / 11);
  return { supplyAmount: total - vatAmount, vatAmount };
}

/** 10% of the supply amount, truncated (for tax invoices where supply is typed). */
export function defaultVat(supplyAmount: number): number {
  return Math.floor(supplyAmount / 10);
}

export const ERR_SIGN = "공급가액과 부가세의 부호가 같아야 합니다.";
export const ERR_PAPER = "종이 세금계산서는 세금계산서 증빙에만 표시할 수 있습니다.";
export const ERR_UNREGISTERED_CARD = "홈택스 미등록 카드는 신용카드 매입에만 표시할 수 있습니다.";

/** Size rules apply to the magnitudes; a 수정·취소분 has a negative supply and a VAT of 0 or less. */
function validateTrade(input: TradeInput): string | null {
  if (!Number.isInteger(input.supplyAmount)) return "금액을 입력하세요.";
  if (!Number.isInteger(input.vatAmount)) return "부가세가 올바르지 않습니다.";
  if (input.supplyAmount < 0 ? input.vatAmount > 0 : input.vatAmount < 0) return ERR_SIGN;
  if (input.paperTaxInvoice && input.evidenceType !== "tax_invoice") return ERR_PAPER;
  if (input.unregisteredCard && (input.type !== "purchase" || input.evidenceType !== "card")) {
    return ERR_UNREGISTERED_CARD;
  }
  const i = { ...input, supplyAmount: Math.abs(input.supplyAmount), vatAmount: Math.abs(input.vatAmount) };
  if (i.supplyAmount < 1 || i.supplyAmount > MAX_WON) return "금액을 입력하세요.";
  if (i.evidenceType === "invoice" && i.vatType !== "exempt") {
    return "계산서는 면세 거래에만 사용할 수 있습니다.";
  }
  if ((i.vatType === "zero_rated" || i.vatType === "exempt") && i.vatAmount > 0) {
    return "영세·면세 거래는 부가세가 0원이어야 합니다.";
  }
  if (
    i.type === "purchase" &&
    (i.evidenceType === "simple_receipt" || i.evidenceType === "none") &&
    i.vatAmount > 0
  ) {
    return "간이영수증·증빙 없음은 부가세를 공제받을 수 없습니다. 합계를 공급가액으로 입력하세요.";
  }
  if (i.vatAmount > i.supplyAmount) return "부가세가 공급가액보다 클 수 없습니다.";
  return null;
}

function validateSimple(input: SimpleInput): string | null {
  if (input.type === "transfer") {
    return !Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_WON
      ? "금액을 입력하세요."
      : null;
  }
  return validateTrade(input);
}

export function buildSimpleVoucher(input: SimpleInput, vat: VatAccounts): Result<VoucherInput> {
  const message = validateSimple(input);
  if (message) return fail(message);
  return ok(emitSimple(input, vat));
}

/** Emits the voucher for an input without validating it. */
function emitSimple(input: SimpleInput, vat: VatAccounts): VoucherInput {
  const dims = {
    partnerId: input.partnerId,
    siteId: input.siteId,
    departmentId: input.departmentId,
    description: input.description,
  };
  const line = (accountId: number, side: LineInput["side"], amount: number): LineInput => ({
    accountId,
    side,
    amount,
    ...dims,
  });

  if (input.type === "transfer") {
    return {
      date: input.date,
      description: input.description,
      entryType: "transfer",
      kind: "general",
      partnerId: input.partnerId,
      evidenceType: input.evidenceType,
      vatType: null,
      vatDeductible: null,
      supplyAmount: null,
      vatAmount: null,
      paperTaxInvoice: false,
      unregisteredCard: false,
      lines: [
        line(input.debitAccountId, "debit", input.amount),
        line(input.creditAccountId, "credit", input.amount),
      ],
    };
  }

  const negative = input.supplyAmount < 0;
  const supply = Math.abs(input.supplyAmount);
  const tax = Math.abs(input.vatAmount);
  const lines: LineInput[] = [];
  if (input.type === "purchase") {
    if (input.vatDeductible) {
      lines.push(line(input.mainAccountId, "debit", supply));
      if (tax > 0) lines.push(line(vat.inputAccountId, "debit", tax));
    } else {
      lines.push(line(input.mainAccountId, "debit", supply + tax));
    }
    lines.push(line(input.counterAccountId, "credit", supply + tax));
  } else {
    lines.push(line(input.counterAccountId, "debit", supply + tax));
    lines.push(line(input.mainAccountId, "credit", supply));
    if (tax > 0) lines.push(line(vat.outputAccountId, "credit", tax));
  }
  // A 수정·취소분 is the same entry reversed: same line order, sides swapped.
  if (negative) for (const l of lines) l.side = l.side === "debit" ? "credit" : "debit";

  return {
    date: input.date,
    description: input.description,
    entryType: input.type,
    kind: "general",
    partnerId: input.partnerId,
    evidenceType: input.evidenceType,
    vatType: input.vatType,
    vatDeductible: input.type === "purchase" ? input.vatDeductible : null,
    supplyAmount: input.supplyAmount,
    vatAmount: input.vatAmount,
    paperTaxInvoice: input.paperTaxInvoice === true,
    unregisteredCard: input.unregisteredCard === true,
    lines,
  };
}

function sameLines(a: LineInput[], b: LineInput[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.accountId === y.accountId &&
        x.side === y.side &&
        x.amount === y.amount &&
        x.partnerId === y.partnerId &&
        x.siteId === y.siteId &&
        x.departmentId === y.departmentId &&
        x.description === y.description
      );
    })
  );
}

/**
 * Inverse of buildSimpleVoucher for the edit form. Returns null unless the voucher
 * has exactly the shape the builder would emit for the recovered input (so `general`
 * vouchers and tampered payloads are rejected). A sale's null vatDeductible maps
 * back to false.
 */
export function toSimpleInput(v: VoucherInput, vat: VatAccounts): SimpleInput | null {
  const first = v.lines[0];
  if (!first) return null;
  const dims = { partnerId: first.partnerId, siteId: first.siteId, departmentId: first.departmentId };
  let candidate: SimpleInput;

  if (v.entryType === "transfer") {
    const debit = v.lines.find((l) => l.side === "debit");
    const credit = v.lines.find((l) => l.side === "credit");
    if (v.lines.length !== 2 || !debit || !credit) return null;
    candidate = {
      type: "transfer",
      date: v.date,
      description: v.description,
      debitAccountId: debit.accountId,
      creditAccountId: credit.accountId,
      amount: debit.amount,
      ...dims,
      evidenceType: v.evidenceType,
    };
  } else if (v.entryType === "purchase" || v.entryType === "sale") {
    if (v.vatType === null || v.supplyAmount === null || v.vatAmount === null) return null;
    const isPurchase = v.entryType === "purchase";
    if (isPurchase && v.vatDeductible === null) return null;
    // purchase: main is the first debit, counter the (only) credit
    // sale: counter is the (only) debit, main the first credit
    // (sides swapped for a 수정·취소분, whose supply amount is negative)
    const mainIsDebit = isPurchase !== v.supplyAmount < 0;
    const mainLine = v.lines.find((l) => l.side === (mainIsDebit ? "debit" : "credit"));
    const counterLine = v.lines.find((l) => l.side === (mainIsDebit ? "credit" : "debit"));
    if (!mainLine || !counterLine) return null;
    candidate = {
      type: v.entryType,
      date: v.date,
      description: v.description,
      mainAccountId: mainLine.accountId,
      counterAccountId: counterLine.accountId,
      ...dims,
      evidenceType: v.evidenceType,
      vatType: v.vatType,
      vatDeductible: isPurchase ? v.vatDeductible === true : false,
      supplyAmount: v.supplyAmount,
      vatAmount: v.vatAmount,
      paperTaxInvoice: v.paperTaxInvoice === true,
      unregisteredCard: v.unregisteredCard === true,
    };
  } else {
    return null;
  }

  // Structural only: VAT-rule violations are left for buildSimpleVoucher to report.
  const r = emitSimple(candidate, vat);
  const headerSame =
    r.entryType === v.entryType &&
    r.partnerId === v.partnerId &&
    r.vatType === v.vatType &&
    r.vatDeductible === v.vatDeductible &&
    r.supplyAmount === v.supplyAmount &&
    r.vatAmount === v.vatAmount;
  return headerSame && sameLines(r.lines, v.lines) ? candidate : null;
}
