import { describe, expect, it } from "vitest";
import { findHeader, isBlankRow, parseDate, parseWon } from "./sheet";

describe("findHeader", () => {
  const req = { a: ["승인번호"], b: ["상호"] };
  it("finds the header below title rows and lists every matching column", () => {
    const grid = [["제목"], [null], ["합계"], [null], ["승인 번호", "상호", "상호"], ["x"]];
    const r = findHeader(grid, req, {});
    expect(r).toEqual({ ok: true, value: { row: 4, cols: { a: [0], b: [1, 2] } } });
  });
  it("names the missing required fields", () => {
    const r = findHeader([["상호"]], req, {});
    expect(r).toEqual({
      ok: false,
      error:
        "필요한 열(승인번호, 상호)을 찾을 수 없습니다. 홈택스에서 내려받은 파일인지 확인하세요.",
    });
  });
});

describe("parseWon", () => {
  it("parses numbers and formatted strings", () => {
    expect(parseWon(1234000)).toBe(1234000);
    expect(parseWon("1,234,000")).toBe(1234000);
    expect(parseWon("-110,000원")).toBe(-110000);
    expect(parseWon(1.5)).toBeNull();
    expect(parseWon("abc")).toBeNull();
    expect(parseWon(null)).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts the supported formats", () => {
    expect(parseDate("20261015")).toBe("2026-10-15");
    expect(parseDate("2026-10-15 13:05")).toBe("2026-10-15");
    expect(parseDate("2026.10.15")).toBe("2026-10-15");
    expect(parseDate("2026/10/15")).toBe("2026-10-15");
    expect(parseDate(new Date(Date.UTC(2026, 9, 15)))).toBe("2026-10-15");
  });
  it("uses Asia/Seoul for Date values", () => {
    expect(parseDate(new Date("2026-10-14T16:00:00Z"))).toBe("2026-10-15");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("hello")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("isBlankRow", () => {
  it("detects blanks", () => {
    expect(isBlankRow([null, " ", ""])).toBe(true);
    expect(isBlankRow([null, 0])).toBe(false);
  });
});
