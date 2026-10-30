import { expect, it } from "vitest";
import { formatWon, parseSignedWon, parseWon } from "./money";

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
