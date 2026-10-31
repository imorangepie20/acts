import { describe, expect, it } from "vitest";
import { parseCardPurchases } from "./card";
import type { Cell } from "./types";

const rowsOf = (r: ReturnType<typeof parseCardPurchases>) => {
  if (!r.ok) throw new Error(r.error);
  return r.value.rows;
};

describe("parseCardPurchases", () => {
  it("total-only file: supply = total, VAT 0, not deductible", () => {
    const grid: Cell[][] = [
      ["카드 내역"],
      ["승인일자", "가맹점명", "이용금액", "카드번호", "승인번호"],
      ["2026-10-15", "스타벅스", "11,000", "1234-5678-9012-3456", "A1"],
    ];
    const [row] = rowsOf(parseCardPurchases(grid));
    expect(row).toMatchObject({
      date: "2026-10-15",
      counterpartyName: "스타벅스",
      description: "스타벅스",
      evidenceType: "card",
      vatType: "taxable",
      supplyAmount: 11000,
      vatAmount: 0,
      deductible: false,
      ownBusinessNumber: null,
      key: "card:3456:2026-10-15:A1",
      problem: null,
    });
    expect(row.meta.cardNo).toBe("****3456");
    expect(row.meta.approvalNo).toBe("A1");
  });

  it("uses supply and vat, honoring 불공제", () => {
    const grid: Cell[][] = [
      ["거래일시", "가맹점", "합계", "공급가액", "부가세", "공제여부", "사업자번호", "과세유형"],
      ["2026-10-15 10:00", "가", 11000, 10000, 1000, "공제", "123-45-67890", "일반"],
      ["2026-10-16 10:00", "나", 11000, 10000, 1000, "불공제", null, "면세"],
    ];
    const [a, b] = rowsOf(parseCardPurchases(grid));
    expect(a).toMatchObject({ supplyAmount: 10000, vatAmount: 1000, deductible: true });
    expect(a.counterpartyBusinessNumber).toBe("1234567890");
    expect(a.meta.merchantBusinessNumber).toBe("1234567890");
    expect(b).toMatchObject({ deductible: false, vatType: "exempt" });
    expect(b.counterpartyBusinessNumber).toBeNull();
  });

  it("blocks 봉사료 and negative totals", () => {
    const grid: Cell[][] = [
      ["승인일자", "가맹점명", "합계", "봉사료"],
      ["2026-10-15", "식당", 11000, 1000],
      ["2026-10-15", "취소", -5000, null],
    ];
    const [a, b] = rowsOf(parseCardPurchases(grid));
    expect(a.problem).toBe("봉사료가 있는 건은 직접 입력하세요.");
    expect(b.problem).toBe("음수 금액(수정·취소분)은 전표 입력 화면에서 직접 입력하세요.");
  });

  it("numbers identical rows without an approval number", () => {
    const grid: Cell[][] = [
      ["승인일자", "가맹점명", "합계"],
      ["2026-10-15", "편의점", 3000],
      ["2026-10-15", "편의점", 3000],
      [null, null, null],
    ];
    const rows = rowsOf(parseCardPurchases(grid));
    expect(rows.map((r) => r.key)).toEqual([
      "card:2026-10-15:편의점:3000:1",
      "card:2026-10-15:편의점:3000:2",
    ]);
  });

  it("rejects more than 1,000 data rows", () => {
    const many: Cell[][] = Array.from({ length: 1001 }, (_, i) => ["2026-10-15", "가", 1000 + i]);
    const head: Cell[] = ["승인일자", "가맹점명", "합계"];
    expect(parseCardPurchases([head, ...many])).toEqual({
      ok: false,
      error: "한 번에 1,000건까지 불러올 수 있습니다.",
    });
  });
});
