import { isIsoDate } from "@/lib/vouchers/dates";
import { defaultPeriod } from "./fiscal";
import type { ReportFilter } from "./types";

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function positiveInt(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseReportParams(sp: SearchParams, today: string, startMonth: number): ReportFilter {
  const def = defaultPeriod(today, startMonth);
  const f = first(sp.from);
  const t = first(sp.to);
  let from = isIsoDate(f) ? f : def.from;
  let to = isIsoDate(t) ? t : def.to;
  if (from > to) [from, to] = [to, from];
  return { from, to, siteId: positiveInt(first(sp.site)), departmentId: positiveInt(first(sp.dept)) };
}
