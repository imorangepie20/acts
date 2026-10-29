import { describe, expect, it } from "vitest";
import { isPnlGroup, type AccountGroup } from "@/lib/accounts";
import { buildBalanceSheet, buildIncomeStatement, type BsInput, type StatementLine } from "./statements";
import type { AccountTotal } from "./types";

const chart: [string, string, AccountGroup][] = [
  ["101", "현금", "current_asset"],
  ["108", "외상매출금", "current_asset"],
  ["135", "부가세대급금", "current_asset"],
  ["146", "상품", "current_asset"],
  ["212", "비품", "noncurrent_asset"],
  ["213", "감가상각누계액", "noncurrent_asset"],
  ["251", "외상매입금", "current_liability"],
  ["255", "부가세예수금", "current_liability"],
  ["293", "장기차입금", "noncurrent_liability"],
  ["331", "자본금", "equity"],
  ["401", "상품매출", "revenue"],
  ["451", "상품매출원가", "cost_of_sales"],
  ["811", "복리후생비", "sga"],
  ["818", "감가상각비", "sga"],
  ["901", "이자수익", "non_operating_income"],
  ["951", "이자비용", "non_operating_expense"],
  ["998", "법인세등", "income_tax"],
];
const accounts = chart.map(([code, name, group], i) => ({ id: i + 1, code, name, group }));
const byCode = new Map(accounts.map((a) => [a.code, a]));
const id = (code: string) => byCode.get(code)!.id;

const dr = (code: string, amount: number): AccountTotal => ({ accountId: id(code), debit: amount, credit: 0 });
const cr = (code: string, amount: number): AccountTotal => ({ accountId: id(code), debit: 0, credit: amount });

const sec = (lines: StatementLine[], key: string) =>
  lines.find((l) => (l.kind === "section" || l.kind === "computed") && l.key === key);
const acct = (lines: StatementLine[], code: string) => lines.find((l) => l.kind === "account" && l.code === code);
const named = (lines: StatementLine[], name: string) => lines.find((l) => l.kind === "account" && l.name === name);

