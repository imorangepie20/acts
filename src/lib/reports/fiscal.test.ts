import { describe, expect, it } from "vitest";
import { addDays, defaultPeriod, fiscalYearStart, priorYearPeriod, shiftYear } from "./fiscal";

describe("fiscal helpers", () => {
  it("fiscalYearStart", () => {
    expect(fiscalYearStart("2026-10-30", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-15", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
  });
  it("addDays", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("shiftYear clamps Feb 29", () => {
    expect(shiftYear("2028-02-29", -1)).toBe("2027-02-28");
    expect(shiftYear("2026-10-30", 1)).toBe("2027-10-30");
  });
  it("defaultPeriod and priorYearPeriod", () => {
    expect(defaultPeriod("2026-02-10", 4)).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(priorYearPeriod({ from: "2025-04-01", to: "2026-02-10" })).toEqual({
      from: "2024-04-01",
      to: "2025-02-10",
    });
  });
});
