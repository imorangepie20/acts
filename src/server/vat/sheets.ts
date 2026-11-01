import { formatBusinessNumber } from "@/lib/business-number";
import { formatWon } from "@/lib/money";
import {
  CARD_DETAIL_ROWS,
  cardOverflowNotice,
  E_FILING_BASIS,
  INVOICE_DETAIL_ROWS,
  invoiceOverflowNotice,
  isByIndustryRow,
  PAYABLE_LABEL,
  REFUND_LABEL,
  sortedCardDetail,
  vatCells,
} from "@/lib/vat/cells";
import {
  BY_INDUSTRY_NOTICE,
  BY_REASON_NOTICE,
  EMPTY_VAT_NOTICE,
  ENTER_DIRECTLY,
  purchasesWithoutBusinessNumberNotice,
  taxDiffNotice,
  VAT_SOURCE_NOTICE,
  ZERO_ASSUMED_NOTICE,
} from "@/lib/vat/notices";
import { PAGE1_GROUPS, PAGE4_GROUPS, type VatRowGroup } from "@/lib/vat/rows";
import type { InvoiceSummary, PartnerTally, PurchaseWithoutBusinessNumber, Tally } from "@/lib/vat/types";
import { NOT_COMPUTED_TEXT } from "@/lib/withholding/return-rows";
import type { SheetSpec } from "@/server/exports/xlsx";
import type { VatView } from "./view";

type Row = SheetSpec["rows"][number];

const kindLabel = (k: "prelim" | "final") => (k === "prelim" ? "예정" : "확정");

function formSheet(view: VatView, fileName: string, meta: string[]): SheetSpec {
  const { result } = view;
  const rows: Row[] = [];
  const emphasis: number[] = [];
  const groups = (list: VatRowGroup[]) => {
    for (const g of list) {
      if (g.rows.length > 1) {
        emphasis.push(rows.length);
        rows.push({ label: g.label });
      }
      for (const r of g.rows) {
        const { amount, tax } = vatCells(r, result.rows);
        const notes: string[] = [];
        const diff = result.taxDiff.get(r.no as 1 | 2 | 3 | 4);
        if (diff !== undefined) notes.push(taxDiffNotice(diff));
        if (r.no === 30) {
          notes.push(ZERO_ASSUMED_NOTICE);
          if (typeof tax === "number" && tax < 0) notes.push(REFUND_LABEL);
        }
        if (r.no === 53) notes.push(BY_REASON_NOTICE);
        if (r.no === 57) notes.push(E_FILING_BASIS);
        const byIndustry = isByIndustryRow(r.no);
        rows.push({
          no: `(${r.no})`,
          label: r.label || null,
          amount: byIndustry ? BY_INDUSTRY_NOTICE : amount,
          rate: r.rate ?? null,
          tax,
          note: notes.join(" / ") || null,
        });
        if (r.no === 18) {
          emphasis.push(rows.length);
          rows.push({ no: null, label: PAYABLE_LABEL, tax: result.payable });
        }
      }
    }
  };
  emphasis.push(rows.length);
  rows.push({ label: "제1쪽 신고내용·과세표준명세" });
  groups(PAGE1_GROUPS);
  emphasis.push(rows.length);
  rows.push({ label: "제4쪽 명세" });
  groups(PAGE4_GROUPS);
  return {
    fileName,
    title: "신고서",
    meta: ["일반과세자 부가가치세 신고서 (별지 제21호서식)", ...meta],
    columns: [
      { header: "칸", key: "no", width: 7 },
      { header: "구분", key: "label", width: 44 },
      { header: "금액", key: "amount", width: 18, money: true },
      { header: "세율", key: "rate", width: 12 },
      { header: "세액", key: "tax", width: 18, money: true },
      { header: "비고", key: "note", width: 40 },
    ],
    rows,
    emphasis,
  };
}

const partnerRow = (label: string, t: PartnerTally): Row => ({
  label,
  partners: t.partners,
  count: t.count,
  supplyAmount: t.supplyAmount,
  vatAmount: t.vatAmount,
});

