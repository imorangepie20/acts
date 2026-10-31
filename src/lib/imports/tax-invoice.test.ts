import { describe, expect, it } from "vitest";
import { parseTaxInvoices } from "./tax-invoice";
import type { Cell } from "./types";

const HEAD: Cell[] = [
  "작성일자", "승인번호", "공급자사업자등록번호", "종사업장번호", "상호", "대표자명",
  "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명",
  "공급가액", "세액", "전자세금계산서종류", "품목명",
];
const titles: Cell[][] = [["세금계산서 목록"], [null], ["기간"], [null]];
const data = (over: Partial<Record<number, Cell>> = {}): Cell[] => {
  const row: Cell[] = [
    "2026-10-15", "20261015-1000-ab", "111-11-11111", null, "공급사", "김공급",
    "222-22-22222", null, "구매사", "이구매", "1,000,000", 100000, "세금계산서", "철판",
  ];
  for (const [i, v] of Object.entries(over)) row[Number(i)] = v as Cell;
  return row;
};
const rowsOf = (r: ReturnType<typeof parseTaxInvoices>) => {
  if (!r.ok) throw new Error(r.error);
  return r.value.rows;
};

describe("parseTaxInvoices", () => {
  it("reads side-prefixed headers (공급자 등록번호 / 공급자 상호 / 공급자 성명)", () => {
    const head: Cell[] = [
      "승인번호", "작성일자", "발급일자", "전송일자",
      "공급자 등록번호", "공급자 종사업장번호", "공급자 상호", "공급자 성명",
      "공급받는자 등록번호", "공급받는자 종사업장번호", "공급받는자 상호", "공급받는자 성명",
      "공급가액", "세액", "합계금액", "비고", "영수/청구", "연관공급가액", "연관세액", "미수금",
      "공급자 이메일", "공급받는자 이메일",
    ];
    const row: Cell[] = [
      "20261015-41000012-7c3a9b2e", "2026-10-15", "2026-10-15", "2026-10-16",
      "111-11-11111", null, "(주)공급사", "김공급",
      "222-22-22222", null, "구매사", "이구매",
      "1,000,000", "100,000", "1,100,000", null, "청구", null, null, null,
      "a@x.kr", "b@y.kr",
    ];
    const [p] = rowsOf(parseTaxInvoices([head, row], "purchase"));
    expect(p).toMatchObject({
      counterpartyName: "(주)공급사",
      counterpartyBusinessNumber: "1111111111",
      representative: "김공급",
      ownBusinessNumber: "2222222222",
      description: "(주)공급사",
      supplyAmount: 1000000,
      vatAmount: 100000,
      problem: null,
    });
    const [s] = rowsOf(parseTaxInvoices([head, row], "sale"));
    expect(s).toMatchObject({
      counterpartyName: "구매사",
      counterpartyBusinessNumber: "2222222222",
      representative: "이구매",
      ownBusinessNumber: "1111111111",
    });
  });

  it("names 상호 when no name column exists", () => {
    const r = parseTaxInvoices(
      [["작성일자", "승인번호", "공급자사업자등록번호", "공급받는자사업자등록번호", "공급가액"]],
      "purchase",
    );
    expect(r).toEqual({
      ok: false,
      error: "필요한 열(상호)을 찾을 수 없습니다. 홈택스에서 내려받은 파일인지 확인하세요.",
    });
  });

  it("reads the 홈택스 목록조회 layout (info, 총합계 and title rows above a 35-column header)", () => {
    const head: Cell[] = [
      "작성일자", "승인번호", "발급일자", "전송일자",
      "공급자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소",
      "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소",
      "합계금액", "공급가액", "세액", "전자세금계산서분류", "전자세금계산서종류", "발급유형", "비고",
      "영수/청구 구분", "공급자 이메일", "공급받는자 이메일1", "공급받는자 이메일2",
      "품목일자", "품목명", "품목규격", "품목수량", "품목단가", "품목공급가액", "품목세액", "품목비고",
      "공급받는자구분", "위수탁여부",
    ];
    const row: Cell[] = [
      "2026-10-15", "20261015-41000012-7c3a9b2e", "2026-10-15", "2026-10-16",
      "111-11-11111", null, "(주)공급사", "김공급", "서울",
      "222-22-22222", null, "구매사", "이구매", "부산",
      "1,100,000", "1,000,000", "100,000", "세금계산서", "일반", "전자발급", null,
      "청구", "a@x.kr", "b@y.kr", null,
      "2026-10-15", "철판", null, "1", "1,000,000", "1,000,000", "100,000", null,
      "사업자", "아님",
    ];
    const grid: Cell[][] = [
      ["사업자등록번호", "222-22-22222", "상호", "구매사"],
      [null],
      ["총 합계금액", "1,100,000", "총 공급가액", "1,000,000", "총 세액", "100,000"],
      [null],
      ["매입 전자세금계산서 목록"],
      head,
      row,
    ];
    const [r] = rowsOf(parseTaxInvoices(grid, "purchase"));
    expect(r).toMatchObject({
      key: "nts:20261015410000127c3a9b2e",
      date: "2026-10-15",
      counterpartyName: "(주)공급사",
      counterpartyBusinessNumber: "1111111111",
      representative: "김공급",
      ownBusinessNumber: "2222222222",
      description: "철판",
      supplyAmount: 1000000,
      vatAmount: 100000,
      vatType: "taxable",
      problem: null,
    });
  });

  it("finds the header below title rows and maps purchase to the supplier", () => {
    const [row] = rowsOf(parseTaxInvoices([...titles, HEAD, data()], "purchase"));
    expect(row).toMatchObject({
      key: "nts:202610151000ab",
      date: "2026-10-15",
      counterpartyName: "공급사",
      counterpartyBusinessNumber: "1111111111",
      representative: "김공급",
      ownBusinessNumber: "2222222222",
      description: "철판",
      evidenceType: "tax_invoice",
      vatType: "taxable",
      supplyAmount: 1000000,
      vatAmount: 100000,
      deductible: true,
      problem: null,
    });
  });

  it("maps sale to the buyer and our side to the supplier", () => {
    const [row] = rowsOf(parseTaxInvoices([HEAD, data()], "sale"));
    expect(row).toMatchObject({
      counterpartyName: "구매사",
      counterpartyBusinessNumber: "2222222222",
      representative: "이구매",
      ownBusinessNumber: "1111111111",
    });
  });

  it("uses the counterparty name when the item is blank", () => {
    const [row] = rowsOf(parseTaxInvoices([HEAD, data({ 13: null })], "purchase"));
    expect(row.description).toBe("공급사");
  });

  it("skips blank and 합계 rows", () => {
    const total: Cell[] = ["합계", ...Array(9).fill(null), 1000000, 100000, null, null];
    const rows = rowsOf(parseTaxInvoices([HEAD, data(), [], total], "purchase"));
    expect(rows).toHaveLength(1);
  });

  it("fails naming a missing required column", () => {
    const head = HEAD.map((c) => (c === "승인번호" ? "번호" : c));
    const r = parseTaxInvoices([head, data()], "purchase");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("승인번호");
      expect(r.error).toContain("홈택스에서 내려받은 파일인지 확인하세요.");
    }
  });

  it("flags negative rows and bad dates", () => {
    const [neg, bad, over] = rowsOf(
      parseTaxInvoices(
        [HEAD, data({ 10: -1000000, 11: -100000 }), data({ 0: "2026-02-30", 1: "x2" }), data({ 1: "x3", 11: 2000000 })],
        "purchase",
      ),
    );
    expect(neg.problem).toBe("음수 금액(수정·취소분)은 전표 입력 화면에서 직접 입력하세요.");
    expect(bad.problem).toBe("날짜를 읽을 수 없습니다.");
    expect(bad.date).toBeNull();
    expect(over.problem).toBe("세액이 공급가액보다 큽니다.");
  });

  it("treats a file without 세액 as an exempt 전자계산서", () => {
    const keep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13];
    const grid = [HEAD, data()].map((r) => keep.map((i) => r[i]));
    const [row] = rowsOf(parseTaxInvoices(grid, "purchase"));
    expect(row).toMatchObject({ evidenceType: "invoice", vatType: "exempt", vatAmount: 0 });
  });

  it("marks 영세율 kinds zero_rated", () => {
    const [row] = rowsOf(
      parseTaxInvoices([HEAD, data({ 12: "영세율세금계산서", 11: 0 })], "purchase"),
    );
    expect(row.vatType).toBe("zero_rated");
  });

  it("rejects more than 1,000 data rows", () => {
    const many = Array.from({ length: 1001 }, (_, i) => data({ 1: `n${i}` }));
    const r = parseTaxInvoices([HEAD, ...many], "purchase");
    expect(r).toEqual({ ok: false, error: "한 번에 1,000건까지 불러올 수 있습니다." });
    expect(parseTaxInvoices([HEAD, ...many.slice(0, 1000)], "purchase").ok).toBe(true);
  });
});
