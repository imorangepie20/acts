import { formatWon } from "@/lib/money";

/** (57) 전자신고 세액공제. Was 1만원; 5,000원 for 전자신고 made on or after 2026. 2. 27. */
export const E_FILING_CREDIT = 5000; // 조특법 시행령 §104의5④, 대통령령 제36127호 (2026. 2. 27.)

/** Shown above the return. Never word it as matching or verified against 홈택스. */
export const VAT_SOURCE_NOTICE =
  "홈택스 전자신고 화면의 문구·순서는 확인하지 않았습니다. 서식(2026. 3. 20. 개정)의 칸 번호를 따릅니다.";
export const EMPTY_VAT_NOTICE = "이 기간에 승인된 매입·매출 전표가 없습니다.";
/** Next to (30). */
export const ZERO_ASSUMED_NOTICE = "계산하지 않은 칸은 0으로 보고 계산했습니다";
/** (31)–(34) 과세표준명세: the company has no 업태·종목. */
export const BY_INDUSTRY_NOTICE = "업태·종목별로 직접 나눠 적으세요";
/** Under (53): vouchers carry no 불공제 사유 (별지 제22호서식). */
export const BY_REASON_NOTICE = "사유별 명세는 직접 나눠 적으세요";
/** 수령명세서 ⑧ row with no imported card number. */
export const ENTER_DIRECTLY = "직접 입력";

/** Under (1)–(4) when the summed 세액 is not 금액 × 10/100. */
export const taxDiffNotice = (diff: number): string => `금액 × 10%와 ${formatWon(Math.abs(diff))}원 차이`;

/** Under the 매입처별 세금계산서합계표 when 매입 세금계산서 have no 사업자등록번호 (they count as 주민등록번호 발급분). */
export const purchasesWithoutBusinessNumberNotice = (n: number): string =>
  `사업자등록번호가 없거나 올바르지 않은 매입 세금계산서 ${n}건 — 거래처 정보를 확인하세요`;
