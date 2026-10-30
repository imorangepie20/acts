import { expect, it } from "vitest";
import { formatKoreanShort, formatWon, parseSignedWon, parseWon } from "./money";

it("parses won input", () => {
  expect(parseWon("1,234,000")).toBe(1234000);
  expect(parseWon(" 1234000 ")).toBe(1234000);
  expect(parseWon("1,234,000원")).toBe(1234000);
  expect(parseWon("0")).toBe(0);
});
it("rejects invalid input", () => {
  for (const s of ["12.5", "-3", "", "abc", "1000000000000"]) expect(parseWon(s)).toBeNull();
});
it("formats won", () => {
  expect(formatWon(1234000)).toBe("1,234,000");
});
it("parses signed won input", () => {
  expect(parseSignedWon("-200,000")).toBe(-200000);
  expect(parseSignedWon(" - 1,234원")).toBe(-1234);
  expect(parseSignedWon("1,000")).toBe(1000);
  expect(parseSignedWon("-0")).toBe(0);
  for (const s of ["", "-", "--1", "1-", "12.5", "-1000000000000", "abc"]) expect(parseSignedWon(s)).toBeNull();
});
it("formats negative won", () => {
  expect(formatWon(-200000)).toBe("-200,000");
});
it("formats short Korean amounts", () => {
  expect(formatKoreanShort(1_140_000_000)).toBe("11억 4,000만");
  expect(formatKoreanShort(62_000_000)).toBe("6,200만");
  expect(formatKoreanShort(300_000_000)).toBe("3억");
  expect(formatKoreanShort(9_999)).toBe("9,999원");
  expect(formatKoreanShort(-62_000_000)).toBe("-6,200만");
  expect(formatKoreanShort(0)).toBe("0원");
  expect(formatKoreanShort(100_000_000)).toBe("1억");
  expect(formatKoreanShort(100_009_999)).toBe("1억");
  expect(formatKoreanShort(10_000)).toBe("1만");
  expect(formatKoreanShort(-1_140_000_000)).toBe("-11억 4,000만");
  expect(formatKoreanShort(1_234_567_890_123)).toBe("12,345억 6,789만");
});
