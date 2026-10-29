const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** First day of the fiscal year containing `date` (YYYY-MM-DD). */
export function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = date.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${pad(year, 4)}-${pad(startMonth)}-01`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Shifts by whole years; Feb 29 clamps to Feb 28 in non-leap years. */
export function shiftYear(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const ny = y + years;
  const last = new Date(Date.UTC(ny, m, 0)).getUTCDate();
  return `${pad(ny, 4)}-${pad(m)}-${pad(Math.min(d, last))}`;
}

export type Period = { from: string; to: string };

export function priorYearPeriod(p: Period): Period {
  return { from: shiftYear(p.from, -1), to: shiftYear(p.to, -1) };
}

export function defaultPeriod(today: string, startMonth: number): Period {
  return { from: fiscalYearStart(today, startMonth), to: today };
}
