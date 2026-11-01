// Period comparisons for the dashboard KPI cards.

/**
 * Change of `current` against `previous` in percent, rounded to one decimal.
 * null when there is nothing to compare with (no prior data, or a prior of 0).
 * The sign follows the arithmetic change, also for a negative prior (a loss shrinking reads as an increase).
 */
export function changePct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** 영업이익률 in percent (one decimal); null without revenue. */
export function marginPct(profit: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return Math.round((profit / revenue) * 1000) / 10;
}

export type Comparison = { current: number; previous: number | null; pct: number | null };

export const compare = (current: number, previous: number | null): Comparison => ({
  current,
  previous,
  pct: changePct(current, previous),
});
