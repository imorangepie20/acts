import { describe, expect, it } from "vitest";
import { maskAccount, maskRrn, validateRrn } from "./rrn";

function withCheck(first12: string): string {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((a, x, i) => a + x * Number(first12[i]), 0);
  return first12 + String((11 - (sum % 11)) % 10);
}

describe("validateRrn", () => {
  it("accepts a valid check digit, hyphenated or not", () => {
    const d = withCheck("900101123456");
    expect(validateRrn(`${d.slice(0, 6)}-${d.slice(6)}`)).toEqual({ ok: true, digits: d });
    expect(validateRrn(d)).toEqual({ ok: true, digits: d });
  });
  it("rejects a wrong check digit for a pre-2020-10 birth date", () => {
    const d = withCheck("900101123456");
    const bad = d.slice(0, 12) + String((Number(d[12]) + 1) % 10);
    expect(validateRrn(bad).ok).toBe(false);
  });
  it("rejects an invalid date", () => {
    expect(validateRrn(withCheck("901301123456")).ok).toBe(false);
    expect(validateRrn(withCheck("900231123456")).ok).toBe(false);
  });
  it("rejects gender digit 9 and 0", () => {
    expect(validateRrn(withCheck("900101923456")).ok).toBe(false);
    expect(validateRrn(withCheck("900101023456")).ok).toBe(false);
  });
  it("rejects bad format", () => {
    expect(validateRrn("900101-123456").ok).toBe(false);
    expect(validateRrn("90010a-1234568").ok).toBe(false);
  });
  it("skips the check digit for births after 2020-10", () => {
    for (let last = 0; last <= 9; last++) {
      expect(validateRrn(`210315312345${last}`).ok).toBe(true);
    }
  });
  it("still checks the digit for 2020-09 births", () => {
    const d = withCheck("200915312345");
    expect(validateRrn(d).ok).toBe(true);
    expect(validateRrn(d.slice(0, 12) + String((Number(d[12]) + 1) % 10)).ok).toBe(false);
  });
});

describe("masks", () => {
  it("maskRrn", () => expect(maskRrn("9001011234568")).toBe("900101-1******"));
  it("maskAccount", () => expect(maskAccount("110-123-456789")).toBe("***-****-6789"));
});