function invoiceSheet(
  title: string,
  side: "매출처" | "매입처",
  s: InvoiceSummary,
  fileName: string,
  meta: string[],
  withoutBn: PurchaseWithoutBusinessNumber[] = [],
): SheetSpec {
  const issued = side === "매입처" ? "발급받은 분" : "발급분";
  const rows: Row[] = [
    partnerRow("합계", s.total),
    partnerRow(`전자 ${issued} 사업자등록번호 ${issued}`, s.electronic.bn),
    partnerRow(`전자 ${issued} 주민등록번호 ${issued}`, s.electronic.rrn),
    partnerRow(`전자 ${issued} 소계`, s.electronic.subtotal),
    partnerRow(`전자 외 ${issued} 사업자등록번호 ${issued}`, s.other.bn),
    partnerRow(`전자 외 ${issued} 주민등록번호 ${issued}`, s.other.rrn),
    partnerRow(`전자 외 ${issued} 소계`, s.other.subtotal),
    { label: `전자 외 ${issued} ${side}별 명세 (사업자등록번호 ${issued})` },
    ...s.otherByPartner.map(
      (p, i): Row => ({
        label: String(i + 1),
        businessNumber: formatBusinessNumber(p.businessNumber),
        name: p.name,
        count: p.count,
        supplyAmount: p.supplyAmount,
        vatAmount: p.vatAmount,
      }),
    ),
    ...(s.otherByPartner.length > INVOICE_DETAIL_ROWS ? [{ label: invoiceOverflowNotice }] : []),
  ];
  const emphasis = [0, 7];
  if (withoutBn.length > 0) {
    emphasis.push(rows.length);
    rows.push({ label: purchasesWithoutBusinessNumberNotice(withoutBn.length) });
    for (const v of withoutBn) rows.push({ label: `${v.voucherNo} (${v.date})`, name: v.partnerName });
  }
  return {
    fileName,
    title,
    meta: [`${side}별 세금계산서합계표(갑)`, ...meta],
    columns: [
      { header: "구분 / 번호", key: "label", width: 36 },
      { header: "사업자등록번호", key: "businessNumber", width: 16 },
      { header: "상호", key: "name", width: 26 },
      { header: `${side}수`, key: "partners", width: 10 },
      { header: "매수", key: "count", width: 10 },
      { header: "공급가액", key: "supplyAmount", width: 16, money: true },
      { header: "세액", key: "vatAmount", width: 16, money: true },
    ],
    rows,
    emphasis,
  };
}

const tallyRow = (label: string, t: Tally): Row => ({
  label,
  count: t.count,
  supplyAmount: t.supplyAmount,
  vatAmount: t.vatAmount,
});

function cardSheet(view: VatView, fileName: string, meta: string[]): SheetSpec {
  const c = view.result.card;
  const detail = sortedCardDetail(c.otherDetail);
  const rows: Row[] = [
    tallyRow("④ 합계", c.total),
    tallyRow("⑤ 현금영수증", c.cashReceipt),
    { label: "⑥ 화물운전자복지카드", count: NOT_COMPUTED_TEXT, supplyAmount: NOT_COMPUTED_TEXT, vatAmount: NOT_COMPUTED_TEXT },
    tallyRow("⑦ 사업용 신용카드", c.businessCard),
    tallyRow("⑧ 그 밖의 신용카드 등", c.otherCard),
    { label: "⑧ 그 밖의 신용카드 등 명세" },
    ...detail.map(
      (d, i): Row => ({
        label: String(i + 1),
        cardNo: d.cardNo ?? ENTER_DIRECTLY,
        businessNumber: d.businessNumber ? formatBusinessNumber(d.businessNumber) : null,
        count: d.count,
        supplyAmount: d.supplyAmount,
        vatAmount: d.vatAmount,
      }),
    ),
    ...(detail.length > CARD_DETAIL_ROWS ? [{ label: cardOverflowNotice }] : []),
  ];
  return {
    fileName,
    title: "신용카드 수령명세서",
    meta: ["신용카드매출전표등 수령명세서(갑)", ...meta],
    columns: [
      { header: "구분 / 일련번호", key: "label", width: 26 },
      { header: "카드회원번호", key: "cardNo", width: 24 },
      { header: "가맹점 사업자등록번호", key: "businessNumber", width: 20 },
      { header: "거래건수", key: "count", width: 10 },
      { header: "공급가액", key: "supplyAmount", width: 16, money: true },
      { header: "세액", key: "vatAmount", width: 16, money: true },
    ],
    rows,
    emphasis: [0, 5],
  };
}

/** The 부가세 신고 자료 workbook; built even for an empty period (every table then shows 0). */
export function buildVatSheets(view: VatView): { fileName: string; sheets: SheetSpec[] } {
  const s = view.selection;
  const fileName = `부가세신고자료_${s.year}_${s.term}기_${kindLabel(s.kind)}`;
  const meta = [
    view.company.name,
    `${s.year}년 제${s.term}기 ${kindLabel(s.kind)}신고: ${view.period.from} ~ ${view.period.to}`,
    `대상 전표 ${formatWon(view.result.entryCount)}건`,
    ...(view.result.entryCount === 0 ? [EMPTY_VAT_NOTICE] : []),
    VAT_SOURCE_NOTICE,
  ];
  return {
    fileName,
    sheets: [
      formSheet(view, fileName, meta),
      invoiceSheet("매출처별 합계표", "매출처", view.result.sales, fileName, meta),
      invoiceSheet("매입처별 합계표", "매입처", view.result.purchases, fileName, meta, view.result.purchasesWithoutBusinessNumber),
      cardSheet(view, fileName, meta),
    ],
  };
}
