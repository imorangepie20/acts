import { describe, expect, it } from "vitest";
import { rankAccounts, tokenize, type HistoryItem } from "./recommend";

const h = (accountId: number, partnerId: number | null, description: string, date: string): HistoryItem => ({
  accountId,
  partnerId,
  description,
  date,
});

describe("tokenize", () => {
  it("splits on punctuation and whitespace", () => {
    expect(tokenize("스타벅스 강남점, 커피!")).toEqual(["스타벅스", "강남점", "커피"]);
  });
  it("lower-cases, drops short tokens and deduplicates", () => {
    expect(tokenize("KT a 통신 kt")).toEqual(["kt", "통신"]);
  });
});

describe("rankAccounts", () => {
  it("ranks a partner match above a text match", () => {
    const hist = [h(1, 7, "", "2026-10-01"), h(2, null, "커피 구입", "2026-10-02")];
    // partner = 3, one shared token = 2
    const r = rankAccounts(hist, { partnerId: 7, text: "커피" }, []);
    expect(r.map((x) => x.accountId)).toEqual([1, 2]);
  });
  it("breaks ties by the latest date", () => {
    const hist = [h(1, 7, "", "2026-10-01"), h(2, 7, "", "2026-10-05")];
    expect(rankAccounts(hist, { partnerId: 7, text: "" }, []).map((x) => x.accountId)).toEqual([2, 1]);
  });
  it("builds the reason from counts", () => {
    const hist = [h(1, 7, "회식", "2026-10-01"), h(1, 7, "", "2026-10-02")];
    const r = rankAccounts(hist, { partnerId: 7, text: "회식" }, []);
    expect(r).toEqual([{ accountId: 1, reason: "이 거래처 2회 · 비슷한 적요 1회" }]);
  });
  it("ignores items without any match", () => {
    expect(rankAccounts([h(1, 8, "점심", "2026-10-01")], { partnerId: 7, text: "회식" }, [])).toEqual([]);
  });
  it("falls back to keyword rules when history is empty", () => {
    const r = rankAccounts([], { partnerId: null, text: "주유소 결제" }, [{ accountId: 822, keyword: "주유" }]);
    expect(r).toEqual([{ accountId: 822, reason: "기본 규칙(주유)" }]);
  });
  it("does not repeat an account already listed by history", () => {
    const r = rankAccounts([h(822, null, "주유소", "2026-10-01")], { partnerId: null, text: "주유소" }, [
      { accountId: 822, keyword: "주유" },
      { accountId: 824, keyword: "택배" },
    ]);
    expect(r.map((x) => x.accountId)).toEqual([822, 824]);
  });
});
