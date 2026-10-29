import { describe, expect, it } from "vitest";
import { MAX_WON } from "@/lib/money";
import {
  buildSimpleVoucher,
  defaultVat,
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
    expect(err({ ...purchase, vatAmount: -1 })).toBe("부가세가 올바르지 않습니다.");
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
  it("5: vat above supply", () => {
    expect(err({ ...purchase, supplyAmount: 100, vatAmount: 101 })).toBe(
      "부가세가 공급가액보다 클 수 없습니다.",
    );
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
      { ...sale, vatType: "exempt", vatAmount: 0 },
      transfer,
    ];
    for (const c of cases) {
      expect(toSimpleInput(built(c), vat)).toEqual(c);
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
