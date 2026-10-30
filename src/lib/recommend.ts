export type HistoryItem = { accountId: number; partnerId: number | null; description: string; date: string };
export type Recommendation = { accountId: number; reason: string };
export type KeywordRule = { keywords: string[]; code: string };

/** Fallback for a company with no history yet (purchases only). Resolved by code at runtime. */
export const KEYWORD_RULES: KeywordRule[] = [
  { code: "819", keywords: ["임차료", "임대료", "월세", "관리비"] },
  { code: "814", keywords: ["통신", "인터넷", "휴대폰", "전화", "kt", "skt", "유플러스"] },
  { code: "815", keywords: ["전기", "가스", "수도", "한전"] },
  { code: "812", keywords: ["택시", "교통", "주차", "항공", "ktx", "숙박", "출장"] },
  { code: "811", keywords: ["식대", "식사", "커피", "간식", "회식"] },
  { code: "813", keywords: ["접대", "선물", "경조"] },
  { code: "822", keywords: ["주유", "차량", "세차", "정비", "통행료", "하이패스"] },
  { code: "824", keywords: ["택배", "운송", "퀵", "배송"] },
  { code: "829", keywords: ["문구", "사무용품", "복사용지", "토너"] },
  { code: "830", keywords: ["소모품", "다이소"] },
  { code: "831", keywords: ["수수료", "세무", "기장"] },
  { code: "833", keywords: ["광고", "홍보", "마케팅"] },
  { code: "821", keywords: ["보험"] },
  { code: "826", keywords: ["도서", "신문", "인쇄"] },
  { code: "825", keywords: ["교육", "강의", "세미나"] },
  { code: "820", keywords: ["수리", "수선", "유지보수"] },
];

/** Lower-cases, splits on whitespace and punctuation, drops 1-character tokens, deduplicates. */
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}

type Acc = { score: number; partner: number; text: number; latest: string };

export function rankAccounts(
  history: HistoryItem[],
  q: { partnerId: number | null; text: string },
  fallback: { accountId: number; keyword: string }[],
  limit = 3,
): Recommendation[] {
  const qTokens = new Set(tokenize(q.text));
  const byAccount = new Map<number, Acc>();
  for (const h of history) {
    const partnerHit = h.partnerId !== null && h.partnerId === q.partnerId;
    let shared = 0;
    if (qTokens.size > 0) for (const t of tokenize(h.description)) if (qTokens.has(t)) shared++;
    const weight = (partnerHit ? 3 : 0) + 2 * Math.min(2, shared);
    if (weight === 0) continue;
    const a = byAccount.get(h.accountId) ?? { score: 0, partner: 0, text: 0, latest: "" };
    a.score += weight;
    if (partnerHit) a.partner++;
    if (shared > 0) a.text++;
    if (h.date > a.latest) a.latest = h.date;
    byAccount.set(h.accountId, a);
  }
  const out: Recommendation[] = [...byAccount.entries()]
    .sort(([, a], [, b]) => b.score - a.score || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0))
    .slice(0, limit)
    .map(([accountId, a]) => ({
      accountId,
      reason: [a.partner > 0 && `이 거래처 ${a.partner}회`, a.text > 0 && `비슷한 적요 ${a.text}회`]
        .filter(Boolean)
        .join(" · "),
    }));
  for (const f of fallback) {
    if (out.length >= limit) break;
    if (out.some((r) => r.accountId === f.accountId)) continue;
    out.push({ accountId: f.accountId, reason: `기본 규칙(${f.keyword})` });
  }
  return out;
}
