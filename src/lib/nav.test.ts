import { describe, expect, it } from "vitest";
import { breadcrumbTrail, navGroupsFor } from "./nav";

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
  it("admin sees all 20 items", () => {
    expect(hrefs("admin")).toHaveLength(20);
  });
  it("payroll menus need payroll:manage", () => {
    for (const role of ["manager", "admin"] as const) {
      expect(hrefs(role)).toEqual(expect.arrayContaining(["/payroll/employees", "/payroll/settings"]));
    }
    for (const role of ["staff", "executive"] as const) {
      expect(hrefs(role).some((h) => h.startsWith("/payroll"))).toBe(false);
    }
  });
  it("drops empty groups", () => {
    expect(navGroupsFor("executive").every((g) => g.items.length > 0)).toBe(true);
  });
});

describe("breadcrumbTrail", () => {
  const id = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  it("omits segments without a page", () => {
    expect(breadcrumbTrail("/admin/users")).toEqual([{ href: "/admin/users", label: "사용자" }]);
    expect(breadcrumbTrail("/reports/income-statement")).toEqual([
      { href: "/reports/income-statement", label: "손익계산서" },
    ]);
  });
  it("builds voucher trails", () => {
    expect(breadcrumbTrail("/vouchers/new")).toEqual([
      { href: "/vouchers", label: "전표 목록" },
      { href: "/vouchers/new", label: "전표 입력" },
    ]);
    expect(breadcrumbTrail(`/vouchers/${id}`).map((c) => c.label)).toEqual(["전표 목록", "전표 상세"]);
    expect(breadcrumbTrail("/payroll/employees/new").map((c) => c.label)).toEqual(["사원", "사원 등록"]);
    expect(breadcrumbTrail("/payroll/employees/7").map((c) => c.label)).toEqual(["사원", "사원 상세"]);
    expect(breadcrumbTrail(`/vouchers/${id}/edit`).map((c) => c.label)).toEqual(["전표 목록", "전표 상세", "수정"]);
  });
});
