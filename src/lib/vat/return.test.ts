import { describe, expect, it } from "vitest";
import { E_FILING_CREDIT } from "./notices";
import { buildVatReturn } from "./return";
import { COMPUTED_VAT_ROWS, PAGE1_GROUPS, PAGE4_GROUPS } from "./rows";
import type { VatSelection } from "./periods";
import type { VatEntry } from "./types";

const entry = (over: Partial<VatEntry>): VatEntry => ({
  entryType: "sale",
  evidenceType: "tax_invoice",
  vatType: "taxable",
  vatDeductible: null,
  supplyAmount: 0,
  vatAmount: 0,
  fixedAsset: false,
  paperTaxInvoice: false,
  unregisteredCard: false,
  businessNumber: "1234567890",
  partnerName: "거래처",
  partnerKey: "1234567890",
  cardNo: null,
  ...over,
});

const sale = (over: Partial<VatEntry>) => entry({ entryType: "sale", ...over });
const purchase = (over: Partial<VatEntry>) => entry({ entryType: "purchase", vatDeductible: true, ...over });

const sel = (over: Partial<VatSelection> = {}): VatSelection => ({
  year: 2026,
  term: 1,
  kind: "prelim",
  prelimFiled: true,
  efile: true,
  prelimRefund: 0,
  notice: 0,
  errors: {},
  ...over,
});

const amt = (amount: number, tax: number) => ({ amount, tax });

