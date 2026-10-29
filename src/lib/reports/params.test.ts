import { describe, expect, it } from "vitest";
import { parseReportParams } from "./params";

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
  it("uses the first element of arrays", () => {
    const f = parseReportParams({ from: ["2026-02-01", "x"], site: ["3", "4"] }, today, 1);
    expect(f.from).toBe("2026-02-01");
    expect(f.siteId).toBe(3);
  });
});
