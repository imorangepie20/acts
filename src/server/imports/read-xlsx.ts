import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { fail, ok, type Result } from "@/server/result";
import { isBlankRow } from "@/lib/imports/sheet";
import {
  ERR_TOO_MANY_ROWS,
  ERR_WRONG_FILE_TYPE,
  MAX_IMPORT_ROWS,
  type Cell,
} from "@/lib/imports/types";

/** Cheap guard only: title, header and 합계 rows sit outside the data rows; parsers enforce the exact cap. */
const GUARD_ROWS = MAX_IMPORT_ROWS + 100;

const startsWith = (bytes: Uint8Array, sig: number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** OLE2 compound file: legacy .xls (BIFF8). */
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Web exports often send an HTML table under an .xls name. */
function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart();
  return /^<(!doctype|html|table|meta|head|body|\?xml)/i.test(head);
}

function toCell(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || v instanceof Date) return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if ("result" in o) return toCell(o.result); // formula: cached result only, never evaluated
    if ("formula" in o || "sharedFormula" in o || "error" in o) return null;
    if ("text" in o) return toCell(o.text); // hyperlink
  }
  return null;
}

/** Drops blank rows, applies the row guard, and pads to a rectangle. */
function finish(rows: Cell[][]): Result<Cell[][]> {
  const grid = rows.filter((r) => !isBlankRow(r));
  if (grid.length > GUARD_ROWS) return fail(ERR_TOO_MANY_ROWS);
  const maxWidth = grid.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of grid) while (r.length < maxWidth) r.push(null);
  return ok(grid);
}

async function readXlsx(bytes: Uint8Array): Promise<Result<Cell[][]>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return fail(ERR_WRONG_FILE_TYPE);
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(ERR_WRONG_FILE_TYPE);

  // Only non-blank rows, in order: the parsers need no row positions, and sparse sheets stay cheap.
  const rows: Cell[][] = [];
  let tooMany = false;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (tooMany) return;
    // Highest used column index of this row (not the count of used columns).
    const width = row.cellCount;
    const cells: Cell[] = [];
    for (let c = 1; c <= width; c++) cells.push(toCell(row.getCell(c).value));
    if (isBlankRow(cells)) return;
    if (rows.length >= GUARD_ROWS) tooMany = true;
    else rows.push(cells);
  });
  if (tooMany) return fail(ERR_TOO_MANY_ROWS);
  return finish(rows);
}

/** Excel serial day to a Date whose UTC fields are the stored wall clock (as exceljs yields). */
function serialToDate(serial: number, date1904: boolean): Date {
  return new Date(Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86_400_000));
}

/** Legacy .xls and HTML tables, via SheetJS; text stays as written (raw), formulas are not evaluated. */
function readLegacy(bytes: Uint8Array): Result<Cell[][]> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array", sheets: 0, raw: true, cellNF: true, cellFormula: false, cellHTML: false });
  } catch {
    return fail(ERR_WRONG_FILE_TYPE);
  }
  const ws = wb.SheetNames.length ? wb.Sheets[wb.SheetNames[0]] : undefined;
  if (!ws?.["!ref"]) return fail(ERR_WRONG_FILE_TYPE);
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const rows: Cell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: Cell[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null) cells.push(null);
      else if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
        cells.push(serialToDate(cell.v as number, date1904));
      } else if (cell.t === "e") cells.push(null);
      else cells.push(toCell(cell.v));
    }
    while (cells.length && cells[cells.length - 1] == null) cells.pop();
    if (isBlankRow(cells)) continue;
    if (rows.length >= GUARD_ROWS) return fail(ERR_TOO_MANY_ROWS);
    rows.push(cells);
  }
  return finish(rows);
}

export async function readFirstSheet(bytes: Uint8Array): Promise<Result<Cell[][]>> {
  if (startsWith(bytes, ZIP)) return readXlsx(bytes);
  if (startsWith(bytes, OLE) || looksLikeHtml(bytes)) return readLegacy(bytes);
  return fail(ERR_WRONG_FILE_TYPE);
}
