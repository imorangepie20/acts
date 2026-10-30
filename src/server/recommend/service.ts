import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { KEYWORD_RULES, rankAccounts, type HistoryItem, type Recommendation } from "@/lib/recommend";
import { getVatAccountIds } from "@/server/accounts/service";
import type { Db } from "@/server/db/client";
import { accounts, voucherLines, vouchers } from "@/server/db/schema";

export type RecommendQuery = { entryType: "purchase" | "sale"; partnerId: number | null; text: string };

const HISTORY_LIMIT = 2000;

/** Main-account history of the most recent general vouchers of one entry type. */
export async function loadHistory(db: Db, entryType: "purchase" | "sale"): Promise<HistoryItem[]> {
  const recent = await db
    .select({ id: vouchers.id, partnerId: vouchers.partnerId, description: vouchers.description, date: vouchers.date })
    .from(vouchers)
    .where(and(eq(vouchers.kind, "general"), eq(vouchers.entryType, entryType), ne(vouchers.status, "rejected")))
    .orderBy(desc(vouchers.date), desc(vouchers.no))
    .limit(HISTORY_LIMIT);
  if (recent.length === 0) return [];

  const vat = await getVatAccountIds(db);
  const side = entryType === "purchase" ? "debit" : "credit";
  const lines = await db
    .select({ voucherId: voucherLines.voucherId, accountId: voucherLines.accountId })
    .from(voucherLines)
    .where(
      and(
        inArray(
          voucherLines.voucherId,
          recent.map((v) => v.id),
        ),
        eq(voucherLines.side, side),
      ),
    )
    .orderBy(asc(voucherLines.voucherId), asc(voucherLines.lineNo));
  const active = new Set(
    (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isActive, true))).map((a) => a.id),
  );

  const mainByVoucher = new Map<string, number>();
  for (const l of lines) {
    if (l.accountId === vat.inputAccountId || l.accountId === vat.outputAccountId) continue;
    if (!mainByVoucher.has(l.voucherId)) mainByVoucher.set(l.voucherId, l.accountId);
  }
  const out: HistoryItem[] = [];
  for (const v of recent) {
    const accountId = mainByVoucher.get(v.id);
    if (accountId === undefined || !active.has(accountId)) continue;
    out.push({ accountId, partnerId: v.partnerId, description: v.description, date: v.date });
  }
  return out;
}

/** Keyword rules resolved to active account ids (purchase only; sales have no fallback). */
async function loadRules(db: Db, entryType: "purchase" | "sale") {
  if (entryType !== "purchase") return [];
  const rows = await db
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(
      and(
        eq(accounts.isActive, true),
        inArray(
          accounts.code,
          KEYWORD_RULES.map((r) => r.code),
        ),
      ),
    );
  const idByCode = new Map(rows.map((r) => [r.code, r.id]));
  return KEYWORD_RULES.flatMap((r) => {
    const accountId = idByCode.get(r.code);
    return accountId === undefined ? [] : [{ accountId, keywords: r.keywords }];
  });
}

function fallbackFor(rules: { accountId: number; keywords: string[] }[], text: string) {
  const t = text.toLowerCase();
  return rules.flatMap((r) => {
    const keyword = r.keywords.find((k) => t.includes(k));
    return keyword === undefined ? [] : [{ accountId: r.accountId, keyword }];
  });
}

/** Loads history and rules once, then ranks every query. */
export async function recommendMany(
  db: Db,
  entryType: "purchase" | "sale",
  qs: Omit<RecommendQuery, "entryType">[],
): Promise<Recommendation[][]> {
  const [history, rules] = await Promise.all([loadHistory(db, entryType), loadRules(db, entryType)]);
  return qs.map((q) => rankAccounts(history, q, fallbackFor(rules, q.text)));
}

export async function recommendAccounts(db: Db, q: RecommendQuery): Promise<Recommendation[]> {
  const [r] = await recommendMany(db, q.entryType, [{ partnerId: q.partnerId, text: q.text }]);
  return r;
}
