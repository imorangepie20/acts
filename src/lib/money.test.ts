import { expect, it } from "vitest";
import { formatWon, parseWon } from "./money";

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
