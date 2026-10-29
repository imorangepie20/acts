import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, FilePlus2, FileText, Upload, BookOpen, BookText, Users,
  Scale, TrendingUp, Landmark, Lock, ArrowRightLeft, FileSpreadsheet,
  Building2, ListTree, Handshake, MapPin, UserCog,
} from "lucide-react";
import { can, type Permission, type Role } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";

export type NavItem = { title: string; href: string; icon?: LucideIcon; permission: Permission };
export type NavGroup = { label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    label: "경영 현황",
    items: [{ title: "대시보드", href: "/overview", icon: LayoutDashboard, permission: "overview:view" }],
  },
  {
    label: "전표",
    items: [
      { title: "전표 입력", href: "/vouchers/new", icon: FilePlus2, permission: "voucher:create" },
      { title: "전표 목록", href: "/vouchers", icon: FileText, permission: "ledger:view" },
      { title: "자료 불러오기", href: "/imports", icon: Upload, permission: "voucher:create" },
    ],
  },
  {
    label: "장부",
    items: [
      { title: "분개장", href: "/ledgers/journal", icon: BookOpen, permission: "ledger:view" },
      { title: "계정별 원장", href: "/ledgers/accounts", icon: BookText, permission: "ledger:view" },
      { title: "거래처별 원장", href: "/ledgers/partners", icon: Users, permission: "ledger:view" },
    ],
  },
  {
    label: "재무제표",
    items: [
      { title: "합계잔액시산표", href: "/reports/trial-balance", icon: Scale, permission: "ledger:view" },
      { title: "손익계산서", href: "/reports/income-statement", icon: TrendingUp, permission: "ledger:view" },
      { title: "재무상태표", href: "/reports/balance-sheet", icon: Landmark, permission: "ledger:view" },
    ],
  },
  {
    label: "결산·세무",
    items: [
      { title: "월 마감", href: "/closing", icon: Lock, permission: "period:close" },
      { title: "기초잔액·이월", href: "/closing/opening", icon: ArrowRightLeft, permission: "period:close" },
      { title: "세무사 자료", href: "/exports", icon: FileSpreadsheet, permission: "export:tax" },
    ],
  },
  {
    label: "설정",
    items: [
      { title: "회사 정보", href: "/admin/company", icon: Building2, permission: "settings:manage" },
      { title: "계정과목", href: "/admin/accounts", icon: ListTree, permission: "settings:manage" },
      { title: "거래처", href: "/admin/partners", icon: Handshake, permission: "settings:manage" },
      { title: "사업장·부서", href: "/admin/sites", icon: MapPin, permission: "settings:manage" },
      { title: "사용자", href: "/admin/users", icon: UserCog, permission: "settings:manage" },
    ],
  },
];

// Flat list of every menu item (used by e2e and stub generation).
export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

export function navGroupsFor(role: Role): NavGroup[] {
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.permission)) }))
    .filter((g) => g.items.length > 0);
}

export function breadcrumbTrail(pathname: string): { href: string; label: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const trail: { href: string; label: string }[] = [];
  segments.forEach((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const item = allNavItems.find((n) => n.href === href);
    if (item) trail.push({ href, label: item.title });
    else if (segments[0] === "vouchers" && i === 1 && isUuid(seg)) trail.push({ href, label: "전표 상세" });
    else if (seg === "edit" && i > 0) trail.push({ href, label: "수정" });
  });
  return trail;
}
