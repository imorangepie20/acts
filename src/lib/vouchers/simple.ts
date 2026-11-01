import { MAX_WON } from "@/lib/money";
import { fail, ok, type Result } from "@/server/result";
import type { EvidenceType, LineInput, VatType, VoucherInput } from "./types";

/** One account's share of a trade's supply amount (a positive magnitude). */
export type TradeSplit = { accountId: number; amount: number };

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
  /**
   * 계정 나누기: one invoice posted to two or more main accounts (e.g. 월세 + 관리비 on one
   * 세금계산서). Positive amounts summing to |supplyAmount|; the first is `mainAccountId`.
   * Absent = the whole supply on `mainAccountId`.
   */
  splits?: TradeSplit[];
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
export const ERR_TAX_INVOICE_EXEMPT = "면세 거래는 증빙을 계산서로 선택하세요.";
export const ERR_SPLIT_COUNT = "나눌 계정을 2개 이상 입력하세요.";
export const ERR_SPLIT_AMOUNT = "나눌 금액을 입력하세요.";
export const ERR_SPLIT_SUM = "나눈 금액의 합계가 공급가액과 같아야 합니다.";
export const ERR_SPLIT_NON_DEDUCTIBLE = "불공제 매입은 계정을 나눌 수 없습니다. 전표를 따로 입력하세요.";

function validateSplits(input: TradeInput, supply: number, tax: number): string | null {
  const s = input.splits;
  if (s === undefined) return null;
  if (s.length < 2 || s[0].accountId !== input.mainAccountId) return ERR_SPLIT_COUNT;
  if (s.some((x) => !Number.isInteger(x.amount) || x.amount < 1 || x.amount > MAX_WON)) return ERR_SPLIT_AMOUNT;
  if (s.reduce((sum, x) => sum + x.amount, 0) !== supply) return ERR_SPLIT_SUM;
  // Non-deducted VAT is added to the cost; with several accounts it would have to be apportioned.
  if (input.type === "purchase" && !input.vatDeductible && tax > 0) return ERR_SPLIT_NON_DEDUCTIBLE;
  return null;
}

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
  if (i.evidenceType === "tax_invoice" && i.vatType === "exempt") return ERR_TAX_INVOICE_EXEMPT;
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
  return validateSplits(input, i.supplyAmount, i.vatAmount);
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
  const mains: TradeSplit[] = input.splits ?? [{ accountId: input.mainAccountId, amount: supply }];
  const lines: LineInput[] = [];
  if (input.type === "purchase") {
    if (input.vatDeductible) {
      for (const m of mains) lines.push(line(m.accountId, "debit", m.amount));
      if (tax > 0) lines.push(line(vat.inputAccountId, "debit", tax));
    } else {
      // Non-deducted VAT joins the cost (validation keeps splits to a VAT of 0 here).
      mains.forEach((m, i) => lines.push(line(m.accountId, "debit", m.amount + (i === 0 ? tax : 0))));
    }
    lines.push(line(input.counterAccountId, "credit", supply + tax));
  } else {
    lines.push(line(input.counterAccountId, "debit", supply + tax));
    for (const m of mains) lines.push(line(m.accountId, "credit", m.amount));
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
    const mainSide = v.lines.filter((l) => l.side === (mainIsDebit ? "debit" : "credit"));
    const counterLine = v.lines.find((l) => l.side === (mainIsDebit ? "credit" : "debit"));
    // The VAT line, when there is one, follows the main lines on their side.
    const hasVatLine = v.vatAmount !== 0 && (!isPurchase || v.vatDeductible === true);
    const mains = hasVatLine ? mainSide.slice(0, -1) : mainSide;
    if (mains.length === 0 || !counterLine) return null;
    candidate = {
      type: v.entryType,
      date: v.date,
      description: v.description,
      mainAccountId: mains[0].accountId,
      counterAccountId: counterLine.accountId,
      ...dims,
      evidenceType: v.evidenceType,
      vatType: v.vatType,
      vatDeductible: isPurchase ? v.vatDeductible === true : false,
      supplyAmount: v.supplyAmount,
      vatAmount: v.vatAmount,
      paperTaxInvoice: v.paperTaxInvoice === true,
      unregisteredCard: v.unregisteredCard === true,
      ...(mains.length > 1 && { splits: mains.map((l) => ({ accountId: l.accountId, amount: l.amount })) }),
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
