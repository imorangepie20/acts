// Date helpers for the dashboard (pure, ISO `YYYY-MM-DD` / `YYYY-MM` strings, no time zones).

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `YYYY-MM` shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(t / 12), 4)}-${pad((t % 12) + 1)}`;
}

/** Last day of a `YYYY-MM` as `YYYY-MM-DD`. */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Every `YYYY-MM` from `from`'s month through `to`'s month. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The latest whole month on or before `asOf`: its own month when `asOf` is the month's last day, else the month before. */
export function lastCompletedMonth(asOf: string): string {
  const month = asOf.slice(0, 7);
  return monthEnd(month) === asOf ? month : addMonths(month, -1);
}

/** Saturday or Sunday moves to the next Monday (no holiday table). */
export function nextBusinessDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shift = day === 6 ? 2 : day === 0 ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d + shift)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}