describe("buildIncomeStatement", () => {
  const current = [
    cr("401", 100000),
    dr("451", 60000),
    dr("811", 30000),
    cr("901", 5000),
    dr("951", 2000),
    dr("998", 3000),
  ];

  it("computes the subtotals from the groups", () => {
    const is = buildIncomeStatement(accounts, current, []);
    expect(sec(is, "revenue")).toMatchObject({ label: "Ⅰ. 매출액", amount: 100000 });
    expect(sec(is, "cost_of_sales")).toMatchObject({ label: "Ⅱ. 매출원가", amount: 60000 });
    expect(sec(is, "gross")).toMatchObject({ kind: "computed", label: "Ⅲ. 매출총이익", amount: 40000 });
    expect(sec(is, "sga")).toMatchObject({ label: "Ⅳ. 판매비와관리비", amount: 30000 });
    expect(sec(is, "operating")).toMatchObject({ kind: "computed", label: "Ⅴ. 영업이익", amount: 10000 });
    expect(sec(is, "non_operating_income")).toMatchObject({ label: "Ⅵ. 영업외수익", amount: 5000 });
    expect(sec(is, "non_operating_expense")).toMatchObject({ label: "Ⅶ. 영업외비용", amount: 2000 });
    expect(sec(is, "pretax")).toMatchObject({ kind: "computed", label: "Ⅷ. 법인세비용차감전순이익", amount: 13000 });
    expect(sec(is, "income_tax")).toMatchObject({ label: "Ⅸ. 법인세비용", amount: 3000 });
    expect(sec(is, "net")).toMatchObject({ kind: "computed", label: "Ⅹ. 당기순이익", amount: 10000 });
  });

  it("lays out sections, each followed by its accounts by code", () => {
    const is = buildIncomeStatement(accounts, [...current, dr("818", 500)].reverse(), []);
    const shape = is.map((l) => (l.kind === "account" ? l.code : l.key));
    expect(shape).toEqual([
      "revenue", "401",
      "cost_of_sales", "451",
      "gross",
      "sga", "811", "818",
      "operating",
      "non_operating_income", "901",
      "non_operating_expense", "951",
      "pretax",
      "income_tax", "998",
      "net",
    ]);
  });

  it("computes the prior column independently", () => {
    const is = buildIncomeStatement(accounts, current, [cr("401", 20000), dr("811", 25000), cr("901", 1000)]);
    expect(sec(is, "revenue")).toMatchObject({ amount: 100000, prior: 20000 });
    expect(sec(is, "cost_of_sales")).toMatchObject({ amount: 60000, prior: 0 });
    expect(sec(is, "gross")).toMatchObject({ amount: 40000, prior: 20000 });
    expect(sec(is, "operating")).toMatchObject({ amount: 10000, prior: -5000 });
    expect(sec(is, "pretax")).toMatchObject({ amount: 13000, prior: -4000 });
    expect(sec(is, "net")).toMatchObject({ amount: 10000, prior: -4000 });
    expect(acct(is, "451")).toMatchObject({ amount: 60000, prior: 0 });
    expect(acct(is, "811")).toMatchObject({ amount: 30000, prior: 25000, name: "복리후생비", accountId: id("811") });
  });

  it("shows an account that only has prior activity", () => {
    const is = buildIncomeStatement(accounts, [], [dr("818", 700)]);
    expect(acct(is, "818")).toMatchObject({ amount: 0, prior: 700 });
  });

  it("omits zero-activity accounts but keeps every section and computed row", () => {
    const is = buildIncomeStatement(accounts, [cr("401", 1000), { accountId: id("811"), debit: 50, credit: 50 }], []);
    expect(acct(is, "811")).toBeUndefined();
    expect(acct(is, "451")).toBeUndefined();
    expect(is.filter((l) => l.kind !== "account")).toHaveLength(10);
    expect(sec(is, "net")).toMatchObject({ amount: 1000, prior: 0 });
  });

  it("uses the signed balance: a contra entry inside a group is negative", () => {
    // revenue debit (매출환입) larger than credit -> negative revenue
    const is = buildIncomeStatement(accounts, [{ accountId: id("401"), debit: 3000, credit: 1000 }], []);
    expect(acct(is, "401")).toMatchObject({ amount: -2000 });
    expect(sec(is, "net")).toMatchObject({ amount: -2000 });
  });

  it("ignores balance-sheet accounts in the totals", () => {
    const is = buildIncomeStatement(accounts, [dr("101", 9999), cr("401", 10)], []);
    expect(acct(is, "101")).toBeUndefined();
    expect(sec(is, "net")).toMatchObject({ amount: 10 });
  });
});

const noBs: BsInput = { bsTotals: [], priorProfit: 0, currentProfit: 0 };

