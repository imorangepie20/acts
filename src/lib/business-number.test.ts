import { describe, expect, it } from "vitest";
import {
  formatBusinessNumber,
  isValidBusinessNumber,
  normalizeBusinessNumber,
} from "./business-number";

describe("business number", () => {
  it("validates the checksum", () => {
    expect(isValidBusinessNumber("2208162517")).toBe(true);
    expect(isValidBusinessNumber("2208162518")).toBe(false);
    expect(isValidBusinessNumber("12345")).toBe(false);
    expect(isValidBusinessNumber("22081625170")).toBe(false);
  });
  it("normalizes to digits", () => {
    expect(normalizeBusinessNumber(" 220-81 62517 ")).toBe("2208162517");
  });
  it("formats", () => {
    expect(formatBusinessNumber("2208162517")).toBe("220-81-62517");
    expect(formatBusinessNumber("123")).toBe("123");
  });
});
