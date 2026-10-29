import { isIsoDate } from "@/lib/vouchers/dates";
import { defaultPeriod, fiscalYearStart } from "./fiscal";
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
  let from: string;
  let to: string;
  if (isIsoDate(f) && isIsoDate(t)) {
    [from, to] = f <= t ? [f, t] : [t, f];
  } else if (isIsoDate(t)) {
    to = t;
    from = fiscalYearStart(t, startMonth);
  } else if (isIsoDate(f)) {
    from = f;
    to = f > today ? f : today;
  } else {
    ({ from, to } = def);
  }
  return { from, to, siteId: positiveInt(first(sp.site)), departmentId: positiveInt(first(sp.dept)) };
}

/** `/api/exports/<report>` link for the current filters; `extra` carries account/partner (empty values are dropped). */
export function exportHref(report: string, f: ReportFilter, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (f.siteId !== null) q.set("site", String(f.siteId));
  if (f.departmentId !== null) q.set("dept", String(f.departmentId));
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return `/api/exports/${report}?${q.toString()}`;
}
