import { describe, expect, it } from "vitest";
import { MAX_WON } from "@/lib/money";
import {
  buildSimpleVoucher,
  defaultVat,
  ERR_PAPER,
  ERR_SPLIT_AMOUNT,
  ERR_SPLIT_COUNT,
  ERR_SPLIT_NON_DEDUCTIBLE,
  ERR_SPLIT_SUM,
  ERR_TAX_INVOICE_EXEMPT,
  ERR_UNREGISTERED_CARD,
  splitVatFromTotal,
  toSimpleInput,
  type SimpleInput,
  type TradeInput,
  type TransferInput,
} from "./simple";
import type { VoucherInput } from "./types";

const vat = { inputAccountId: 9135, outputAccountId: 9255 };
const MAIN = 9811;
const COUNTER = 9253;

const purchase: TradeInput = {
  type: "purchase",
  date: "2026-10-30",
  description: "사무용품",
  mainAccountId: MAIN,
  counterAccountId: COUNTER,
  partnerId: 5,
  siteId: 2,
  departmentId: 3,
  evidenceType: "card",
  vatType: "taxable",
  vatDeductible: true,
  supplyAmount: 9091,
  vatAmount: 909,
};
const sale: TradeInput = {
  ...purchase,
  type: "sale",
  description: "공사 매출",
  evidenceType: "tax_invoice",
  vatDeductible: false,
  supplyAmount: 100000,
  vatAmount: 10000,
};
const transfer: TransferInput = {
  type: "transfer",
  date: "2026-10-30",
  description: "예금 이체",
  debitAccountId: 1111,
  creditAccountId: 2222,
  amount: 50000,
  partnerId: null,
  siteId: 2,
  departmentId: null,
  evidenceType: "none",
};

