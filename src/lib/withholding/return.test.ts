import { describe, expect, it } from "vitest";
import { buildReturn, returnPairs, type ReturnRunInput } from "./return";

const line = (employeeId: number, gross: number, incomeTax: number, extra: Partial<ReturnRunInput["lines"][number]> = {}) => ({
  employeeId,
  gross,
  excludedNontaxable: 0,
  incomeTax,
  localTax: Math.floor(incomeTax / 100) * 10,
  ...extra,
});

const run = (yearMonth: string, payDate: string, lines: ReturnRunInput["lines"]): ReturnRunInput => ({
  yearMonth,
  payDate,
  lines,
});

describe("buildReturn monthly", () => {
  const runs = [
    run("2026-03", "2026-03-25", [line(1, 3_000_000, 100_000), line(2, 2_000_000, 50_000)]),
    run("2026-02", "2026-03-25", [line(1, 1_000_000, 20_000)]),
    run("2026-03", "2026-04-10", [line(3, 9_000_000, 900_000)]),
  ];

  it("keeps only runs matching both attribution and payment month", () => {
    const r = buildReturn({ mode: "monthly", attributionMonth: "2026-03", paymentMonth: "2026-03" }, runs, 0);
    expect(r.attributionMonth).toBe("2026-03");
    expect(r.paymentMonth).toBe("2026-03");
    expect(r.a01).toEqual({ people: 2, totalPaid: 5_000_000, incomeTax: 150_000 });
    expect(r.a10).toEqual(r.a01);
    expect(r.a99).toEqual(r.a01);
    expect(r.localTax).toBe(15_000);
  });

  it("counts distinct employees across filtered runs", () => {
    const two = [run("2026-03", "2026-03-25", [line(1, 1, 0)]), run("2026-03", "2026-03-31", [line(1, 1, 0), line(2, 1, 0)])];
    const r = buildReturn({ mode: "monthly", attributionMonth: "2026-03", paymentMonth: "2026-03" }, two, 0);
    expect(r.a01.people).toBe(2);
  });

  it("totalPaid excludes excludedNontaxable", () => {
    const r = buildReturn(
      { mode: "monthly", attributionMonth: "2026-03", paymentMonth: "2026-03" },
      [run("2026-03", "2026-03-25", [line(1, 3_000_000, 10_000, { excludedNontaxable: 200_000 })])],
      0,
    );
    expect(r.a01.totalPaid).toBe(2_800_000);
  });

  it("returns zeros when nothing matches", () => {
    const r = buildReturn({ mode: "monthly", attributionMonth: "2026-05", paymentMonth: "2026-05" }, runs, 0);
    expect(r.a01).toEqual({ people: 0, totalPaid: 0, incomeTax: 0 });
    expect(r.localTax).toBe(0);
  });
});

describe("buildReturn semiannual", () => {
  const runs = [
    run("2026-01", "2026-01-25", [line(1, 1_000_000, 10_000), line(2, 1_000_000, 10_000), line(3, 1_000_000, 10_000)]),
    run("2026-06", "2026-06-25", [line(1, 1_000_000, 10_000), line(2, 1_000_000, 10_000)]),
    run("2026-07", "2026-07-25", [line(9, 5_000_000, 500_000)]),
  ];

  it("uses the half's months and headcount of the last month", () => {
    const r = buildReturn({ mode: "semiannual", year: 2026, half: 1 }, runs, 0);
    expect(r.attributionMonth).toBe("2026-01");
    expect(r.paymentMonth).toBe("2026-06");
    expect(r.a01).toEqual({ people: 2, totalPaid: 5_000_000, incomeTax: 50_000 });
    expect(r.localTax).toBe(5_000);
  });

  it("headcount is 0 when no run was paid in the last month", () => {
    const r = buildReturn({ mode: "semiannual", year: 2026, half: 1 }, runs.slice(0, 1), 0);
    expect(r.a01.people).toBe(0);
    expect(r.a01.totalPaid).toBe(3_000_000);
  });

  it("half 2 spans 07 to 12", () => {
    const r = buildReturn({ mode: "semiannual", year: 2026, half: 2 }, runs, 0);
    expect(r.attributionMonth).toBe("2026-07");
    expect(r.paymentMonth).toBe("2026-12");
    expect(r.a01).toEqual({ people: 0, totalPaid: 5_000_000, incomeTax: 500_000 });
  });
});

