import { describe, expect, it } from "vitest";
import { navGroupsFor } from "./nav";

const hrefs = (role: Parameters<typeof navGroupsFor>[0]) =>
  navGroupsFor(role).flatMap((g) => g.items.map((i) => i.href));

describe("navGroupsFor", () => {
  it("staff sees voucher entry but not overview/admin/closing", () => {
    const h = hrefs("staff");
    expect(h).toContain("/vouchers/new");
    expect(h).not.toContain("/overview");
    expect(h).not.toContain("/admin/users");
    expect(h).not.toContain("/closing");
  });
  it("executive sees reports but not voucher entry", () => {
    const h = hrefs("executive");
    expect(h).toContain("/overview");
    expect(h).toContain("/reports/balance-sheet");
    expect(h).not.toContain("/vouchers/new");
  });
  it("admin sees all 18 items", () => {
    expect(hrefs("admin")).toHaveLength(18);
  });
  it("drops empty groups", () => {
    expect(navGroupsFor("executive").every((g) => g.items.length > 0)).toBe(true);
  });
});
