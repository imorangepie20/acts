import ExcelJS from "exceljs";
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

export async function readFirstSheet(bytes: Uint8Array): Promise<Result<Cell[][]>> {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    return fail(ERR_WRONG_FILE_TYPE);
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return fail(ERR_WRONG_FILE_TYPE);
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(ERR_WRONG_FILE_TYPE);

  // Only non-blank rows, in order: the parsers need no row positions, and sparse sheets stay cheap.
  const grid: Cell[][] = [];
  const width = ws.actualColumnCount;
  let tooMany = false;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (tooMany) return;
    const cells: Cell[] = [];
    for (let c = 1; c <= width; c++) cells.push(toCell(row.getCell(c).value));
    if (isBlankRow(cells)) return;
    if (grid.length >= GUARD_ROWS) tooMany = true;
    else grid.push(cells);
  });
  return tooMany ? fail(ERR_TOO_MANY_ROWS) : ok(grid);
}