describe("refund", () => {
  const p = { mode: "monthly", attributionMonth: "2026-03", paymentMonth: "2026-03" } as const;
  const runs = [run("2026-03", "2026-03-25", [line(1, 3_000_000, 300_000)])];

  it("refund larger than tax is capped", () => {
    expect(buildReturn(p, runs, 500_000).refund).toEqual({ carriedIn: 500_000, arising: 0, adjusted: 300_000, payable: 0, carriedOut: 200_000 });
  });

  it("refund smaller than tax is fully used", () => {
    expect(buildReturn(p, runs, 100_000).refund).toEqual({ carriedIn: 100_000, arising: 0, adjusted: 100_000, payable: 200_000, carriedOut: 0 });
  });

  it("rejects negative or non-integer carried-in refund", () => {
    expect(() => buildReturn(p, runs, -1)).toThrow();
    expect(() => buildReturn(p, runs, 1.5)).toThrow();
    expect(() => buildReturn(p, runs, Number.NaN)).toThrow();
  });
});

describe("연말정산 (A04)", () => {
  const p = { mode: "monthly", attributionMonth: "2026-02", paymentMonth: "2026-02" } as const;

  it("A04 nets the typed 연말정산 amounts; A10 adds them to A01", () => {
    const runs = [
      run("2026-02", "2026-02-25", [
        line(1, 3_000_000, 100_000, { settlementIncomeTax: -150_000, settlementLocalTax: -15_000 }),
        line(2, 3_000_000, 100_000, { settlementIncomeTax: 30_000, settlementLocalTax: 3_000 }),
        line(3, 3_000_000, 100_000),
      ]),
    ];
    const r = buildReturn(p, runs, 0);
    expect(r.a01).toEqual({ people: 3, totalPaid: 9_000_000, incomeTax: 300_000 });
    expect(r.a04).toEqual({ people: 2, totalPaid: null, incomeTax: -120_000 });
    expect(r.a10).toEqual({ people: 3, totalPaid: 9_000_000, incomeTax: 180_000 });
    expect(r.a99).toEqual(r.a10);
    expect(r.refund).toEqual({ carriedIn: 0, arising: 0, adjusted: 0, payable: 180_000, carriedOut: 0 });
    expect(r.localTax).toBe(30_000 - 12_000);
  });

  it("a refund larger than the month's tax becomes this month's 환급세액 (⑬) and is carried out", () => {
    const runs = [run("2026-02", "2026-02-25", [line(1, 3_000_000, 100_000, { settlementIncomeTax: -250_000 })])];
    const r = buildReturn(p, runs, 40_000);
    expect(r.a10.incomeTax).toBe(-150_000);
    expect(r.refund).toEqual({ carriedIn: 40_000, arising: 150_000, adjusted: 0, payable: 0, carriedOut: 190_000 });
  });
});

describe("returnPairs", () => {
  it("gives two pairs in one payment month, sorted", () => {
    expect(
      returnPairs([
        { yearMonth: "2026-03", payDate: "2026-03-25" },
        { yearMonth: "2026-02", payDate: "2026-03-25" },
        { yearMonth: "2026-03", payDate: "2026-03-31" },
      ]),
    ).toEqual([
      { attributionMonth: "2026-02", paymentMonth: "2026-03" },
      { attributionMonth: "2026-03", paymentMonth: "2026-03" },
    ]);
  });

  it("sorts by payment month first", () => {
    expect(
      returnPairs([
        { yearMonth: "2026-01", payDate: "2026-04-01" },
        { yearMonth: "2026-03", payDate: "2026-03-25" },
      ]).map((p) => p.paymentMonth),
    ).toEqual(["2026-03", "2026-04"]);
  });
});
