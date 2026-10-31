/**
 * Converts the 국세청 근로소득 간이세액표 workbook (홈택스 → 세금신고 → 원천세 신고 → 근로소득 간이세액표(조견표), Excel)
 * into src/server/payroll/seed-data/withholding-<effective-from>.json.
 *
 *   pnpm tsx scripts/convert-withholding-table.ts <xlsx> <effective-from>
 *
 * Only the 제6호 table rows are converted. The over-10,000천원 lines, the 자녀 credit and the more-than-11 rule
 * are hand-entered from the [별표 2] text in src/server/payroll/seed-data/withholding.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Cell } from "../src/lib/imports/types";
import type { WithholdingRow } from "../src/lib/payroll/types";
import { readFirstSheet } from "../src/server/imports/read-xlsx";
import { fail, ok, type Result } from "../src/server/result";

const FAMILY_COUNT = 11;
/** The exact-10,000천원 row is printed as text and becomes the one-won band [10,000,000, 10,000,001). */
const TEN_MILLION_LABEL = /^10,?000천원$/;
const TEN_MILLION = 10_000_000;

const text = (c: Cell) => (typeof c === "string" ? c.replace(/\s+/g, "") : "");
const asInt = (c: Cell): number | null => {
  if (typeof c === "number") return Number.isInteger(c) && c >= 0 ? c : null;
  if (typeof c === "string" && /^\d{1,3}(,?\d{3})*$/.test(c.trim())) return Number(c.trim().replace(/,/g, ""));
  return null;
};

type Layout = { fromCol: number; toCol: number; taxCols: number[]; dataStart: number };

/** Finds the 이상/미만 columns and the 1..11 공제대상가족 columns in the header rows. */
function findLayout(grid: Cell[][]): Layout | null {
  const boundsRow = grid.findIndex((r) => r.some((c) => text(c) === "이상") && r.some((c) => text(c) === "미만"));
  if (boundsRow < 0) return null;
  const bounds = grid[boundsRow];
  const fromCol = bounds.findIndex((c) => text(c) === "이상");
  const toCol = bounds.findIndex((c) => text(c) === "미만");
  for (let r = boundsRow; r >= 0; r--) {
    const row = grid[r];
    const taxCols: number[] = [];
    for (let n = 1; n <= FAMILY_COUNT; n++) {
      const col = row.findIndex((c, i) => i !== fromCol && i !== toCol && (c === n || text(c) === String(n)));
      if (col < 0) break;
      taxCols.push(col);
    }
    if (taxCols.length === FAMILY_COUNT) return { fromCol, toCol, taxCols, dataStart: boundsRow + 1 };
  }
  return null;
}

/** A tax cell: an integer as printed, "-" for none. A blank or formula without a cached value is refused. */
function taxValue(c: Cell): number | null {
  if (typeof c === "string" && c.trim() === "-") return 0;
  return asInt(c);
}

export function convertWithholdingGrid(grid: Cell[][]): Result<WithholdingRow[]> {
  const layout = findLayout(grid);
  if (!layout) return fail("이상/미만과 공제대상가족 1~11 머리글을 찾지 못했습니다.");
  const rows: WithholdingRow[] = [];
  for (let r = layout.dataStart; r < grid.length; r++) {
    const row = grid[r];
    const fromCell = row[layout.fromCol] ?? null;
    let from: number;
    let to: number;
    if (TEN_MILLION_LABEL.test(text(fromCell))) {
      from = TEN_MILLION;
      to = TEN_MILLION + 1;
    } else {
      const f = asInt(fromCell);
      const t = asInt(row[layout.toCol] ?? null);
      if (f == null || t == null) continue; // 초과 lines are formulas in words, entered by hand
      if (t <= f) return fail(`${r + 1}행: 미만이 이상보다 크지 않습니다.`);
      from = f * 1000;
      to = t * 1000;
    }
    const tax: number[] = [];
    for (const col of layout.taxCols) {
      const v = taxValue(row[col] ?? null);
      if (v == null) return fail(`${r + 1}행: 세액 칸을 읽지 못했습니다.`);
      tax.push(v);
    }
    const prev = rows.at(-1);
    if (prev && prev.to !== from) return fail(`${r + 1}행: 앞 구간(${prev.to}원)과 이어지지 않습니다.`);
    rows.push({ from, to, tax });
  }
  if (rows.length === 0) return fail("세액표 행이 없습니다.");
  return ok(rows);
}

export async function convertWithholdingWorkbook(bytes: Uint8Array): Promise<Result<WithholdingRow[]>> {
  const grid = await readFirstSheet(bytes);
  if (!grid.ok) return grid;
  return convertWithholdingGrid(grid.value);
}

async function main() {
  const [file, effectiveFrom] = process.argv.slice(2);
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? "")) {
    console.error("usage: pnpm tsx scripts/convert-withholding-table.ts <xlsx> <YYYY-MM-DD>");
    process.exit(1);
  }
  const r = await convertWithholdingWorkbook(new Uint8Array(readFileSync(file)));
  if (!r.ok) throw new Error(r.error);
  const last = r.value.at(-1)!;
  if (last.from !== TEN_MILLION) throw new Error("the 10,000천원 row is missing");
  const out = resolve(__dirname, `../src/server/payroll/seed-data/withholding-${effectiveFrom}.json`);
  const json = { effectiveFrom, source: basename(file), rows: r.value };
  // One row per line keeps the diff of a new revision readable.
  const body = `{\n  "effectiveFrom": ${JSON.stringify(json.effectiveFrom)},\n  "source": ${JSON.stringify(json.source)},\n  "rows": [\n${json.rows
    .map((row) => `    ${JSON.stringify(row)}`)
    .join(",\n")}\n  ]\n}\n`;
  writeFileSync(out, body);
  console.log(`wrote ${r.value.length} rows to ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
