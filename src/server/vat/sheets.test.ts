import { describe, expect, it } from "vitest";
import { buildVatReturn } from "@/lib/vat/return";
import type { VatSelection } from "@/lib/vat/periods";
import type { VatEntry } from "@/lib/vat/types";
import { cardOverflowNotice, invoiceOverflowNotice } from "@/lib/vat/cells";
import { ENTER_DIRECTLY, purchasesWithoutBusinessNumberNotice } from "@/lib/vat/notices";
import { NOT_COMPUTED_TEXT } from "@/lib/withholding/return-rows";
import { buildVatSheets } from "./sheets";
import type { VatView } from "./view";

const entry = (over: Partial<VatEntry>): VatEntry => ({
  voucherId: "v",
  voucherNo: "20030101-0001",
  date: "2003-01-01",
  entryType: "purchase",
  evidenceType: "tax_invoice",
  vatType: "taxable",
  vatDeductible: true,
  supplyAmount: 0,
  vatAmount: 0,
  fixedAsset: false,
  paperTaxInvoice: false,
  unregisteredCard: false,
  businessNumber: "1234567890",
  partnerName: "거래처",
  partnerKey: "1234567890",
  cardNo: null,
  ...over,
});

const selection: VatSelection = {
  year: 2003,
  term: 1,
  kind: "prelim",
  prelimFiled: true,
  efile: true,
  prelimRefund: 0,
  notice: 0,
  errors: {},
};

function view(entries: VatEntry[]): VatView {
  return {
    selection,
    period: { from: "2003-01-01", to: "2003-03-31" },
    company: { name: "회사", businessNumber: "1234567890", representative: "대표", businessType: "corporation" },
    result: buildVatReturn(entries, selection),
  };
}

