import { describe, expect, it } from "vitest";
import type { AccountGroup } from "@/lib/accounts";
import { buildTrialBalance } from "./trial-balance";

const accounts: { id: number; code: string; name: string; group: AccountGroup }[] = [
  { id: 1, code: "101", name: "현금", group: "current_asset" },
  { id: 2, code: "255", name: "부가세예수금", group: "current_liability" },
  { id: 3, code: "401", name: "상품매출", group: "revenue" },
  { id: 4, code: "331", name: "자본금", group: "equity" },
  { id: 5, code: "811", name: "복리후생비", group: "sga" },
];
const none = { bsTotals: [], plTotals: [], priorProfit: 0 };

describe("buildTrialBalance", () => {
  it("cash sale", () => {
    const tb = buildTrialBalance({
      accounts,
      bsTotals: [
        { accountId: 1, debit: 110000, credit: 0 },
        { accountId: 2, debit: 0, credit: 10000 },
      ],
      plTotals: [{ accountId: 3, debit: 0, credit: 100000 }],
      priorProfit: 0,
    });
    const accts = tb.rows.filter((r) => r.kind === "account");
    expect(accts.map((r) => r.code)).toEqual(["101", "255", "401"]);
    expect(accts[0]).toMatchObject({ debitBalance: 110000, debitTotal: 110000, creditTotal: 0, creditBalance: 0 });
    expect(accts[1]).toMatchObject({ creditBalance: 10000, creditTotal: 10000, debitBalance: 0 });
    expect(accts[2]).toMatchObject({ creditBalance: 100000 });
    expect(tb.total).toEqual({ debitBalance: 110000, debitTotal: 110000, creditTotal: 110000, creditBalance: 110000 });
    expect(tb.balanced).toBe(true);
  });

  it("prior profit adds an auto row in equity on the credit side", () => {
    const tb = buildTrialBalance({
      accounts,
      bsTotals: [{ accountId: 1, debit: 50000, credit: 0 }],
      plTotals: [],
      priorProfit: 50000,
    });
    const auto = tb.rows.find((r) => r.kind === "auto");
    expect(auto).toMatchObject({ name: "이월이익잉여금(전기 손익)", creditTotal: 50000, creditBalance: 50000, debitTotal: 0, debitBalance: 0 });
    const idx = tb.rows.findIndex((r) => r.kind === "auto");
    expect(tb.rows[idx - 1]).toMatchObject({ kind: "group", label: "자본" });
    expect(tb.rows[idx + 1]).toMatchObject({ kind: "subtotal", label: "자본 계", creditTotal: 50000 });
    expect(tb.balanced).toBe(true);
  });

  it("prior loss goes on the debit side, after equity accounts", () => {
    const tb = buildTrialBalance({
      accounts,
      bsTotals: [
        { accountId: 4, debit: 0, credit: 100000 },
        { accountId: 1, debit: 100000, credit: 0 },
      ],
      plTotals: [],
      priorProfit: -30000,
    });
    const idx = tb.rows.findIndex((r) => r.kind === "auto");
    expect(tb.rows[idx - 1]).toMatchObject({ kind: "account", code: "331" });
    expect(tb.rows[idx]).toMatchObject({ debitTotal: 30000, debitBalance: 30000, creditTotal: 0, creditBalance: 0 });
    expect(tb.total.debitTotal).toBe(130000);
    expect(tb.total.creditTotal).toBe(100000);
  });

  it("net credit balance for debit 300 / credit 500", () => {
    const tb = buildTrialBalance({ ...none, accounts, bsTotals: [{ accountId: 1, debit: 300, credit: 500 }] });
    expect(tb.rows.find((r) => r.kind === "account")).toMatchObject({ debitBalance: 0, creditBalance: 200, debitTotal: 300, creditTotal: 500 });
    expect(tb.total.creditBalance).toBe(200);
  });

  it("omits empty groups and orders groups with subtotals", () => {
    const tb = buildTrialBalance({
      ...none,
      accounts,
      bsTotals: [
        { accountId: 2, debit: 0, credit: 5 },
        { accountId: 1, debit: 5, credit: 0 },
      ],
      plTotals: [{ accountId: 5, debit: 7, credit: 0 }],
    });
    const shape = tb.rows.map((r) =>
      r.kind === "group" ? `G:${r.label}` : r.kind === "subtotal" ? `S:${r.label}` : r.kind === "account" ? r.code : r.kind,
    );
    expect(shape).toEqual([
      "G:유동자산", "101", "S:유동자산 계",
      "G:유동부채", "255", "S:유동부채 계",
      "G:판매비와관리비", "811", "S:판매비와관리비 계",
    ]);
  });

  it("empty input", () => {
    const tb = buildTrialBalance({ ...none, accounts });
    expect(tb.rows).toEqual([]);
    expect(tb.balanced).toBe(true);
  });
});
