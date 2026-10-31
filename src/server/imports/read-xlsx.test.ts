import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { readFirstSheet } from "./read-xlsx";

async function book(fill: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  fill(wb.addWorksheet("s"));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("readFirstSheet", () => {
  it("returns values, cached formula results and flattened rich text", async () => {
    const bytes = await book((ws) => {
      ws.addRow(["a", 2, new Date(Date.UTC(2026, 9, 15))]);
      ws.getCell("A2").value = { formula: "1+2", result: 3 };
      ws.getCell("B2").value = { richText: [{ text: "리치" }, { text: "텍스트" }] };
    });
    const r = await readFirstSheet(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0].slice(0, 2)).toEqual(["a", 2]);
    expect(r.value[0][2]).toBeInstanceOf(Date);
    expect(r.value[1].slice(0, 2)).toEqual([3, "리치텍스트"]);
  });

  it("keeps columns right of blank columns and sheets that start at column B", async () => {
    const bytes = await book((ws) => {
      ws.getCell("B1").value = "head";
      ws.getCell("E1").value = "amount";
      ws.getCell("B2").value = "x";
      ws.getCell("E2").value = 100;
      ws.getCell("H2").value = "far";
    });
    const r = await readFirstSheet(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0][1]).toBe("head");
    expect(r.value[0][4]).toBe("amount");
    expect(r.value[1][4]).toBe(100);
    expect(r.value[1][7]).toBe("far");
  });

  it("reads a legacy .xls (BIFF8) workbook, dates as UTC wall clock", async () => {
    const ws = XLSX.utils.aoa_to_sheet(
      [
        ["매입 전자세금계산서 목록"],
        [],
        ["작성일자", "상호", "공급가액"],
        [new Date(Date.UTC(2026, 9, 15)), "공급사", 1000000],
      ],
      { UTC: true },
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "s");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["다른 시트"]]), "t");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "biff8" }));
    const r = await readFirstSheet(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(3); // the blank row is dropped
    expect(r.value[0][0]).toBe("매입 전자세금계산서 목록");
    expect(r.value[1]).toEqual(["작성일자", "상호", "공급가액"]);
    const d = r.value[2][0];
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(r.value[2].slice(1)).toEqual(["공급사", 1000000]);
  });

  it("reads an HTML table saved with an .xls name, keeping text as written", async () => {
    const html =
      "﻿<html><body><table><tr><td>작성일자</td><td>공급가액</td><td>승인번호</td></tr>" +
      "<tr><td>2026-10-15</td><td>1,000,000</td><td>20261015-0001</td></tr></table></body></html>";
    const r = await readFirstSheet(new TextEncoder().encode(html));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      ["작성일자", "공급가액", "승인번호"],
      ["2026-10-15", "1,000,000", "20261015-0001"],
    ]);
  });

  it("rejects a CSV as the wrong type", async () => {
    const r = await readFirstSheet(new TextEncoder().encode("a,b\n1,2\n"));
    expect(r).toEqual({
      ok: false,
      error: "엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다. 홈택스에서 내려받은 파일을 그대로 올려 주세요.",
    });
  });

  it("rejects far too many rows", async () => {
    const bytes = await book((ws) => {
      for (let i = 0; i < 1101; i++) ws.addRow([i + 1]);
    });
    expect(await readFirstSheet(bytes)).toEqual({
      ok: false,
      error: "한 번에 1,000건까지 불러올 수 있습니다.",
    });
  });
});