describe("buildVatSheets", () => {
  it("four sheets with the form's row numbers", () => {
    const { fileName, sheets } = buildVatSheets(
      view([
        entry({ entryType: "sale", supplyAmount: 1_000_000, vatAmount: 100_000 }),
        entry({ supplyAmount: 300_000, vatAmount: 30_000 }),
      ]),
    );
    expect(fileName).toBe("부가세신고자료_2003_1기_예정");
    expect(sheets.map((s) => s.title)).toEqual(["신고서", "매출처별 합계표", "매입처별 합계표", "신용카드 수령명세서"]);
    const form = sheets[0];
    const byNo = (no: string) => form.rows.find((r) => r.no === no);
    expect(byNo("(15)")).toBeDefined();
    expect(byNo("(17)")).toBeDefined();
    expect(byNo("(30)")).toMatchObject({ tax: 70_000 });
    expect(byNo("(1)")).toMatchObject({ amount: 1_000_000, tax: 100_000 });
    expect(byNo("(2)")?.tax).toBe(NOT_COMPUTED_TEXT);
    expect(byNo("(10)")).toMatchObject({ amount: 300_000, tax: 30_000 });
  });

  it("합계표 sheet lists 전자 외 partners", () => {
    const { sheets } = buildVatSheets(
      view([entry({ paperTaxInvoice: true, businessNumber: "2208162517", partnerKey: "2208162517", partnerName: "종이상사", supplyAmount: 50_000, vatAmount: 5_000 })]),
    );
    const purchases = sheets[2];
    expect(purchases.rows).toContainEqual(
      expect.objectContaining({ businessNumber: "220-81-62517", name: "종이상사", count: 1, supplyAmount: 50_000, vatAmount: 5_000 }),
    );
  });

  it("매입처별 sheet lists 세금계산서 without a business number", () => {
    const { sheets } = buildVatSheets(
      view([
        entry({ businessNumber: null, partnerKey: "none", voucherNo: "20030115-0002", date: "2003-01-15", partnerName: "무번호" }),
        entry({ entryType: "sale", businessNumber: null, partnerKey: "none", voucherNo: "20030116-0001" }),
      ]),
    );
    const [, sales, purchases] = sheets;
    const text = (rows: typeof purchases.rows) => rows.map((r) => Object.values(r).join(" "));
    const notice = purchasesWithoutBusinessNumberNotice(1);
    expect(notice).toBe("사업자등록번호가 없는 매입 세금계산서 1건 — 거래처 정보를 확인하세요");
    expect(text(purchases.rows)).toContainEqual(expect.stringContaining(notice));
    expect(text(purchases.rows)).toContainEqual(expect.stringMatching(/20030115-0002.*2003-01-15.*무번호/));
    expect(purchases.emphasis).toContain(purchases.rows.findIndex((r) => r.label === notice));
    expect(text(sales.rows).join(" | ")).not.toContain("20030116-0001");
    expect(text(sales.rows).join(" | ")).not.toContain("사업자등록번호가 없는");
  });

  it("합계표 sheets with 6+ 전자 외 partners end with the (을) notice row, emphasised", () => {
    const paper = (entryType: "sale" | "purchase", i: number) => {
      const bn = `22081625${String(i).padStart(2, "0")}`;
      return entry({ entryType, paperTaxInvoice: true, businessNumber: bn, partnerKey: bn, supplyAmount: 1000, vatAmount: 100 });
    };
    const entries = [1, 2, 3, 4, 5, 6].flatMap((i) => [paper("sale", i), paper("purchase", i)]);
    const { sheets } = buildVatSheets(view(entries));
    for (const sheet of [sheets[1], sheets[2]]) {
      const at = sheet.rows.findIndex((r) => r.label === invoiceOverflowNotice);
      expect(at).toBe(sheet.rows.length - 1);
      expect(sheet.emphasis).toContain(at);
    }
    // five partners: no notice
    const five = buildVatSheets(view(entries.filter((e) => e.businessNumber !== "2208162506"))).sheets;
    expect(five[1].rows.some((r) => r.label === invoiceOverflowNotice)).toBe(false);
  });

  it("card sheet: ⑥ not computed, 직접 입력, sorted ⑧ rows and the overflow row", () => {
    const card = (cardNo: string | null, businessNumber: string | null) =>
      entry({ evidenceType: "card", unregisteredCard: true, cardNo, businessNumber, partnerKey: businessNumber ?? "none", supplyAmount: 1000, vatAmount: 100 });
    const small = buildVatSheets(
      view([card("2222", "3333333333"), card(null, "1111111111"), card("1111", null), card("1111", "2222222222"), card("1111", "1111111111")]),
    ).sheets[3];
    expect(small.rows.find((r) => r.label === "⑥ 화물운전자복지카드")).toMatchObject({
      count: NOT_COMPUTED_TEXT,
      supplyAmount: NOT_COMPUTED_TEXT,
      vatAmount: NOT_COMPUTED_TEXT,
    });
    const detail = small.rows.slice(small.rows.findIndex((r) => r.label === "⑧ 그 밖의 신용카드 등 명세") + 1);
    expect(detail.map((r) => [r.cardNo, r.businessNumber])).toEqual([
      ["1111", "111-11-11111"],
      ["1111", "222-22-22222"],
      ["1111", null],
      ["2222", "333-33-33333"],
      [ENTER_DIRECTLY, "111-11-11111"],
    ]);
    expect(small.rows.some((r) => r.label === cardOverflowNotice)).toBe(false);

    const many = buildVatSheets(view(Array.from({ length: 16 }, (_, i) => card(String(1000 + i), null)))).sheets[3];
    const at = many.rows.findIndex((r) => r.label === cardOverflowNotice);
    expect(at).toBe(many.rows.length - 1);
    expect(many.emphasis).toContain(at);
  });

  it("a period with no entries still builds the four sheets", () => {
    const { sheets } = buildVatSheets(view([]));
    expect(sheets.map((s) => s.title)).toEqual(["신고서", "매출처별 합계표", "매입처별 합계표", "신용카드 수령명세서"]);
    expect(sheets[0].meta).toContain("이 기간에 승인된 매입·매출 전표가 없습니다.");
    expect(sheets[2].rows.some((r) => typeof r.label === "string" && r.label.includes("사업자등록번호가 없는"))).toBe(false);
  });
});
