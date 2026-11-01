import { describe, expect, it } from "vitest";
import { n, record, x } from "./fixed";

describe("x", () => {
  it("encodes Hangul as EUC-KR and pads to length", () => {
    const b = x("홍길동", 30);
    expect(b.length).toBe(30);
    expect(b[0]).toBe(0xc8);
    expect(b[1]).toBe(0xab);
    expect(b.subarray(6).every((v) => v === 0x20)).toBe(true);
  });

  it("keeps 15 of 16 Hangul in X(30) with no padding", () => {
    const b = x("가".repeat(16), 30);
    expect(b.length).toBe(30);
    expect(b.equals(x("가".repeat(15), 30))).toBe(true);
    expect(b[29]).not.toBe(0x20);
  });

  it("never splits a 2-byte character", () => {
    const b = x("A" + "가".repeat(15), 30);
    expect(b.length).toBe(30);
    expect(b.equals(x("A" + "가".repeat(14), 30))).toBe(true);
    expect(b[29]).toBe(0x20);
    expect(b[0]).toBe(0x41);
  });

  it("throws naming a character outside EUC-KR", () => {
    expect(() => x("A😀", 10)).toThrow(/😀/);
  });
});

describe("n", () => {
  it("zero-pads on the left", () => {
    expect(n(123456, 13).toString("ascii")).toBe("0000000123456");
  });
  it("rejects negative, non-integer, unsafe and overflowing values", () => {
    expect(() => n(-1, 13)).toThrow();
    expect(() => n(1.5, 13)).toThrow();
    expect(() => n(2 ** 53, 20)).toThrow();
    expect(() => n(10 ** 13, 13)).toThrow();
  });
  it("accepts the largest value that fits", () => {
    expect(n(9999999999999, 13).toString("ascii")).toBe("9999999999999");
  });
});

describe("record", () => {
  it("joins parts totalling 190 bytes", () => {
    expect(record([x("", 100), x("", 90)]).length).toBe(190);
  });
  it("throws unless exactly 190 bytes", () => {
    expect(() => record([x("", 189)])).toThrow();
    expect(() => record([x("", 191)])).toThrow();
  });
});
