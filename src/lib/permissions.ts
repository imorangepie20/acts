export type Role = "staff" | "manager" | "executive" | "admin";
export type Permission =
  | "overview:view"
  | "voucher:create"
  | "voucher:approve"
  | "ledger:view"
  | "period:close"
  | "export:tax"
  | "settings:manage";

export const ROLE_LABELS: Record<Role, string> = {
  staff: "실무자",
  manager: "중간 관리자",
  executive: "최고 관리자",
  admin: "시스템 관리자",
};

const MATRIX: Record<Permission, readonly Role[]> = {
  "overview:view": ["manager", "executive", "admin"],
  "voucher:create": ["staff", "manager", "admin"],
  "voucher:approve": ["manager", "admin"],
  "ledger:view": ["staff", "manager", "executive", "admin"],
  "period:close": ["admin"],
  "export:tax": ["staff", "manager", "admin"],
  "settings:manage": ["admin"],
};

export function can(role: Role, p: Permission): boolean {
  return MATRIX[p].includes(role);
}

export function homePathFor(role: Role): string {
  return role === "staff" ? "/vouchers" : "/overview";
}
