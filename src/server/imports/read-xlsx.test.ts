import ExcelJS from "exceljs";
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

  it("rejects a CSV as the wrong type", async () => {
    const r = await readFirstSheet(new TextEncoder().encode("a,b\n1,2\n"));
    expect(r).toEqual({
      ok: false,
      error:
        "엑셀(.xlsx) 파일만 올릴 수 있습니다. 엑셀에서 'Excel 통합 문서(.xlsx)'로 저장한 뒤 올려 주세요.",
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
