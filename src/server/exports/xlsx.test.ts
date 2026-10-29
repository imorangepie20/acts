import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderXlsx, type SheetSpec } from "./xlsx";

const spec: SheetSpec = {
  fileName: "테스트",
  title: "합계잔액시산표",
  meta: ["(주)에이씨티", "기준일: 2026-10-30"],
  columns: [
    { header: "계정과목", key: "name", width: 20 },
    { header: "금액", key: "amount", width: 14, money: true },
  ],
  rows: [
    { name: "101 현금", amount: 1234567 },
    { name: "합계", amount: -5000 },
  ],
  emphasis: [1],
};

async function read(s: SheetSpec) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await renderXlsx(s)) as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

describe("renderXlsx", () => {
  it("writes title, meta, header and numeric money cells", async () => {
    const ws = await read(spec);
    expect(ws.name).toBe("합계잔액시산표");
    expect(ws.getCell("A1").value).toBe("합계잔액시산표");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A2").value).toBe("(주)에이씨티");
    expect(ws.getCell("A3").value).toBe("기준일: 2026-10-30");
    // row 4 blank, row 5 header
    expect(ws.getCell("A5").value).toBe("계정과목");
    expect(ws.getCell("A5").font?.bold).toBe(true);
    const money = ws.getCell("B6");
    expect(typeof money.value).toBe("number");
    expect(money.value).toBe(1234567);
    expect(money.numFmt).toBe("#,##0;-#,##0");
    expect(ws.getCell("B7").value).toBe(-5000);
    expect(ws.getCell("A7").font?.bold).toBe(true);
    expect(ws.getCell("A6").font?.bold).toBeFalsy();
  });

  it("freezes the header row", async () => {
    const ws = await read(spec);
    const view = ws.views[0];
    expect(view.state).toBe("frozen");
    expect((view as { ySplit?: number }).ySplit).toBe(5);
  });

  it("truncates the sheet name to 31 characters", async () => {
    const ws = await read({ ...spec, title: "가".repeat(40) });
    expect(ws.name).toBe("가".repeat(31));
  });

  it("leaves null money cells empty", async () => {
    const ws = await read({ ...spec, rows: [{ name: "x", amount: null }] });
    expect(ws.getCell("B6").value).toBeNull();
  });
});
