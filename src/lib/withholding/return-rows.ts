// Row layout of 별지 제21호서식 (2026-05-22) page 1, "① 원천징수 명세 및 납부세액".

export type ReturnRowCode = { code: string; label: string };
export type ReturnRowGroup = { label: string; rows: ReturnRowCode[] };

/** acts computes only these rows (근로소득 간이세액 and the totals). */
export const COMPUTED_ROW_CODES = ["A01", "A10", "A99"] as const;

export const NOT_COMPUTED_TEXT = "이 프로그램에서 계산하지 않음";

export const RETURN_ROW_GROUPS: ReturnRowGroup[] = [
  {
    label: "근로소득",
    rows: [
      { code: "A01", label: "간이세액" },
      { code: "A02", label: "중도퇴사" },
      { code: "A03", label: "일용근로" },
      { code: "A04", label: "연말정산 합계" },
      { code: "A05", label: "연말정산 분납신청" },
      { code: "A06", label: "연말정산 납부금액" },
      { code: "A10", label: "가감계" },
    ],
  },
  {
    label: "퇴직소득",
    rows: [
      { code: "A21", label: "연금계좌" },
      { code: "A22", label: "그 외" },
      { code: "A20", label: "가감계" },
    ],
  },
  {
    label: "사업소득",
    rows: [
      { code: "A25", label: "매월징수" },
      { code: "A26", label: "연말정산 합계" },
      { code: "A27", label: "연말정산 분납신청" },
      { code: "A28", label: "연말정산 납부금액" },
      { code: "A30", label: "가감계" },
    ],
  },
  {
    label: "기타소득",
    rows: [
      { code: "A41", label: "연금계좌" },
      { code: "A43", label: "종교인소득 매월징수" },
      { code: "A44", label: "종교인소득 연말정산" },
      { code: "A49", label: "가상자산" },
      { code: "A59", label: "인적용역" },
      { code: "A42", label: "그 외" },
      { code: "A40", label: "가감계" },
    ],
  },
  {
    label: "연금소득",
    rows: [
      { code: "A48", label: "연금계좌" },
      { code: "A45", label: "공적연금(매월)" },
      { code: "A46", label: "연말정산" },
      { code: "A47", label: "가감계" },
    ],
  },
  { label: "이자소득", rows: [{ code: "A50", label: "이자소득" }] },
  { label: "배당소득", rows: [{ code: "A60", label: "배당소득" }] },
  { label: "저축 등 해지 추징세액 등", rows: [{ code: "A69", label: "저축 등 해지 추징세액 등" }] },
  { label: "비거주자 양도소득", rows: [{ code: "A70", label: "비거주자 양도소득" }] },
  { label: "법인원천", rows: [{ code: "A80", label: "내·외국법인원천" }] },
  { label: "수정신고(세액)", rows: [{ code: "A90", label: "수정신고(세액)" }] },
  { label: "총합계", rows: [{ code: "A99", label: "총합계" }] },
];

/** "2026-06" → "2026년 6월" */
export function yearMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}
