import { describe, expect, it } from "vitest";
import { pageParam, parseReportParams } from "./params";

const today = "2026-10-30";

describe("parseReportParams", () => {
  it("falls back to the default period on garbage", () => {
    expect(parseReportParams({ from: "garbage", to: "2026-13-40" }, today, 1)).toEqual({
      from: "2026-01-01",
      to: today,
      siteId: null,
      departmentId: null,
    });
  });
  it("swaps from > to", () => {
    const f = parseReportParams({ from: "2026-05-01", to: "2026-03-01" }, today, 1);
    expect(f.from).toBe("2026-03-01");
    expect(f.to).toBe("2026-05-01");
  });
  it("parses site/dept", () => {
    expect(parseReportParams({ site: "abc", dept: "0" }, today, 1)).toMatchObject({ siteId: null, departmentId: null });
    expect(parseReportParams({ site: "2", dept: "-3" }, today, 1)).toMatchObject({ siteId: 2, departmentId: null });
    expect(parseReportParams({ site: "1.5" }, today, 1).siteId).toBeNull();
  });
  it("keeps an as-of date and derives from", () => {
    expect(parseReportParams({ to: "2025-06-30" }, "2026-10-30", 1)).toMatchObject({ from: "2025-01-01", to: "2025-06-30" });
    expect(parseReportParams({ to: "2025-02-10" }, "2026-10-30", 4)).toMatchObject({ from: "2024-04-01", to: "2025-02-10" });
  });
  it("handles from only", () => {
    expect(parseReportParams({ from: "2026-03-01" }, today, 1)).toMatchObject({ from: "2026-03-01", to: today });
    expect(parseReportParams({ from: "2027-03-01" }, today, 1)).toMatchObject({ from: "2027-03-01", to: "2027-03-01" });
  });
  it("uses the first element of arrays", () => {
    const f = parseReportParams({ from: ["2026-02-01", "x"], site: ["3", "4"] }, today, 1);
    expect(f.from).toBe("2026-02-01");
    expect(f.siteId).toBe(3);
  });
});

describe("pageParam", () => {
  it("parses a positive integer and falls back to 1 otherwise", () => {
    expect(pageParam({ page: "7" })).toBe(7);
    expect(pageParam({})).toBe(1);
    for (const page of ["abc", "0", "-1", "1.5", "", "99999999999999999999"]) expect(pageParam({ page }), page).toBe(1);
    expect(pageParam({ page: ["2", "3"] })).toBe(2);
  });
});