describe("buildBalanceSheet", () => {
  it("contra account stays in its section", () => {
    const bs = buildBalanceSheet(
      accounts,
      { bsTotals: [dr("212", 1000000), cr("213", 200000), cr("331", 800000)], priorProfit: 0, currentProfit: 0 },
      noBs,
    );
    const i = bs.findIndex((l) => l.kind === "section" && l.key === "noncurrent_asset");
    expect(bs[i]).toMatchObject({ label: "Ⅱ. 비유동자산", amount: 800000 });
    expect(bs[i + 1]).toMatchObject({ kind: "account", code: "212", amount: 1000000 });
    expect(bs[i + 2]).toMatchObject({ kind: "account", code: "213", amount: -200000 });
    expect(sec(bs, "total_assets")).toMatchObject({ label: "자산총계", amount: 800000 });
  });

  it("lays out the exact sections and labels", () => {
    const bs = buildBalanceSheet(
      accounts,
      {
        bsTotals: [dr("101", 1500), cr("251", 300), cr("293", 200), cr("331", 500)],
        priorProfit: 300,
        currentProfit: 200,
      },
      noBs,
    );
    const shape = bs.map((l) => (l.kind === "account" ? `${l.code}:${l.name}` : `${l.kind}:${l.label}`));
    expect(shape).toEqual([
      "section:자산",
      "section:Ⅰ. 유동자산", "101:현금",
      "section:Ⅱ. 비유동자산",
      "computed:자산총계",
      "section:부채",
      "section:Ⅰ. 유동부채", "251:외상매입금",
      "section:Ⅱ. 비유동부채", "293:장기차입금",
      "computed:부채총계",
      "section:자본",
      "section:Ⅰ. 자본", "331:자본금", ":이월이익잉여금(전기 손익)", ":당기순이익",
      "computed:자본총계",
      "computed:부채와자본총계",
    ]);
    expect(sec(bs, "assets")).toMatchObject({ amount: 1500 });
    expect(sec(bs, "liabilities")).toMatchObject({ amount: 500 });
    expect(sec(bs, "total_liabilities")).toMatchObject({ amount: 500 });
    expect(sec(bs, "capital")).toMatchObject({ amount: 1000 });
    expect(sec(bs, "equity")).toMatchObject({ amount: 1000 });
    expect(sec(bs, "total_equity")).toMatchObject({ amount: 1000 });
    expect(sec(bs, "total_liabilities_equity")).toMatchObject({ amount: 1500 });
    expect(named(bs, "이월이익잉여금(전기 손익)")).toMatchObject({ accountId: null, code: "", amount: 300 });
    expect(named(bs, "당기순이익")).toMatchObject({ accountId: null, code: "", amount: 200 });
  });

  it("profit rows appear when either column is non-zero", () => {
    const onlyPrior = buildBalanceSheet(accounts, noBs, { bsTotals: [], priorProfit: 0, currentProfit: -40 });
    expect(named(onlyPrior, "당기순이익")).toMatchObject({ amount: 0, prior: -40 });
    expect(named(onlyPrior, "이월이익잉여금(전기 손익)")).toBeUndefined();
    const none = buildBalanceSheet(accounts, noBs, noBs);
    expect(none.filter((l) => l.kind === "account")).toEqual([]);
    expect(none.filter((l) => l.kind !== "account")).toHaveLength(12);
  });

  it("ignores profit-and-loss accounts in bsTotals", () => {
    const bs = buildBalanceSheet(accounts, { bsTotals: [dr("101", 10), cr("401", 10)], priorProfit: 0, currentProfit: 10 }, noBs);
    expect(acct(bs, "401")).toBeUndefined();
    expect(sec(bs, "total_assets")).toMatchObject({ amount: 10 });
    expect(sec(bs, "total_liabilities_equity")).toMatchObject({ amount: 10 });
  });

  // 자산총계 === 부채와자본총계 for any balanced set of vouchers.
  type Entry = [code: string, side: "debit" | "credit", amount: number];
  type Voucher = { priorYear?: boolean; lines: Entry[] };
  const v = (lines: Entry[], priorYear = false): Voucher => ({ priorYear, lines });

  /** Aggregates vouchers the way the service does: BS totals ever, P&L split by fiscal year. */
  function toInput(vouchers: Voucher[]): BsInput {
    const totals = new Map<number, AccountTotal>();
    let priorProfit = 0;
    let currentProfit = 0;
    for (const vch of vouchers) {
      const dSum = vch.lines.filter((l) => l[1] === "debit").reduce((s, l) => s + l[2], 0);
      const cSum = vch.lines.filter((l) => l[1] === "credit").reduce((s, l) => s + l[2], 0);
      if (dSum !== cSum) throw new Error("test voucher is not balanced");
      for (const [code, side, amount] of vch.lines) {
        const a = byCode.get(code)!;
        if (isPnlGroup(a.group)) {
          const p = side === "credit" ? amount : -amount;
          if (vch.priorYear) priorProfit += p;
          else currentProfit += p;
          continue;
        }
        const t = totals.get(a.id) ?? { accountId: a.id, debit: 0, credit: 0 };
        if (side === "debit") t.debit += amount;
        else t.credit += amount;
        totals.set(a.id, t);
      }
    }
    return { bsTotals: [...totals.values()], priorProfit, currentProfit };
  }

  const capital = v([["101", "debit", 10000000], ["331", "credit", 10000000]]);
  const creditPurchase = v([["146", "debit", 2000000], ["135", "debit", 200000], ["251", "credit", 2200000]]);
  const cashSale = v([["101", "debit", 3300000], ["401", "credit", 3000000], ["255", "credit", 300000]]);
  const expense = v([["811", "debit", 450000], ["101", "credit", 450000]]);
  const priorYearProfit = v([["108", "debit", 1100000], ["401", "credit", 1000000], ["255", "credit", 100000]], true);
  const priorYearLoss = v([["951", "debit", 700000], ["101", "credit", 700000]], true);
  const depreciation = v([["212", "debit", 5000000], ["101", "credit", 5000000]]);
  const depExpense = v([["818", "debit", 1000000], ["213", "credit", 1000000]]);
  const loan = v([["101", "debit", 4000000], ["293", "credit", 4000000]]);
  const costAndTax = v([["451", "debit", 1200000], ["146", "credit", 1200000], ["998", "debit", 90000], ["101", "credit", 90000]]);
  const bigLoss = v([["811", "debit", 30000000], ["251", "credit", 30000000]]);

  const cases: [string, Voucher[]][] = [
    ["capital injection", [capital]],
    ["credit purchase", [creditPurchase]],
    ["cash sale", [cashSale]],
    ["expense", [capital, expense]],
    ["prior-year profit", [priorYearProfit]],
    ["prior-year loss", [capital, priorYearLoss]],
    ["contra depreciation", [capital, depreciation, depExpense]],
    ["everything", [capital, creditPurchase, cashSale, expense, priorYearProfit, priorYearLoss, depreciation, depExpense, loan, costAndTax]],
    ["negative equity", [capital, bigLoss, priorYearLoss]],
  ];

  it.each(cases)("자산총계 === 부채와자본총계: %s", (_name, vouchers) => {
    const input = toInput(vouchers);
    // Prior column uses a different voucher set to prove the columns are independent.
    const priorInput = toInput(vouchers.slice(0, 1));
    const bs = buildBalanceSheet(accounts, input, priorInput);
    const assets = sec(bs, "total_assets")!;
    const le = sec(bs, "total_liabilities_equity")!;
    expect(assets.amount).toBe(le.amount);
    expect(assets.prior).toBe(le.prior);
    expect(sec(bs, "assets")!.amount).toBe(assets.amount);
    expect(sec(bs, "total_liabilities")!.amount + sec(bs, "total_equity")!.amount).toBe(le.amount);
    expect(sec(bs, "total_equity")!.amount).toBe(sec(bs, "capital")!.amount);
  });

  it("table check: the everything case has the expected totals", () => {
    const bs = buildBalanceSheet(accounts, toInput(cases[7][1]), noBs);
    // cash 10,000,000 + 3,300,000 − 450,000 − 700,000 − 5,000,000 + 4,000,000 − 90,000 = 11,060,000
    expect(acct(bs, "101")).toMatchObject({ amount: 11060000 });
    // current: 101 11,060,000; 108 1,100,000; 135 200,000; 146 800,000 = 13,160,000
    expect(sec(bs, "current_asset")).toMatchObject({ amount: 13160000 });
    expect(sec(bs, "noncurrent_asset")).toMatchObject({ amount: 4000000 });
    expect(sec(bs, "total_assets")).toMatchObject({ amount: 17160000 });
    // current profit 3,000,000 − 450,000 − 1,000,000 − 1,200,000 − 90,000 = 260,000; prior 1,000,000 − 700,000 = 300,000
    expect(named(bs, "당기순이익")).toMatchObject({ amount: 260000 });
    expect(named(bs, "이월이익잉여금(전기 손익)")).toMatchObject({ amount: 300000 });
    expect(sec(bs, "total_liabilities")).toMatchObject({ amount: 2200000 + 400000 + 4000000 });
    expect(sec(bs, "total_equity")).toMatchObject({ amount: 10560000 });
    expect(sec(bs, "total_liabilities_equity")).toMatchObject({ amount: 17160000 });
  });
});
