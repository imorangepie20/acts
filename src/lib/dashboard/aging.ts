// 외상매출금 연령 분석 (FIFO: payments settle the oldest charges first).

export type ReceivableLine = { partnerKey: string; date: string; side: "debit" | "credit"; amount: number };

export const AGING_BUCKETS = ["0–30일", "31–60일", "61–90일", "90일 초과"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const bucketOf = (days: number): AgingBucket =>
  days <= 30 ? "0–30일" : days <= 60 ? "31–60일" : days <= 90 ? "61–90일" : "90일 초과";

const dayNo = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * Per partner, credits (and credit-side reductions) settle debits oldest first; the open part of each
 * remaining debit is aged by its date against `asOf`. A partner with a net credit balance adds nothing.
 */
export function receivableAging(lines: ReceivableLine[], asOf: string): Record<AgingBucket, number> {
  const out = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
  const byPartner = new Map<string, ReceivableLine[]>();
  for (const l of lines) {
    if (l.date > asOf) continue;
    const list = byPartner.get(l.partnerKey) ?? [];
    list.push(l);
    byPartner.set(l.partnerKey, list);
  }
  for (const list of byPartner.values()) {
    let paid = list.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
    const debits = list.filter((l) => l.side === "debit").sort((a, b) => a.date.localeCompare(b.date));
    for (const d of debits) {
      const settled = Math.min(paid, d.amount);
      paid -= settled;
      const open = d.amount - settled;
      if (open > 0) out[bucketOf(dayNo(asOf) - dayNo(d.date))] += open;
    }
  }
  return out;
}
