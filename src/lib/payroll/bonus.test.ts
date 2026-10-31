/**
 * 상여 소득세 (지급대상기간 방식)
 *
 * Source (fetched 2026-10-31):
 * - 소득세법 제136조 (상여 등에 대한 징수세액)
 *   https://www.law.go.kr/LSW//lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000317783&lsId=001565&print=print
 *   - "그 상여등을 받은 과세기간의 1월 1일부터 그 상여등의 지급일이 속하는 달까지를 지급대상기간으로 하여"
 *     (no 지급대상기간 -> January of the pay year through the pay month)
 *   - "지급대상기간이 1년을 초과하는 경우에는 1년으로 보고"
 *   - "1개월 미만의 끝수가 있는 경우에는 1개월로 본다."
 *   - "그 상여등의 금액을 지급대상기간의 월수로 나누어 계산한 금액" ... 월수를 곱하고 이미 원천징수한 세액을 뺀다.
 * - 국세청 근로소득 원천징수 방법
 *   https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=6583&cntntsId=7862
 *   원천징수세액 = (㉮ × ㉯) − ㉰
 *   ㉮ = [(상여 + 지급대상기간의 상여 외 급여 합계) ÷ 월수]에 대한 간이세액표 세액
 *   ㉯ = 월수, ㉰ = 지급대상기간 상여 외 급여에서 이미 원천징수한 세액
 *   80/100/120% 선택: 간이세액표 세액에 대한 비율. The pages do not state the order against
 *   ×월수; we apply it to the monthly table amount, floor to 10원, then x months (same as the regular run; UNVERIFIED order).
 * Note: the 법 제136조 text was used because the 시행령 제194조 page could not be fetched.
 * A period longer than 12 months is capped to the 12 months ending at `to`.
 */
import { describe, expect, it } from "vitest";
import { bonusIncomeTax, bonusPeriod } from "./bonus";
import { monthlyIncomeTax } from "./calc";
import type { WithholdingTable } from "./types";

const table: WithholdingTable = {
  rows: [
    { from: 0, to: 2_500_000, tax: [10_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { from: 2_500_000, to: 3_500_000, tax: [55_550, 20_000, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { from: 3_500_000, to: 10_000_000, tax: [99_990, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { from: 10_000_000, to: 10_000_001, tax: [1_507_400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  over10m: [],
  childCredit: { one: 12_500, two: 29_160, perExtra: 25_000 },
  familyOver11: { baseCount: 11, stepFromCount: 10 },
};
const tableTax = (n: number) => monthlyIncomeTax(table, n, 1, 0);
const common = { table, dependents: 1, children: 0, withholdingRate: 100 };

describe("bonusPeriod", () => {
  it("defaults to January of the pay year through the pay month", () => {
    expect(bonusPeriod("2026-07-25", null, null)).toEqual({ from: "2026-01", to: "2026-07", months: 7 });
  });
  it("uses the entered period", () => {
    expect(bonusPeriod("2026-07-25", "2026-04", "2026-06")).toEqual({ from: "2026-04", to: "2026-06", months: 3 });
    expect(bonusPeriod("2026-07-25", "2026-04-15", "2026-06-02")).toMatchObject({ months: 3 });
  });
  it("caps a longer period to the 12 months ending at the end", () => {
    expect(bonusPeriod("2026-07-25", "2025-01", "2026-06")).toEqual({ from: "2025-07", to: "2026-06", months: 12 });
  });
  it("keeps exactly 12 months", () => {
    expect(bonusPeriod("2026-07-25", "2025-07", "2026-06")).toMatchObject({ from: "2025-07", months: 12 });
  });
  it("rejects a bad month or a half-entered period", () => {
    expect(() => bonusPeriod("2026-07-25", "2026-00", "2026-04")).toThrow();
    expect(() => bonusPeriod("2026-07-25", "2026-01", "2026-13")).toThrow();
    expect(() => bonusPeriod("2026-07-25", "2026-01", null)).toThrow();
    expect(() => bonusPeriod("2026-07-25", null, "2026-04")).toThrow();
  });
  it("rejects a reversed period", () => {
    expect(() => bonusPeriod("2026-07-25", "2026-06", "2026-04")).toThrow();
  });
});

describe("bonusIncomeTax", () => {
  it("average tax x months minus tax already withheld", () => {
    const tax = bonusIncomeTax({
      ...common, bonusTaxable: 3_000_000, periodRegularTaxable: 6_000_000, periodWithheld: 60_000, months: 3,
    });
    expect(tableTax(3_000_000)).toBe(55_550);
    expect(tax).toBe(tableTax(3_000_000) * 3 - 60_000);
  });
  it("is never negative", () => {
    expect(
      bonusIncomeTax({ ...common, bonusTaxable: 100_000, periodRegularTaxable: 2_000_000, periodWithheld: 500_000, months: 2 }),
    ).toBe(0);
  });
  it("floors the average to won", () => {
    // (3,000,001 + 0) / 2 = 1,500,000.5 -> 1,500,000 -> 10,000 per month
    expect(
      bonusIncomeTax({ ...common, bonusTaxable: 3_000_001, periodRegularTaxable: 0, periodWithheld: 0, months: 2 }),
    ).toBe(20_000);
  });
  it("applies 80% / 120% to the total and floors to 10원", () => {
    const i = { ...common, bonusTaxable: 3_000_000, periodRegularTaxable: 6_000_000, periodWithheld: 0, months: 3 };
    expect(bonusIncomeTax({ ...i, withholdingRate: 80 })).toBe(133_320); // 166,650 x .8 = 133,320
    expect(bonusIncomeTax({ ...i, withholdingRate: 120 })).toBe(199_980);
  });
  it("floors the rated monthly amount before x months", () => {
    const odd: WithholdingTable = { ...table, rows: [{ from: 0, to: 10_000_000, tax: [55_545, ...Array(10).fill(0)] }, table.rows[3]] };
    const tax = bonusIncomeTax({
      ...common, table: odd, withholdingRate: 80, bonusTaxable: 3_000_000, periodRegularTaxable: 6_000_000, periodWithheld: 0, months: 3,
    });
    // floor10(55,545 x .8 = 44,436) = 44,430, x 3 = 133,290 (floor10 of the total would be 133,300)
    expect(tax).toBe(133_290);
  });
  it("rejects bad input", () => {
    const ok = { ...common, bonusTaxable: 1, periodRegularTaxable: 0, periodWithheld: 0, months: 1 };
    expect(() => bonusIncomeTax({ ...ok, months: 0 })).toThrow();
    expect(() => bonusIncomeTax({ ...ok, bonusTaxable: -1 })).toThrow();
    expect(() => bonusIncomeTax({ ...ok, periodWithheld: 1.5 })).toThrow();
    expect(() => bonusIncomeTax({ ...ok, bonusTaxable: Number.NaN })).toThrow();
    expect(() => bonusIncomeTax({ ...ok, withholdingRate: 90 })).toThrow();
  });
  it("uses dependents and children", () => {
    const tax = bonusIncomeTax({
      table, dependents: 2, children: 0, withholdingRate: 100,
      bonusTaxable: 3_000_000, periodRegularTaxable: 0, periodWithheld: 0, months: 1,
    });
    expect(tax).toBe(20_000);
  });
});
