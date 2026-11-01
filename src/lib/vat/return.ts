// Pure builder for the 일반과세자 부가가치세 신고서 figures (별지 제21호서식 제1쪽·제4쪽),
// 매출처별/매입처별 세금계산서합계표(갑) and 신용카드매출전표등 수령명세서(갑).
// Amounts are summed with their sign, so a 수정·취소분 (negative header) nets out.

import { E_FILING_CREDIT } from "./notices";
import type { VatSelection } from "./periods";
import type { Amounts, CardStatement, InvoiceSummary, PartnerTally, Tally, VatEntry } from "./types";

export type VatReturn = {
  /** computed rows only (COMPUTED_VAT_ROWS) */
  rows: Map<number, Amounts>;
  /** 납부(환급)세액 ㉰ = (9).tax − (18).tax */
  payable: number;
  /** only rows whose tax ≠ trunc(amount × 10 / 100); value = tax − that */
  taxDiff: Map<1 | 2 | 3 | 4, number>;
  sales: InvoiceSummary;
  purchases: InvoiceSummary;
  card: CardStatement;
  entryCount: number;
};

const zero = (): Amounts => ({ amount: 0, tax: 0 });
const add = (a: Amounts, e: VatEntry) => {
  a.amount += e.supplyAmount;
  a.tax += e.vatAmount;
};
const sum = (...xs: Amounts[]): Amounts => ({
  amount: xs.reduce((s, x) => s + x.amount, 0),
  tax: xs.reduce((s, x) => s + x.tax, 0),
});
const taxOnly = (tax: number): Amounts => ({ amount: 0, tax });

const isCardLike = (e: VatEntry) => e.evidenceType === "card" || e.evidenceType === "cash_receipt";

/** Card / 현금영수증 purchase that counts for (44)/(45) and the 수령명세서: deductible and taxable. */
const isDeductibleCardPurchase = (e: VatEntry) => isCardLike(e) && e.vatDeductible === true && e.vatType === "taxable";

/** (1)/(3)/(4)/(5)/(6) for a taxable or zero-rated sale; null for an exempt one. */
function saleRow(e: VatEntry): 1 | 3 | 4 | 5 | 6 | null {
  if (e.vatType === "taxable") return e.evidenceType === "tax_invoice" ? 1 : isCardLike(e) ? 3 : 4;
  if (e.vatType === "zero_rated") return e.evidenceType === "tax_invoice" ? 5 : 6;
  return null;
}

const emptyTally = (): Tally => ({ count: 0, supplyAmount: 0, vatAmount: 0 });
function tallyOf(entries: VatEntry[]): Tally {
  const t = emptyTally();
  for (const e of entries) {
    t.count += 1;
    t.supplyAmount += e.supplyAmount;
    t.vatAmount += e.vatAmount;
  }
  return t;
}
const partnerTally = (entries: VatEntry[]): PartnerTally => ({
  ...tallyOf(entries),
  partners: new Set(entries.map((e) => e.partnerKey)).size,
});

/** 세금계산서합계표(갑): every `tax_invoice` voucher, deductible or not. */
function invoiceSummary(entries: VatEntry[]): InvoiceSummary {
  const invoices = entries.filter((e) => e.evidenceType === "tax_invoice");
  const group = (list: VatEntry[]) => ({
    bn: partnerTally(list.filter((e) => e.businessNumber !== null)),
    rrn: partnerTally(list.filter((e) => e.businessNumber === null)),
    subtotal: partnerTally(list),
  });
  const other = invoices.filter((e) => e.paperTaxInvoice);

  const byBn = new Map<string, VatEntry[]>();
  for (const e of other) {
    if (e.businessNumber === null) continue;
    const list = byBn.get(e.businessNumber) ?? [];
    list.push(e);
    byBn.set(e.businessNumber, list);
  }
  const otherByPartner = [...byBn.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([businessNumber, list]) => ({
      businessNumber,
      name: list.find((e) => e.partnerName !== null)?.partnerName ?? null,
      ...tallyOf(list),
    }));

  return {
    total: partnerTally(invoices),
    electronic: group(invoices.filter((e) => !e.paperTaxInvoice)),
    other: group(other),
    otherByPartner,
  };
}

