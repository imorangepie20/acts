import type { Over10mRule, WithholdingTable } from "@/lib/payroll/types";
import table20240301 from "./withholding-2024-03-01.json";

/*
 * 근로소득 간이세액표, one entry per [별표 2] revision. Seeded into `withholding_tables` by scripts/seed.ts.
 *
 * rows: converted by scripts/convert-withholding-table.ts from the 홈택스 workbook
 *   https://teht.hometax.go.kr/doc/sf/a/a/근로소득_간이세액표(조견표).xlsx (title "2024년 근로소득에 대한 간이세액표",
 *   saved 2024-03-14, sha256 7ff5fc0c…acd26).
 * Legal text: 소득세법 시행령 [별표 2], law.go.kr
 *   <개정 2024. 2. 29.>  https://www.law.go.kr/LSW/flDownload.do?flSeq=153480555&bylClsCd=110201
 *   <개정 2026. 2. 27.>  https://www.law.go.kr/LSW/flDownload.do?flSeq=169798151&bylClsCd=110201
 *   (대통령령 제36129호, 시행 2026. 3. 1.; the current [별표 2] as of 대통령령 제36737호, 시행 2026. 10. 1.)
 * All 647 converted rows × 11 amounts were compared with the 제6호 table text of both PDFs: identical.
 * The 2026. 2. 27. revision changed only 제3호 (the 자녀 amounts), so both revisions share the rows.
 */

/** [별표 2] 제6호, 10,000천원 초과 lines (identical in both revisions). */
const OVER_10M: Over10mRule[] = [
  // 10,000천원 초과 14,000천원 이하: (10,000천원인 경우의 해당세액) + (10,000천원을 초과하는 금액에 98%를 곱한 금액의 35% 상당액) + (25,000원)
  { above: 10_000_000, base: "table10m", plusRate: 98, plusPercentOfExcess: 35, addFixed: 25_000 },
  // 14,000천원 초과 28,000천원 이하: (10,000천원인 경우의 해당세액) + (1,397,000원) + (14,000천원을 초과하는 금액에 98%를 곱한 금액의 38% 상당액)
  { above: 14_000_000, base: "table10m", plusRate: 98, plusPercentOfExcess: 38, addFixed: 1_397_000 },
  // 28,000천원 초과 30,000천원 이하: (10,000천원인 경우의 해당세액) + (6,610,600원) + (28,000천원을 초과하는 금액에 98%를 곱한 금액의 40% 상당액)
  { above: 28_000_000, base: "table10m", plusRate: 98, plusPercentOfExcess: 40, addFixed: 6_610_600 },
  // 30,000천원 초과 45,000천원 이하: (10,000천원인 경우의 해당세액) + (7,394,600원) + (30,000천원을 초과하는 금액의 40% 상당액)
  { above: 30_000_000, base: "table10m", plusRate: 100, plusPercentOfExcess: 40, addFixed: 7_394_600 },
  // 45,000천원 초과 87,000천원 이하: (10,000천원인 경우의 해당세액) + (13,394,600원) + (45,000천원을 초과하는 금액의 42% 상당액)
  { above: 45_000_000, base: "table10m", plusRate: 100, plusPercentOfExcess: 42, addFixed: 13_394_600 },
  // 87,000천원 초과: (10,000천원인 경우의 해당세액) + (31,034,600원) + (87,000천원을 초과하는 금액의 45% 상당액)
  { above: 87_000_000, base: "table10m", plusRate: 100, plusPercentOfExcess: 45, addFixed: 31_034_600 },
];

/**
 * [별표 2] 제4호: 공제대상가족의 수가 11명을 초과하는 경우의 세액은 다음 "가목"의 금액에서 "나목"의 금액을 공제한 금액으로 함.
 *   가. 공제대상가족의 수가 11명인 경우의 세액
 *   나. (공제대상가족의 수가 10명인 경우의 세액 - 공제대상가족의 수가 11명인 경우의 세액) × 11명을 초과하는 가족의 수
 */
const FAMILY_OVER_11: WithholdingTable["familyOver11"] = { baseCount: 11, stepFromCount: 10 };

export const WITHHOLDING_REVISIONS: { effectiveFrom: string; table: WithholdingTable }[] = [
  {
    // <개정 2024. 2. 29.>, in force 2024-03-01.
    effectiveFrom: "2024-03-01",
    table: {
      rows: table20240301.rows,
      over10m: OVER_10M,
      // 제3호 가. 자녀가 1명인 경우: 12,500원 / 나. 2명인 경우: 29,160원 / 다. 3명 이상인 경우: 29,160원 + 2명 초과 자녀 1명당 25,000원
      childCredit: { one: 12_500, two: 29_160, perExtra: 25_000 },
      familyOver11: FAMILY_OVER_11,
    },
  },
  {
    // <개정 2026. 2. 27.>, 대통령령 제36129호, in force 2026-03-01.
    effectiveFrom: "2026-03-01",
    table: {
      rows: table20240301.rows,
      over10m: OVER_10M,
      // 제3호 가. 자녀가 1명인 경우: 20,830원 / 나. 2명인 경우: 45,830원 / 다. 3명 이상인 경우: 45,830원 + 2명 초과 자녀 1명당 33,330원
      childCredit: { one: 20_830, two: 45_830, perExtra: 33_330 },
      familyOver11: FAMILY_OVER_11,
    },
  },
];