describe("buildVatReturn", () => {
  it("sorts sales into (1)–(6) and totals (9)", () => {
    const r = buildVatReturn(
      [
        sale({ evidenceType: "tax_invoice", supplyAmount: 1_000_000, vatAmount: 100_000 }),
        sale({ evidenceType: "card", supplyAmount: 200_000, vatAmount: 20_000 }),
        sale({ evidenceType: "none", supplyAmount: 50_000, vatAmount: 5_000 }),
        sale({ evidenceType: "tax_invoice", vatType: "zero_rated", supplyAmount: 300_000, vatAmount: 0 }),
        sale({ evidenceType: "none", vatType: "zero_rated", supplyAmount: 10_000, vatAmount: 0 }),
      ],
      sel(),
    );
    expect(r.rows.get(1)).toEqual(amt(1_000_000, 100_000));
    expect(r.rows.get(3)).toEqual(amt(200_000, 20_000));
    expect(r.rows.get(4)).toEqual(amt(50_000, 5_000));
    expect(r.rows.get(5)).toEqual(amt(300_000, 0));
    expect(r.rows.get(6)).toEqual(amt(10_000, 0));
    expect(r.rows.get(9)).toEqual(amt(1_560_000, 125_000));
    expect(r.rows.get(35)).toEqual(amt(1_560_000, 0));
    expect(r.rows.has(2)).toBe(false);
    expect(r.payable).toBe(125_000);
    expect(r.entryCount).toBe(5);
  });

  it("splits 세금계산서 수취분 into (10)/(12) and nets (17)", () => {
    const r = buildVatReturn(
      [
        purchase({ supplyAmount: 500_000, vatAmount: 50_000 }),
        purchase({ fixedAsset: true, supplyAmount: 2_000_000, vatAmount: 200_000 }),
        purchase({ vatDeductible: false, supplyAmount: 100_000, vatAmount: 10_000 }),
      ],
      sel(),
    );
    expect(r.rows.get(10)).toEqual(amt(600_000, 60_000));
    expect(r.rows.get(12)).toEqual(amt(2_000_000, 200_000));
    expect(r.rows.get(53)).toEqual(amt(100_000, 10_000));
    expect(r.rows.get(56)).toEqual(amt(100_000, 10_000));
    expect(r.rows.get(17)).toEqual(amt(100_000, 10_000));
    expect(r.rows.get(16)).toEqual(amt(2_600_000, 260_000));
    expect(r.rows.get(18)).toEqual(amt(2_500_000, 250_000));
    expect(r.payable).toBe(-250_000);
  });

  it("exempt / zero-rated card purchases never reach (44)/(45)/(15) or the card statement", () => {
    const r = buildVatReturn(
      [
        purchase({ evidenceType: "card", vatType: "exempt", supplyAmount: 7_000, vatAmount: 0 }),
        purchase({ evidenceType: "cash_receipt", vatType: "zero_rated", supplyAmount: 8_000, vatAmount: 0 }),
        purchase({ evidenceType: "card", supplyAmount: 30_000, vatAmount: 3_000 }),
      ],
      sel(),
    );
    expect(r.rows.get(44)).toEqual(amt(30_000, 3_000));
    expect(r.rows.get(45)).toEqual(amt(0, 0));
    expect(r.rows.get(52)).toEqual(amt(30_000, 3_000));
    expect(r.rows.get(15)).toEqual(amt(30_000, 3_000));
    expect(r.card.total).toEqual({ count: 1, supplyAmount: 30_000, vatAmount: 3_000 });
  });

  it("puts deductible card/현금영수증 into (44)/(45) and skips non-deductible", () => {
    const r = buildVatReturn(
      [
        purchase({ evidenceType: "card", supplyAmount: 30_000, vatAmount: 3_000 }),
        purchase({ evidenceType: "cash_receipt", fixedAsset: true, supplyAmount: 1_000_000, vatAmount: 100_000 }),
        purchase({ evidenceType: "card", vatDeductible: false, supplyAmount: 9_000, vatAmount: 900 }),
      ],
      sel(),
    );
    expect(r.rows.get(44)).toEqual(amt(30_000, 3_000));
    expect(r.rows.get(45)).toEqual(amt(1_000_000, 100_000));
    expect(r.rows.get(52)).toEqual(amt(1_030_000, 103_000));
    expect(r.rows.get(15)).toEqual(amt(1_030_000, 103_000));
    expect(r.rows.get(16)).toEqual(amt(1_030_000, 103_000));
    expect(r.rows.get(53)).toEqual(amt(0, 0));
    expect(r.rows.get(18)).toEqual(amt(1_030_000, 103_000));
    expect(r.card.total).toEqual({ count: 2, supplyAmount: 1_030_000, vatAmount: 103_000 });
  });

  it("leaves 간이영수증 and 증빙 없음 purchases out of the 매입세액", () => {
    const r = buildVatReturn(
      [
        purchase({ evidenceType: "simple_receipt", supplyAmount: 10_000, vatAmount: 1_000 }),
        purchase({ evidenceType: "none", supplyAmount: 20_000, vatAmount: 2_000 }),
      ],
      sel(),
    );
    expect(r.rows.get(16)).toEqual(amt(0, 0));
    expect(r.rows.get(18)).toEqual(amt(0, 0));
    expect(r.entryCount).toBe(2);
  });

  it("nets a 수정·취소분 to zero and counts both", () => {
    const r = buildVatReturn(
      [
        sale({ supplyAmount: 1_000_000, vatAmount: 100_000 }),
        sale({ supplyAmount: -1_000_000, vatAmount: -100_000 }),
      ],
      sel(),
    );
    expect(r.rows.get(1)).toEqual(amt(0, 0));
    expect(r.sales.total.count).toBe(2);
    expect(r.sales.electronic.bn.count).toBe(2);
    expect(r.sales.total.supplyAmount).toBe(0);
    expect(r.sales.total.vatAmount).toBe(0);
  });

  it("(57) only on a 확정 with entries and efile", () => {
    const entries = [sale({ supplyAmount: 1_000_000, vatAmount: 100_000 })];
    expect(E_FILING_CREDIT).toBe(5000);
    expect(buildVatReturn(entries, sel({ kind: "prelim" })).rows.get(57)).toEqual(amt(0, 0));
    expect(buildVatReturn([], sel({ kind: "final" })).rows.get(57)).toEqual(amt(0, 0));
    expect(buildVatReturn(entries, sel({ kind: "final", efile: false })).rows.get(57)).toEqual(amt(0, 0));

    const r = buildVatReturn(entries, sel({ kind: "final", prelimRefund: 7_000, notice: 20_000 }));
    expect(r.rows.get(57)).toEqual(amt(0, 5_000));
    expect(r.rows.get(63)).toEqual(amt(0, 5_000));
    expect(r.rows.get(19)).toEqual(amt(0, 5_000));
    expect(r.rows.get(21)).toEqual(amt(0, 5_000));
    expect(r.rows.get(23)).toEqual(amt(0, 7_000));
    expect(r.rows.get(24)).toEqual(amt(0, 20_000));
    expect(r.rows.get(30)).toEqual(amt(0, 100_000 - 5_000 - 7_000 - 20_000));

    const p = buildVatReturn(entries, sel({ kind: "prelim", prelimRefund: 7_000, notice: 20_000 }));
    expect(p.rows.get(23)).toEqual(amt(0, 0));
    expect(p.rows.get(24)).toEqual(amt(0, 0));
    expect(p.rows.get(30)).toEqual(amt(0, 100_000));
  });

  it("exempt sales and 계산서 go to (88)/(89)/(90)", () => {
    const r = buildVatReturn(
      [
        sale({ vatType: "exempt", evidenceType: "invoice", supplyAmount: 400_000, vatAmount: 0 }),
        sale({ vatType: "exempt", evidenceType: "card", supplyAmount: 5_000, vatAmount: 0 }),
        purchase({ vatType: "exempt", evidenceType: "invoice", vatDeductible: null, supplyAmount: 70_000, vatAmount: 0 }),
      ],
      sel(),
    );
    expect(r.rows.get(88)).toEqual(amt(405_000, 0));
    expect(r.rows.get(89)).toEqual(amt(400_000, 0));
    expect(r.rows.get(90)).toEqual(amt(70_000, 0));
    for (const no of [1, 3, 4, 5, 6, 9, 10, 12, 15, 16, 17, 18]) expect(r.rows.get(no)).toEqual(amt(0, 0));
    expect(r.sales.total.count).toBe(0);
    expect(r.purchases.total.count).toBe(0);
  });

  it("taxDiff flags rows whose tax is not 10%", () => {
    const off = buildVatReturn([sale({ evidenceType: "card", supplyAmount: 99_999, vatAmount: 10_090 })], sel());
    expect(off.taxDiff.get(3)).toBe(91);
    expect(off.taxDiff.size).toBe(1);
    const ok = buildVatReturn([sale({ evidenceType: "card", supplyAmount: 99_999, vatAmount: 9_999 })], sel());
    expect(ok.taxDiff.has(3)).toBe(false);
    expect(ok.taxDiff.size).toBe(0);
  });

  it("invoice summary splits 전자/전자 외 and 사업자/주민 and lists 전자 외 by partner", () => {
    const A = "1111111111";
    const B = "2222222222";
    const r = buildVatReturn(
      [
        sale({ businessNumber: A, partnerKey: A, partnerName: "가", supplyAmount: 100_000, vatAmount: 10_000 }),
        sale({ businessNumber: A, partnerKey: A, partnerName: "가", supplyAmount: 200_000, vatAmount: 20_000 }),
        sale({ paperTaxInvoice: true, businessNumber: B, partnerKey: B, partnerName: "나", supplyAmount: 300_000, vatAmount: 30_000 }),
        sale({ paperTaxInvoice: true, businessNumber: B, partnerKey: B, partnerName: "나", supplyAmount: -50_000, vatAmount: -5_000 }),
        sale({ paperTaxInvoice: true, businessNumber: null, partnerKey: "p:9", partnerName: "개인", supplyAmount: 40_000, vatAmount: 4_000 }),
      ],
      sel(),
    );
    const s = r.sales;
    expect(s.electronic.bn).toEqual({ partners: 1, count: 2, supplyAmount: 300_000, vatAmount: 30_000 });
    expect(s.electronic.rrn).toEqual({ partners: 0, count: 0, supplyAmount: 0, vatAmount: 0 });
    expect(s.electronic.subtotal).toEqual(s.electronic.bn);
    expect(s.other.bn).toEqual({ partners: 1, count: 2, supplyAmount: 250_000, vatAmount: 25_000 });
    expect(s.other.rrn).toEqual({ partners: 1, count: 1, supplyAmount: 40_000, vatAmount: 4_000 });
    expect(s.other.subtotal).toEqual({ partners: 2, count: 3, supplyAmount: 290_000, vatAmount: 29_000 });
    expect(s.otherByPartner).toEqual([{ businessNumber: B, name: "나", count: 2, supplyAmount: 250_000, vatAmount: 25_000 }]);
    expect(s.total).toEqual({ partners: 3, count: 5, supplyAmount: 590_000, vatAmount: 59_000 });
    expect(r.purchases.total.count).toBe(0);
  });

  it("counts 매입 세금계산서 in the 합계표 whether deductible or not, and not 계산서", () => {
    const r = buildVatReturn(
      [
        purchase({ supplyAmount: 100_000, vatAmount: 10_000 }),
        purchase({ vatDeductible: false, supplyAmount: 20_000, vatAmount: 2_000 }),
        purchase({ evidenceType: "invoice", vatType: "exempt", supplyAmount: 5_000, vatAmount: 0 }),
      ],
      sel(),
    );
    expect(r.purchases.total).toEqual({ partners: 1, count: 2, supplyAmount: 120_000, vatAmount: 12_000 });
    expect(r.sales.total.count).toBe(0);
  });

  it("card statement ⑤/⑦/⑧ and ⑧ detail", () => {
    const shop = "3333333333";
    const card = "1234-****-****-5678";
    const r = buildVatReturn(
      [
        purchase({ evidenceType: "cash_receipt", supplyAmount: 10_000, vatAmount: 1_000 }),
        purchase({ evidenceType: "card", supplyAmount: 20_000, vatAmount: 2_000 }),
        purchase({ evidenceType: "card", fixedAsset: true, supplyAmount: 30_000, vatAmount: 3_000 }),
        purchase({ evidenceType: "card", unregisteredCard: true, cardNo: card, businessNumber: shop, partnerKey: shop, supplyAmount: 40_000, vatAmount: 4_000 }),
        purchase({ evidenceType: "card", unregisteredCard: true, cardNo: card, businessNumber: shop, partnerKey: shop, supplyAmount: 50_000, vatAmount: 5_000 }),
        purchase({ evidenceType: "card", unregisteredCard: true, cardNo: null, businessNumber: shop, partnerKey: shop, supplyAmount: 60_000, vatAmount: 6_000 }),
        purchase({ evidenceType: "card", unregisteredCard: true, vatDeductible: false, supplyAmount: 70_000, vatAmount: 7_000 }),
      ],
      sel(),
    );
    const c = r.card;
    expect(c.cashReceipt).toEqual({ count: 1, supplyAmount: 10_000, vatAmount: 1_000 });
    expect(c.businessCard).toEqual({ count: 2, supplyAmount: 50_000, vatAmount: 5_000 });
    expect(c.otherCard).toEqual({ count: 3, supplyAmount: 150_000, vatAmount: 15_000 });
    expect(c.otherDetail).toHaveLength(2);
    expect(c.otherDetail).toContainEqual({ cardNo: card, businessNumber: shop, count: 2, supplyAmount: 90_000, vatAmount: 9_000 });
    expect(c.otherDetail).toContainEqual({ cardNo: null, businessNumber: shop, count: 1, supplyAmount: 60_000, vatAmount: 6_000 });
    const r44 = r.rows.get(44)!;
    const r45 = r.rows.get(45)!;
    expect(c.total).toEqual({ count: 6, supplyAmount: r44.amount + r45.amount, vatAmount: r44.tax + r45.tax });
  });

  it("fills exactly the rows marked computed in rows.ts", () => {
    const r = buildVatReturn([], sel());
    const marked = [...PAGE1_GROUPS, ...PAGE4_GROUPS].flatMap((g) => g.rows).filter((x) => x.computed).map((x) => x.no);
    expect([...r.rows.keys()]).toEqual([...COMPUTED_VAT_ROWS]);
    expect(marked).toEqual([...COMPUTED_VAT_ROWS]);
    const all = [...PAGE1_GROUPS, ...PAGE4_GROUPS].flatMap((g) => g.rows).map((x) => x.no);
    expect(all).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
  });

  it("an empty period has zero rows and no (57)", () => {
    const r = buildVatReturn([], sel({ kind: "final" }));
    expect(r.entryCount).toBe(0);
    expect(r.payable).toBe(0);
    expect(r.rows.get(30)).toEqual(amt(0, 0));
    expect(r.sales.otherByPartner).toEqual([]);
    expect(r.card.otherDetail).toEqual([]);
  });
});
