import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a v4 uuid in either case", () => {
    expect(isUuid("3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-5A4D-4E6F-9B0A-1C2D3E4F5A6B")).toBe(true);
  });
  it("rejects junk", () => {
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b ")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
