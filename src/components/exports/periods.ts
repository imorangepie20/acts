import { fiscalYearStart, type Period } from "@/lib/reports/fiscal";
import { monthRange } from "@/lib/vouchers/dates";

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar month before the one containing `today`. */
export function lastMonth(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  return monthRange(m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`);
}

/** The calendar quarter (Jan-Mar, Apr-Jun, ...) before the one containing `today`. */
export function lastQuarter(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const [year, firstMonth] = q === 0 ? [y - 1, 10] : [y, (q - 1) * 3 + 1];
  return { from: `${year}-${pad(firstMonth)}-01`, to: monthRange(`${year}-${pad(firstMonth + 2)}-01`).to };
}

/** Fiscal year start through `today`. */
export function yearToDate(today: string, startMonth: number): Period {
  return { from: fiscalYearStart(today, startMonth), to: today };
}
