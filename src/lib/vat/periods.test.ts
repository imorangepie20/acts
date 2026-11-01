import { describe, expect, it } from "vitest";
import { defaultVatPeriod, parseVatParams, vatPeriod } from "./periods";

describe("vatPeriod", () => {
  it("1기 예정 is January–March", () => {
    expect(vatPeriod({ year: 2026, term: 1, kind: "prelim", prelimFiled: true })).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
  it("1기 확정 after a 예정신고 is April–June", () => {
    expect(vatPeriod({ year: 2026, term: 1, kind: "final", prelimFiled: true })).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
  it("1기 확정 without a 예정신고 is the whole six months", () => {
    expect(vatPeriod({ year: 2026, term: 1, kind: "final", prelimFiled: false })).toEqual({ from: "2026-01-01", to: "2026-06-30" });
  });
  it("2기 확정 after a 예정신고 is October–December", () => {
    expect(vatPeriod({ year: 2026, term: 2, kind: "final", prelimFiled: true })).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
  it("2기 예정 is July–September", () => {
    expect(vatPeriod({ year: 2026, term: 2, kind: "prelim", prelimFiled: false })).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });
});

describe("defaultVatPeriod", () => {
  it("corporation: latest period ended before today", () => {
    expect(defaultVatPeriod("2026-11-01", "corporation")).toEqual({ year: 2026, term: 2, kind: "prelim" });
  });
  it("individual: only 확정 periods", () => {
    expect(defaultVatPeriod("2026-11-01", "individual")).toEqual({ year: 2026, term: 1, kind: "final" });
  });
  it("early January falls back to the previous year's 2기 확정", () => {
    expect(defaultVatPeriod("2026-01-10", "corporation")).toEqual({ year: 2025, term: 2, kind: "final" });
  });
  it("a period ending today is not yet the default", () => {
    expect(defaultVatPeriod("2026-09-30", "corporation")).toEqual({ year: 2026, term: 1, kind: "final" });
  });
});

describe("parseVatParams", () => {
  const ind = { today: "2026-11-01", businessType: "individual" as const };
  const corp = { today: "2026-11-01", businessType: "corporation" as const };

  it("no params + individual: 예정신고 안 함, 전자신고 함", () => {
    const s = parseVatParams({}, ind);
    expect(s).toMatchObject({ year: 2026, term: 1, kind: "final", prelimFiled: false, efile: true, notice: 0, prelimRefund: 0 });
    expect(s.errors).toEqual({});
  });
  it("year outside 2000-2100 falls back to the default year", () => {
    expect(parseVatParams({ year: "0000" }, ind).year).toBe(2026);
    expect(parseVatParams({ year: "2101" }, ind).year).toBe(2026);
    expect(parseVatParams({ year: "2100" }, ind).year).toBe(2100);
  });
  it("corporation defaults to prelimFiled", () => {
    expect(parseVatParams({}, corp).prelimFiled).toBe(true);
  });
  it("prelim=0 turns prelimFiled off", () => {
    expect(parseVatParams({ prelim: "0" }, corp).prelimFiled).toBe(false);
    expect(parseVatParams({ prelim: "1" }, ind).prelimFiled).toBe(true);
  });
  it("efile=0 turns efile off", () => {
    expect(parseVatParams({ efile: "0" }, corp).efile).toBe(false);
  });
  it("notice=-5 falls back to 0 with an error", () => {
    const s = parseVatParams({ year: "2026", term: "1", kind: "final", notice: "-5" }, corp);
    expect(s.notice).toBe(0);
    expect(s.errors.notice).toBeTruthy();
  });
  it("notice=abc and prelimRefund=1.5 fall back to 0 with errors", () => {
    const s = parseVatParams({ kind: "final", notice: "abc", prelimRefund: "1.5" }, corp);
    expect(s).toMatchObject({ notice: 0, prelimRefund: 0 });
    expect(s.errors.notice).toBeTruthy();
    expect(s.errors.prelimRefund).toBeTruthy();
  });
  it("notice=120000 on a 확정 is kept", () => {
    const s = parseVatParams({ kind: "final", notice: "120000", prelimRefund: "3000" }, corp);
    expect(s.notice).toBe(120000);
    expect(s.prelimRefund).toBe(3000);
    expect(s.errors).toEqual({});
  });
  it("a 예정 ignores notice without an error", () => {
    const s = parseVatParams({ kind: "prelim", notice: "120000", prelimRefund: "abc" }, corp);
    expect(s.notice).toBe(0);
    expect(s.prelimRefund).toBe(0);
    expect(s.errors).toEqual({});
  });
  it("term=3 falls back to the default", () => {
    expect(parseVatParams({ term: "3" }, corp).term).toBe(2);
    expect(parseVatParams({ year: "26", kind: "x" }, corp)).toMatchObject({ year: 2026, kind: "prelim" });
  });
  it("takes the first value of an array param", () => {
    expect(parseVatParams({ year: ["2025", "2024"], term: "1", kind: "prelim" }, corp)).toMatchObject({ year: 2025, term: 1, kind: "prelim" });
  });
});

describe("Review Focus 3: 확정 without a prelim param", () => {
  const sp = { year: "2026", term: "2", kind: "final" };
  it("individual covers the whole six months", () => {
    expect(vatPeriod(parseVatParams(sp, { today: "2026-11-01", businessType: "individual" }))).toEqual({ from: "2026-07-01", to: "2026-12-31" });
  });
  it("corporation covers the last three months", () => {
    expect(vatPeriod(parseVatParams(sp, { today: "2026-11-01", businessType: "corporation" }))).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
});
