import { fail, ok, type Result } from "@/server/result";
import type { Cell } from "./types";

const norm = (c: Cell) => (c == null ? "" : String(c).replace(/\s/g, ""));

export function findHeader(
  grid: Cell[][],
  required: Record<string, string[]>,
  optional: Record<string, string[]>,
  scanRows = 20,
): Result<{ row: number; cols: Record<string, number[]> }> {
  const fields = { ...optional, ...required };
  let best: { row: number; missing: string[] } | null = null;
  for (let r = 0; r < Math.min(scanRows, grid.length); r++) {
    const cells = grid[r].map(norm);
    const cols: Record<string, number[]> = {};
    for (const [field, aliases] of Object.entries(fields)) {
      const wanted = aliases.map((a) => a.replace(/\s/g, ""));
      cols[field] = cells.flatMap((c, i) => (c && wanted.includes(c) ? [i] : []));
    }
    const missing = Object.keys(required).filter((f) => cols[f].length === 0);
    if (missing.length === 0) return ok({ row: r, cols });
    if (!best || missing.length < best.missing.length) best = { row: r, missing };
  }
  const missing = best?.missing ?? Object.keys(required);
  const names = missing.map((f) => required[f][0]);
  return fail(
    `필요한 열(${names.join(", ")})을 찾을 수 없습니다. 홈택스에서 내려받은 파일인지 확인하세요.`,
  );
}

export function parseWon(c: Cell): number | null {
  if (typeof c === "number") return Number.isInteger(c) ? c : null;
  if (typeof c !== "string") return null;
  const s = c.replace(/[,\s원]/g, "");
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

function realDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(c: Cell): string | null {
  // exceljs builds Dates from serials by treating the stored wall clock as UTC, so read the UTC fields.
  if (c instanceof Date) {
    return Number.isNaN(c.getTime()) ? null : realDate(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate());
  }
  const s = typeof c === "number" ? String(c) : typeof c === "string" ? c.trim() : "";
  const m =
    /^(\d{4})([-./])(\d{1,2})\2(\d{1,2})(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s) ??
    /^(\d{4})()(\d{2})(\d{2})(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  return m ? realDate(Number(m[1]), Number(m[3]), Number(m[4])) : null;
}

export function isBlankRow(cells: Cell[]): boolean {
  return cells.every((c) => c == null || (typeof c === "string" && c.trim() === ""));
}
