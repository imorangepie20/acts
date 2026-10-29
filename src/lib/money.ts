export const MAX_WON = 999_999_999_999;

/** Parses user-typed won ("1,234,000", "1234000원"). Returns null unless a non-negative integer <= MAX_WON. */
export function parseWon(input: string): number | null {
  const s = input.replace(/[\s,]/g, "").replace(/원$/, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= MAX_WON ? n : null;
}

export function formatWon(n: number): string {
  return n.toLocaleString("en-US");
}
