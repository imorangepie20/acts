// 현금 흐름 추이 and 런웨이 from cash-role account movements.

export type CashMonth = { month: string; inflow: number; outflow: number; net: number };

/**
 * Debits on cash accounts are inflows, credits outflows, per month.
 * Transfers between two cash accounts (현금 ↔ 보통예금) appear on both sides; they net to 0.
 */
export function cashFlows(
  months: string[],
  movements: Map<string, { debit: number; credit: number }>,
): CashMonth[] {
  return months.map((month) => {
    const m = movements.get(month) ?? { debit: 0, credit: 0 };
    return { month, inflow: m.debit, outflow: m.credit, net: m.debit - m.credit };
  });
}

export type Runway = { months: number; avgOutflow: number; basisMonths: string[] } | null;

/**
 * Cash ÷ average monthly outflow over the given completed months (those with an outflow).
 * null without any outflow or with no cash left.
 */
export function runway(cash: number, completed: CashMonth[]): Runway {
  const used = completed.filter((c) => c.outflow > 0);
  if (used.length === 0 || cash <= 0) return null;
  const avgOutflow = Math.round(used.reduce((s, c) => s + c.outflow, 0) / used.length);
  return {
    months: Math.round((cash / avgOutflow) * 10) / 10,
    avgOutflow,
    basisMonths: used.map((c) => c.month),
  };
}
