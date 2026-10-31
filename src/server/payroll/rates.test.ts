import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { seed } from "../../../scripts/seed";
import type { WithholdingTable } from "@/lib/payroll/types";
import { loadRates, loadWithholdingTable } from "./rates";

const db = getTestDb();
const opts = { email: "admin@acts.kr", password: "pw-12345678" };

beforeEach(async () => {
  await resetDb(db);
  await seed(db, opts);
});

describe("loadRates", () => {
  it("takes the latest row of each kind on or before the date", async () => {
    expect((await loadRates(db, "2026-06-01")).pensionCap).toBe(6_370_000);
    expect((await loadRates(db, "2026-07-01")).pensionCap).toBe(6_590_000);
    const r = await loadRates(db, "2026-07-01");
    expect(r).toMatchObject({
      pensionEmployee: 4.75,
      pensionCompany: 4.75,
      pensionFloor: 410_000,
      healthEmployee: 3.595,
      healthCompany: 3.595,
      ltcEmployee: 13.14,
      ltcCompany: 13.14,
      employmentEmployee: 0.9,
      employmentCompany: 0.9,
    });
  });

  it("has the 2025 rates for 2025 귀속월", async () => {
    expect(await loadRates(db, "2025-03-01")).toEqual({
      pensionEmployee: 4.5,
      pensionCompany: 4.5,
      pensionCap: 6_170_000,
      pensionFloor: 390_000,
      healthEmployee: 3.545,
      healthCompany: 3.545,
      ltcEmployee: 12.95,
      ltcCompany: 12.95,
      employmentEmployee: 0.9,
      employmentCompany: 0.9,
    });
  });

  it("throws when a kind has no row for the date", async () => {
    await expect(loadRates(db, "1999-01-01")).rejects.toThrow("1999-01-01 기준 pension_employee 요율이 없습니다.");
  });
});

describe("loadWithholdingTable", () => {
  it("uses the 2026-02-27 revision (자녀 credit 20,830 / 45,830 / 33,330) from 2026-03-01", async () => {
    const before = await loadWithholdingTable(db, "2026-02-28");
    const after = await loadWithholdingTable(db, "2026-03-01");
    expect(before.childCredit).toEqual({ one: 12_500, two: 29_160, perExtra: 25_000 });
    expect(after.childCredit).toEqual({ one: 20_830, two: 45_830, perExtra: 33_330 });
  });

  it("throws when no table is in force", async () => {
    await expect(loadWithholdingTable(db, "2000-01-01")).rejects.toThrow(
      "2000-01-01 기준 근로소득 간이세액표가 없습니다.",
    );
  });
});

/** The row containing `wage` (won) and its amount for `family` 공제대상가족. */
function lookup(table: WithholdingTable, wage: number, family: number): number {
  const row = table.rows.find((r) => r.from <= wage && wage < r.to);
  if (!row) throw new Error(`no row for ${wage}`);
  return row.tax[family - 1];
}

describe("withholding table spot checks", () => {
  // Read off 소득세법 시행령 [별표 2] <개정 2026. 2. 27.> (law.go.kr PDF, flSeq=169798151), 제6호의 표.
  it("matches the printed [별표 2] amounts", async () => {
    const t = await loadWithholdingTable(db, "2026-03-01");
    // 1,500 이상 1,510 미만, 1명: 8,920
    expect(lookup(t, 1_500_000, 1)).toBe(8_920);
    // 3,000 이상 3,020 미만, 2명: 56,850
    expect(lookup(t, 3_000_000, 2)).toBe(56_850);
    // 5,000 이상 5,020 미만, 4명: 219,100
    expect(lookup(t, 5_000_000, 4)).toBe(219_100);
    // 7,000 이상 7,020 미만, 3명: 557,350
    expect(lookup(t, 7_000_000, 3)).toBe(557_350);
    // 10,000천원, 1명: 1,507,400
    expect(lookup(t, 10_000_000, 1)).toBe(1_507_400);
  });

  it("covers 770천원 to 10,000천원 without gaps", async () => {
    const t = await loadWithholdingTable(db, "2026-03-01");
    expect(t.rows[0].from).toBe(770_000);
    expect(t.rows.at(-1)).toMatchObject({ from: 10_000_000, to: 10_000_001 });
    for (let i = 1; i < t.rows.length; i++) expect(t.rows[i].from).toBe(t.rows[i - 1].to);
    for (const r of t.rows) expect(r.tax).toHaveLength(11);
  });

  it("encodes the over-10,000천원 lines of [별표 2] 제6호", async () => {
    const t = await loadWithholdingTable(db, "2026-03-01");
    expect(t.over10m.map((l) => [l.above, l.addFixed, l.plusRate, l.plusPercentOfExcess])).toEqual([
      [10_000_000, 25_000, 98, 35],
      [14_000_000, 1_397_000, 98, 38],
      [28_000_000, 6_610_600, 98, 40],
      [30_000_000, 7_394_600, 100, 40],
      [45_000_000, 13_394_600, 100, 42],
      [87_000_000, 31_034_600, 100, 45],
    ]);
    expect(t.familyOver11).toEqual({ baseCount: 11, stepFromCount: 10 });
  });
});