/** 신용카드매출전표등 수령명세서(갑): deductible `card` / `cash_receipt` purchases. */
function cardStatement(purchases: VatEntry[]): CardStatement {
  const list = purchases.filter(isDeductibleCardPurchase);
  const other = list.filter((e) => e.evidenceType === "card" && e.unregisteredCard);

  const detail = new Map<string, CardStatement["otherDetail"][number]>();
  for (const e of other) {
    const key = JSON.stringify([e.cardNo, e.businessNumber]);
    const d = detail.get(key) ?? { cardNo: e.cardNo, businessNumber: e.businessNumber, ...emptyTally() };
    d.count += 1;
    d.supplyAmount += e.supplyAmount;
    d.vatAmount += e.vatAmount;
    detail.set(key, d);
  }

  return {
    total: tallyOf(list),
    cashReceipt: tallyOf(list.filter((e) => e.evidenceType === "cash_receipt")),
    businessCard: tallyOf(list.filter((e) => e.evidenceType === "card" && !e.unregisteredCard)),
    otherCard: tallyOf(other),
    otherDetail: [...detail.values()],
  };
}

export function buildVatReturn(entries: VatEntry[], s: VatSelection): VatReturn {
  const r = new Map<number, Amounts>();
  for (const no of [1, 3, 4, 5, 6, 10, 12, 44, 45, 53, 88, 89, 90]) r.set(no, zero());
  const at = (no: number) => r.get(no)!;

  const sales = entries.filter((e) => e.entryType === "sale");
  const purchases = entries.filter((e) => e.entryType === "purchase");

  for (const e of sales) {
    const no = saleRow(e);
    if (no !== null) add(at(no), e);
    else if (e.vatType === "exempt") {
      add(at(88), e);
      if (e.evidenceType === "invoice") add(at(89), e);
    }
  }
  for (const e of purchases) {
    if (e.evidenceType === "tax_invoice") {
      add(at(e.fixedAsset ? 12 : 10), e);
      if (e.vatDeductible === false) add(at(53), e);
    } else if (isDeductibleCardPurchase(e)) {
      add(at(e.fixedAsset ? 45 : 44), e);
    } else if (e.evidenceType === "invoice") {
      add(at(90), e);
    }
  }
  // 계산서 rows carry no 세액.
  for (const no of [88, 89, 90]) at(no).tax = 0;

  const final = s.kind === "final";
  const r9 = sum(at(1), at(3), at(4), at(5), at(6));
  const r52 = sum(at(44), at(45));
  const r56 = sum(at(53));
  const r16 = sum(at(10), at(12), r52); // (10)−(11)+(12)+(13)+(14)+(15); (11), (13), (14) are 0
  const r18 = { amount: r16.amount - r56.amount, tax: r16.tax - r56.tax };
  const payable = r9.tax - r18.tax;
  const r57 = taxOnly(final && s.efile && entries.length > 0 ? E_FILING_CREDIT : 0);
  const r63 = sum(r57);
  const r21 = sum(r63); // (19) + (20); (20) is 0
  const r23 = taxOnly(final ? s.prelimRefund : 0);
  const r24 = taxOnly(final ? s.notice : 0);
  // ㉰ − ㉱ − ㉲ − ㉳ − ㉴ − ㉵ − ㉶ − ㉷ − ㉸ + ㉹; rows not computed count as 0.
  const r30 = taxOnly(payable - r21.tax - r23.tax - r24.tax);

  r.set(9, r9);
  r.set(15, { ...r52 });
  r.set(16, r16);
  r.set(17, { ...r56 });
  r.set(18, r18);
  r.set(19, { ...r63 });
  r.set(21, r21);
  r.set(23, r23);
  r.set(24, r24);
  r.set(30, r30);
  r.set(35, { amount: r9.amount, tax: 0 });
  r.set(52, r52);
  r.set(56, r56);
  r.set(57, r57);
  r.set(63, r63);

  const taxDiff = new Map<1 | 2 | 3 | 4, number>();
  for (const no of [1, 2, 3, 4] as const) {
    const a = r.get(no);
    if (!a) continue;
    const diff = a.tax - Math.trunc((a.amount * 10) / 100);
    if (diff !== 0) taxDiff.set(no, diff);
  }

  return {
    rows: new Map([...r.entries()].sort(([a], [b]) => a - b)),
    payable,
    taxDiff,
    sales: invoiceSummary(sales),
    purchases: invoiceSummary(purchases),
    card: cardStatement(purchases),
    entryCount: entries.length,
  };
}
