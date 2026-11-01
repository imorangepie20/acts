import { yearMonthLabel } from "@/lib/withholding/return-rows";
import type { ReturnFigures } from "@/lib/withholding/return";
import type { SheetSpec } from "@/server/exports/xlsx";
import type { ReturnView } from "./return-view";

type Row = SheetSpec["rows"][number];

/** Excel sheet of one 신고서: the computed rows (A01, A10, A99) and the 환급세액 조정 block. */
export function buildReturnSheet(f: ReturnFigures, companyName: string, fileName: string): SheetSpec {
  const item = (code: string, label: string): Row => ({
    code,
    label,
    people: f.a01.people,
    totalPaid: f.a01.totalPaid,
    incomeTax: f.a01.incomeTax,
    adjusted: code === "A01" ? null : f.refund.adjusted,
    payable: code === "A01" ? null : f.refund.payable,
  });
  const refund = (label: string, v: number): Row => ({ label, incomeTax: v });
  const rows: Row[] = [
    item("A01", "근로소득 간이세액"),
    item("A10", "근로소득 가감계"),
    item("A99", "총합계"),
    { label: "환급세액 조정" },
    refund("⑫ 전월 미환급세액", f.refund.carriedIn),
    refund("⑲ 당월조정 환급세액계", f.refund.adjusted),
    refund("⑳ 차월이월 환급세액", f.refund.carriedOut),
    { label: "지방소득세(위택스 신고용)", incomeTax: f.localTax },
  ];
  return {
    fileName,
    title: `귀속 ${f.attributionMonth} 지급 ${f.paymentMonth}`,
    meta: [
      "원천징수이행상황신고서 (별지 제21호서식)",
      companyName,
      `귀속연월: ${yearMonthLabel(f.attributionMonth)}`,
      `지급연월: ${yearMonthLabel(f.paymentMonth)}`,
      "이 프로그램은 근로소득 간이세액(A01)만 계산합니다. 나머지 소득구분은 직접 작성하세요.",
    ],
    columns: [
      { header: "코드", key: "code", width: 8 },
      { header: "구분", key: "label", width: 30 },
      { header: "④ 인원", key: "people", width: 10 },
      { header: "⑤ 총지급액", key: "totalPaid", width: 16, money: true },
      { header: "⑥ 소득세 등 / 금액", key: "incomeTax", width: 18, money: true },
      { header: "⑨ 당월 조정 환급세액", key: "adjusted", width: 18, money: true },
      { header: "⑩ 납부세액 소득세 등", key: "payable", width: 18, money: true },
    ],
    rows,
    emphasis: [1, 2, 3],
  };
}

/** One sheet per form of a view (monthly: per 귀속월 paid that month). */
export function buildReturnSheets(view: ReturnView): { fileName: string; sheets: SheetSpec[] } {
  const s = view.selection;
  const fileName =
    s.mode === "monthly"
      ? `원천징수이행상황신고서_${s.pay}`
      : `원천징수이행상황신고서_${s.year}_${s.half === 1 ? "상반기" : "하반기"}`;
  return { fileName, sheets: view.forms.map((f) => buildReturnSheet(f, view.company.name, fileName)) };
}
