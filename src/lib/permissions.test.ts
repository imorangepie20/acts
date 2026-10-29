import { describe, expect, it } from "vitest";
import { can, homePathFor, type Permission, type Role } from "./permissions";

const matrix: Record<Permission, Role[]> = {
  "overview:view": ["manager", "executive", "admin"],
  "voucher:create": ["staff", "manager", "admin"],
  "voucher:approve": ["manager", "admin"],
  "ledger:view": ["staff", "manager", "executive", "admin"],
  "period:close": ["admin"],
  "export:tax": ["staff", "manager", "admin"],
  "settings:manage": ["admin"],
};
const roles: Role[] = ["staff", "manager", "executive", "admin"];

describe("permission matrix", () => {
  for (const [perm, allowed] of Object.entries(matrix) as [Permission, Role[]][]) {
    for (const role of roles) {
      it(`${role} ${allowed.includes(role) ? "can" : "cannot"} ${perm}`, () => {
        expect(can(role, perm)).toBe(allowed.includes(role));
      });
    }
  }
  it("home paths", () => {
    expect(homePathFor("staff")).toBe("/vouchers");
    expect(homePathFor("executive")).toBe("/overview");
  });
});