function built(x: SimpleInput) {
  const r = buildSimpleVoucher(x, vat);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function err(x: SimpleInput) {
  const r = buildSimpleVoucher(x, vat);
  return r.ok ? null : r.error;
}
const amounts = (v: VoucherInput) => v.lines.map((l) => [l.side, l.accountId, l.amount]);

describe("vat helpers", () => {
  it("splits a total", () => {
    expect(splitVatFromTotal(11000)).toEqual({ supplyAmount: 10000, vatAmount: 1000 });
    expect(splitVatFromTotal(10000)).toEqual({ supplyAmount: 9091, vatAmount: 909 });
    expect(defaultVat(10001)).toBe(1000);
  });
});

describe("buildSimpleVoucher", () => {
  it("deductible card purchase has 3 balanced lines", () => {
    const v = built(purchase);
    expect(amounts(v)).toEqual([
      ["debit", MAIN, 9091],
      ["debit", 9135, 909],
      ["credit", COUNTER, 10000],
    ]);
    expect(v.entryType).toBe("purchase");
    expect(v.vatDeductible).toBe(true);
    expect(
      v.lines.every(
        (l) => l.siteId === 2 && l.partnerId === 5 && l.departmentId === 3 && l.description === "사무용품",
      ),
    ).toBe(true);
  });
  it("non-deductible purchase folds vat into the expense", () => {
    expect(amounts(built({ ...purchase, vatDeductible: false }))).toEqual([
      ["debit", MAIN, 10000],
      ["credit", COUNTER, 10000],
    ]);
  });
  it("purchase with zero vat has no input-vat line", () => {
    expect(amounts(built({ ...purchase, supplyAmount: 10000, vatAmount: 0 }))).toEqual([
      ["debit", MAIN, 10000],
      ["credit", COUNTER, 10000],
    ]);
  });
  it("taxable sale", () => {
    const v = built(sale);
    expect(amounts(v)).toEqual([
      ["debit", COUNTER, 110000],
      ["credit", MAIN, 100000],
      ["credit", 9255, 10000],
    ]);
    expect(v.vatDeductible).toBeNull();
  });
  it("transfer", () => {
    const v = built(transfer);
    expect(amounts(v)).toEqual([
      ["debit", 1111, 50000],
      ["credit", 2222, 50000],
    ]);
    expect([v.vatType, v.vatDeductible, v.supplyAmount, v.vatAmount]).toEqual([null, null, null, null]);
  });
  it("sale with no evidence may carry vat", () => {
    expect(err({ ...sale, evidenceType: "none" })).toBeNull();
  });
});

describe("VAT rules", () => {
  it("1: amounts", () => {
    expect(err({ ...purchase, supplyAmount: 0 })).toBe("금액을 입력하세요.");
    expect(err({ ...purchase, supplyAmount: MAX_WON + 1 })).toBe("금액을 입력하세요.");
    expect(err({ ...purchase, supplyAmount: 10.5 })).toBe("금액을 입력하세요.");
    expect(err({ ...transfer, amount: 0 })).toBe("금액을 입력하세요.");
    expect(err({ ...purchase, vatAmount: -1 })).toBe("공급가액과 부가세의 부호가 같아야 합니다.");
    expect(err({ ...purchase, vatAmount: 1.5 })).toBe("부가세가 올바르지 않습니다.");
  });
  it("2: invoice only for exempt", () => {
    expect(err({ ...purchase, evidenceType: "invoice" })).toBe("계산서는 면세 거래에만 사용할 수 있습니다.");
    expect(err({ ...purchase, evidenceType: "invoice", vatType: "exempt", vatAmount: 0 })).toBeNull();
  });
  it("3: zero-rated/exempt need zero vat", () => {
    expect(err({ ...purchase, vatType: "exempt" })).toBe("영세·면세 거래는 부가세가 0원이어야 합니다.");
    expect(err({ ...sale, vatType: "zero_rated" })).toBe("영세·면세 거래는 부가세가 0원이어야 합니다.");
  });
  it("4: no vat on simple receipt / none purchases", () => {
    const msg = "간이영수증·증빙 없음은 부가세를 공제받을 수 없습니다. 합계를 공급가액으로 입력하세요.";
    expect(err({ ...purchase, evidenceType: "simple_receipt" })).toBe(msg);
    expect(err({ ...purchase, evidenceType: "none" })).toBe(msg);
  });
  it("6: a tax invoice cannot be exempt", () => {
    expect(err({ ...purchase, evidenceType: "tax_invoice", vatType: "exempt", vatAmount: 0 })).toBe(ERR_TAX_INVOICE_EXEMPT);
    expect(err({ ...sale, vatType: "exempt", vatAmount: 0 })).toBe(ERR_TAX_INVOICE_EXEMPT);
    expect(err({ ...sale, vatType: "zero_rated", vatAmount: 0 })).toBeNull();
  });
  it("5: vat above supply", () => {
    expect(err({ ...purchase, supplyAmount: 100, vatAmount: 101 })).toBe(
      "부가세가 공급가액보다 클 수 없습니다.",
    );
  });
});

describe("수정·취소분 (negative supply)", () => {
  it("reverses a purchase: same line order, sides swapped, positive line amounts", () => {
    const v = built({ ...purchase, supplyAmount: -9091, vatAmount: -909 });
    expect(amounts(v)).toEqual([
      ["credit", MAIN, 9091],
      ["credit", vat.inputAccountId, 909],
      ["debit", COUNTER, 10000],
    ]);
    expect(v).toMatchObject({ entryType: "purchase", supplyAmount: -9091, vatAmount: -909 });
  });
  it("reverses a sale", () => {
    expect(amounts(built({ ...sale, supplyAmount: -100000, vatAmount: -10000 }))).toEqual([
      ["credit", COUNTER, 110000],
      ["debit", MAIN, 100000],
      ["debit", vat.outputAccountId, 10000],
    ]);
  });
  it("applies the size and VAT rules to the magnitudes", () => {
    expect(err({ ...purchase, supplyAmount: -9091, vatAmount: 909 })).toBe("공급가액과 부가세의 부호가 같아야 합니다.");
    expect(err({ ...purchase, supplyAmount: 0, vatAmount: -1 })).toBe("공급가액과 부가세의 부호가 같아야 합니다.");
    expect(err({ ...purchase, supplyAmount: -100, vatAmount: -101 })).toBe("부가세가 공급가액보다 클 수 없습니다.");
    expect(err({ ...sale, evidenceType: "invoice", vatType: "exempt", supplyAmount: -100, vatAmount: -10 })).toBe(
      "영세·면세 거래는 부가세가 0원이어야 합니다.",
    );
    expect(err({ ...purchase, supplyAmount: -1_000_000_000_000_000, vatAmount: 0 })).toBe("금액을 입력하세요.");
  });
});

describe("toSimpleInput", () => {
  it("round-trips every case", () => {
    const cases: SimpleInput[] = [
      purchase,
      { ...purchase, vatDeductible: false },
      { ...purchase, supplyAmount: 10000, vatAmount: 0 },
      { ...purchase, supplyAmount: 10000, vatAmount: 0, vatDeductible: false },
      sale,
      { ...sale, evidenceType: "invoice", vatType: "exempt", vatAmount: 0 },
      { ...purchase, supplyAmount: -9091, vatAmount: -909 },
      { ...purchase, supplyAmount: -9091, vatAmount: -909, vatDeductible: false },
      { ...sale, supplyAmount: -100000, vatAmount: -10000 },
      { ...sale, evidenceType: "invoice", vatType: "exempt", supplyAmount: -100000, vatAmount: 0 },
      transfer,
    ];
    for (const c of cases) {
      // A trade comes back with both flags spelled out (absent = false).
      const back = c.type === "transfer" ? c : { paperTaxInvoice: false, unregisteredCard: false, ...c };
      expect(toSimpleInput(built(c), vat)).toEqual(back);
    }
  });
  it("stays structural so VAT rule messages surface from the builder", () => {
    const v = { ...built(purchase), evidenceType: "simple_receipt" as const };
    const s = toSimpleInput(v, vat);
    expect(s).not.toBeNull();
    expect(err(s!)).toBe(
      "간이영수증·증빙 없음은 부가세를 공제받을 수 없습니다. 합계를 공급가액으로 입력하세요.",
    );
  });
  it("returns null for general vouchers", () => {
    expect(toSimpleInput({ ...built(transfer), entryType: "general" }, vat)).toBeNull();
  });
  it("returns null for shapes it cannot invert", () => {
    const v = built(purchase);
    expect(toSimpleInput({ ...v, lines: v.lines.slice(0, 2) }, vat)).toBeNull();
    expect(toSimpleInput({ ...v, lines: v.lines.map((l) => ({ ...l, side: "debit" as const })) }, vat)).toBeNull();
    const tampered = { ...v, lines: v.lines.map((l, i) => (i === 1 ? { ...l, accountId: 1 } : l)) };
    expect(toSimpleInput(tampered, vat)).toBeNull();
    const t = built(transfer);
    expect(toSimpleInput({ ...t, lines: [t.lines[0]] }, vat)).toBeNull();
  });
  it("returns null for a vat line on a non-vat account", () => {
    const s = built(sale);
    const lines = s.lines.map((l, i) => (i === 2 ? { ...l, accountId: 7777 } : l));
    expect(toSimpleInput({ ...s, lines }, vat)).toBeNull();
  });
});

describe("계정 나누기 (splits)", () => {
  const OTHER = 9815;
  // 세금계산서 한 장: 월세 3,000,000 + 관리비 400,000, 부가세 340,000
  const rent: TradeInput = {
    ...purchase,
    evidenceType: "tax_invoice",
    supplyAmount: 3_400_000,
    vatAmount: 340_000,
    splits: [
      { accountId: MAIN, amount: 3_000_000 },
      { accountId: OTHER, amount: 400_000 },
    ],
  };

  it("posts one main line per split, then the VAT and the payment", () => {
    const v = built(rent);
    expect(amounts(v)).toEqual([
      ["debit", MAIN, 3_000_000],
      ["debit", OTHER, 400_000],
      ["debit", vat.inputAccountId, 340_000],
      ["credit", COUNTER, 3_740_000],
    ]);
    expect(v.supplyAmount).toBe(3_400_000);
    expect(v.vatAmount).toBe(340_000);
  });

  it("splits a sale's revenue lines the same way", () => {
    const v = built({ ...rent, type: "sale", vatDeductible: false });
    expect(amounts(v)).toEqual([
      ["debit", COUNTER, 3_740_000],
      ["credit", MAIN, 3_000_000],
      ["credit", OTHER, 400_000],
      ["credit", vat.outputAccountId, 340_000],
    ]);
  });

  it("swaps every side for a 수정·취소분", () => {
    const v = built({ ...rent, supplyAmount: -3_400_000, vatAmount: -340_000 });
    expect(amounts(v)).toEqual([
      ["credit", MAIN, 3_000_000],
      ["credit", OTHER, 400_000],
      ["credit", vat.inputAccountId, 340_000],
      ["debit", COUNTER, 3_740_000],
    ]);
  });

  it("allows a split without VAT even when not deducted", () => {
    const v = built({ ...rent, evidenceType: "invoice", vatType: "exempt", vatAmount: 0, vatDeductible: false });
    expect(amounts(v)).toEqual([
      ["debit", MAIN, 3_000_000],
      ["debit", OTHER, 400_000],
      ["credit", COUNTER, 3_400_000],
    ]);
  });

  it("rejects splits that do not add up to the supply amount", () => {
    expect(err({ ...rent, supplyAmount: 3_500_000, vatAmount: 350_000 })).toBe(ERR_SPLIT_SUM);
    expect(err({ ...rent, splits: [{ accountId: MAIN, amount: 3_400_000 }, { accountId: OTHER, amount: 0 }] })).toBe(
      ERR_SPLIT_AMOUNT,
    );
  });

  it("rejects fewer than two splits or a first split that is not the main account", () => {
    expect(err({ ...rent, splits: [{ accountId: MAIN, amount: 3_400_000 }] })).toBe(ERR_SPLIT_COUNT);
    expect(
      err({
        ...rent,
        splits: [
          { accountId: OTHER, amount: 3_000_000 },
          { accountId: MAIN, amount: 400_000 },
        ],
      }),
    ).toBe(ERR_SPLIT_COUNT);
  });

  it("rejects a split of a non-deductible purchase with VAT", () => {
    expect(err({ ...rent, vatDeductible: false })).toBe(ERR_SPLIT_NON_DEDUCTIBLE);
  });

  it("round-trips through toSimpleInput", () => {
    const cases: TradeInput[] = [
      rent,
      { ...rent, supplyAmount: -3_400_000, vatAmount: -340_000 },
      { ...rent, type: "sale", vatDeductible: false },
      { ...rent, evidenceType: "invoice", vatType: "exempt", vatAmount: 0, vatDeductible: false },
    ];
    for (const c of cases) {
      expect(toSimpleInput(built(c), vat)).toEqual({ paperTaxInvoice: false, unregisteredCard: false, ...c });
    }
  });

  it("leaves a single-line trade without splits", () => {
    expect(toSimpleInput(built(purchase), vat)).not.toHaveProperty("splits");
  });
});

describe("종이 세금계산서 and 홈택스 미등록 카드", () => {
  it("carries 종이 세금계산서 and 미등록 카드 to the header and back", () => {
    const paper = built({ ...purchase, evidenceType: "tax_invoice", paperTaxInvoice: true });
    expect(paper.paperTaxInvoice).toBe(true);
    expect(paper.unregisteredCard).toBe(false);
    expect((toSimpleInput(paper, vat) as TradeInput).paperTaxInvoice).toBe(true);

    const card = built({ ...purchase, evidenceType: "card", unregisteredCard: true });
    expect(card.unregisteredCard).toBe(true);
    expect(card.paperTaxInvoice).toBe(false);
    expect((toSimpleInput(card, vat) as TradeInput).unregisteredCard).toBe(true);
  });

  it("rejects 종이 세금계산서 on a non-tax-invoice evidence", () => {
    expect(err({ ...purchase, evidenceType: "card", paperTaxInvoice: true })).toBe(ERR_PAPER);
  });

  it("rejects 미등록 카드 on a sale or a non-card evidence", () => {
    expect(err({ ...sale, evidenceType: "card", unregisteredCard: true })).toBe(ERR_UNREGISTERED_CARD);
    expect(err({ ...purchase, evidenceType: "cash_receipt", unregisteredCard: true })).toBe(ERR_UNREGISTERED_CARD);
  });

  it("omitting the flags builds false", () => {
    const v = built(purchase);
    expect(v.paperTaxInvoice).toBe(false);
    expect(v.unregisteredCard).toBe(false);
    const t = built(transfer);
    expect(t.paperTaxInvoice).toBe(false);
    expect(t.unregisteredCard).toBe(false);
  });
});
