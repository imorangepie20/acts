import type { AccountGroup, DashboardRole } from "@/lib/accounts";

export type StandardAccount = {
  code: string;
  name: string;
  group: AccountGroup;
  requiresPartner: boolean;
  dashboardRole: DashboardRole | null;
};

// Which standard accounts the executive dashboard sums as cash / receivables / payables.
const DASHBOARD_ROLE_CODES: Record<DashboardRole, string[]> = {
  cash: ["101", "102", "103", "104", "105", "106"],
  receivable: ["108", "110", "120"],
  payable: ["251", "252", "253"],
};
const roleOf = (code: string): DashboardRole | null =>
  (Object.keys(DASHBOARD_ROLE_CODES) as DashboardRole[]).find((r) => DASHBOARD_ROLE_CODES[r].includes(code)) ?? null;

// "code name" entries; a trailing * marks requiresPartner.
const CHART: Record<AccountGroup, string[]> = {
  current_asset: [
    "101 현금", "102 당좌예금", "103 보통예금", "104 기타제예금", "105 정기예금", "106 정기적금",
    "107 단기매매증권", "108 외상매출금*", "109 대손충당금", "110 받을어음*", "111 대손충당금",
    "114 단기대여금*", "116 미수수익", "120 미수금*", "131 선급금*", "133 선급비용", "134 가지급금",
    "135 부가세대급금", "136 선납세금", "146 상품", "150 제품", "153 원재료",
  ],
  noncurrent_asset: [
    "179 장기대여금*", "201 토지", "202 건물", "203 감가상각누계액", "206 기계장치", "207 감가상각누계액",
    "208 차량운반구", "209 감가상각누계액", "212 비품", "213 감가상각누계액",
  ],
  current_liability: [
    "251 외상매입금*", "252 지급어음*", "253 미지급금*", "254 예수금", "255 부가세예수금", "257 가수금",
    "259 선수금*", "260 단기차입금*", "261 미지급세금", "262 미지급비용",
  ],
  noncurrent_liability: ["293 장기차입금*", "295 퇴직급여충당부채"],
  equity: ["331 자본금", "375 이월이익잉여금", "377 미처분이익잉여금"],
  revenue: ["401 상품매출", "404 제품매출"],
  cost_of_sales: ["451 상품매출원가", "455 제품매출원가"],
  sga: [
    "801 임원급여", "802 직원급여", "803 상여금", "806 퇴직급여", "811 복리후생비", "812 여비교통비",
    "813 기업업무추진비", "814 통신비", "815 수도광열비", "817 세금과공과", "818 감가상각비",
    "819 지급임차료", "820 수선비", "821 보험료", "822 차량유지비", "824 운반비", "825 교육훈련비",
    "826 도서인쇄비", "829 사무용품비", "830 소모품비", "831 지급수수료", "833 광고선전비",
    "835 대손상각비", "848 잡비",
  ],
  non_operating_income: ["901 이자수익", "903 배당금수익", "904 임대료", "907 외환차익", "930 잡이익"],
  non_operating_expense: ["951 이자비용", "952 외환차손", "953 기부금", "980 잡손실"],
  income_tax: ["998 법인세등"],
};

export const STANDARD_ACCOUNTS: StandardAccount[] = (
  Object.entries(CHART) as [AccountGroup, string[]][]
).flatMap(([group, items]) =>
  items.map((item) => {
    const [code, rest] = item.split(" ");
    const requiresPartner = rest.endsWith("*");
    return { code, name: requiresPartner ? rest.slice(0, -1) : rest, group, requiresPartner, dashboardRole: roleOf(code) };
  }),
);
