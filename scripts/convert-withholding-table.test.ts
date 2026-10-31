import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { convertWithholdingWorkbook } from "./convert-withholding-table";

const FAMILY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

async function book(fill: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  fill(wb.addWorksheet("Sheet1"));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Laid out like the 홈택스 workbook: title, (단위: 원) note, a merged-looking header, 이상/미만. */
function header(ws: ExcelJS.Worksheet) {
  ws.addRow(["2024년 근로소득에 대한 간이세액표(제189조 관련)"]);
  ws.addRow(["(단위: 원)"]);
  ws.addRow(["월급여액(천원)", "월급여액(천원)", ...FAMILY.map(() => "공제대상가족의 수")]);
  ws.addRow(["월급여액(천원)", "월급여액(천원)", ...FAMILY]);
  ws.addRow(["이상", "미만"]);
}

describe("convertWithholdingWorkbook", () => {
  it("converts the bands to won and keeps the tax values as printed", async () => {
    const bytes = await book((ws) => {
      header(ws);
      ws.addRow([1060, 1065, 1040, "-", 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      ws.addRow([1065, 1070, 1110, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      ws.addRow([1070, 1075, 1180, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
    const r = await convertWithholdingWorkbook(bytes);
    expect(r).toEqual({
      ok: true,
      value: [
        { from: 1_060_000, to: 1_065_000, tax: [1040, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { from: 1_065_000, to: 1_070_000, tax: [1110, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { from: 1_070_000, to: 1_075_000, tax: [1180, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ],
    });
  });

  it("turns the exact 10,000천원 row into a one-won band and skips the 초과 formula rows", async () => {
    const bytes = await book((ws) => {
      header(ws);
      ws.addRow([9980, 10000, ...FAMILY.map((n) => 1_000_000 - n)]);
      ws.addRow(["10,000천원", "10,000천원", ...FAMILY.map((n) => 2_000_000 - n)]);
      ws.addRow(["10,000천원 초과\n14,000천원 이하", "", ...FAMILY.map(() => "(10,000천원인 경우의 해당 세액) + …")]);
    });
    const r = await convertWithholdingWorkbook(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(2);
    expect(r.value[1]).toEqual({
      from: 10_000_000,
      to: 10_000_001,
      tax: FAMILY.map((n) => 2_000_000 - n),
    });
  });

  it("refuses a blank tax cell instead of reading it as 0", async () => {
    const bytes = await book((ws) => {
      header(ws);
      ws.addRow([1060, 1065, 1040, null, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
    const r = await convertWithholdingWorkbook(bytes);
    expect(r.ok).toBe(false);
  });

  it("refuses bands that are not contiguous", async () => {
    const bytes = await book((ws) => {
      header(ws);
      ws.addRow([1060, 1065, ...FAMILY.map(() => 0)]);
      ws.addRow([1070, 1075, ...FAMILY.map(() => 0)]);
    });
    const r = await convertWithholdingWorkbook(bytes);
    expect(r.ok).toBe(false);
  });

  it("refuses a sheet without the 이상/미만 and 1..11 headers", async () => {
    const bytes = await book((ws) => {
      ws.addRow(["something else"]);
      ws.addRow([1060, 1065, ...FAMILY.map(() => 0)]);
    });
    const r = await convertWithholdingWorkbook(bytes);
    expect(r.ok).toBe(false);
  });
});
