import { describe, expect, it } from "vitest";
import type { VatEntry } from "@/lib/vat/types";
import { receivableAging } from "./aging";
import { cashFlows, runway } from "./cash";
import { costComposition } from "./costs";
import { addMonths, lastCompletedMonth, monthEnd, monthsBetween, nextBusinessDay } from "./dates";
import { changePct, marginPct } from "./kpi";
import { buildSchedule, corporateTaxDues } from "./schedule";
import { currentVatPeriod, vatEstimate } from "./vat";

describe("dates", () => {
  it("shifts months and finds month ends", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("picks the last completed month", () => {
    expect(lastCompletedMonth("2026-11-01")).toBe("2026-10");
    expect(lastCompletedMonth("2026-10-31")).toBe("2026-10");
    expect(lastCompletedMonth("2026-01-15")).toBe("2025-12");
  });
  it("moves a weekend to Monday", () => {
    expect(nextBusinessDay("2026-01-10")).toBe("2026-01-12"); // Saturday
    expect(nextBusinessDay("2026-05-10")).toBe("2026-05-11"); // Sunday
    expect(nextBusinessDay("2026-02-10")).toBe("2026-02-10"); // Tuesday
  });
});

describe("kpi", () => {
  it("compares against a prior period", () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(80, 100)).toBe(-20);
    expect(changePct(-50, -100)).toBe(50); // a smaller loss
    expect(changePct(100, null)).toBeNull();
    expect(changePct(100, 0)).toBeNull();
  });
  it("computes the margin", () => {
    expect(marginPct(24, 323)).toBe(7.4);
    expect(marginPct(10, 0)).toBeNull();
  });
});

describe("cash", () => {
  it("builds monthly flows and a runway from completed months", () => {
    const flows = cashFlows(
      ["2026-01", "2026-02", "2026-03"],
      new Map([
        ["2026-01", { debit: 300, credit: 100 }],
        ["2026-03", { debit: 0, credit: 300 }],
      ]),
    );
    expect(flows[1]).toEqual({ month: "2026-02", inflow: 0, outflow: 0, net: 0 });
    expect(flows[2].net).toBe(-300);
    const r = runway(1000, flows);
    expect(r).toEqual({ months: 5, avgOutflow: 200, basisMonths: ["2026-01", "2026-03"] });
    expect(runway(1000, [flows[1]])).toBeNull();
    expect(runway(0, flows)).toBeNull();
  });
});

describe("receivableAging", () => {
  it("settles the oldest charges first and ages the open rest", () => {
    const aging = receivableAging(
      [
        { partnerKey: "a", date: "2026-06-01", side: "debit", amount: 100 },
        { partnerKey: "a", date: "2026-08-15", side: "debit", amount: 200 },
        { partnerKey: "a", date: "2026-10-20", side: "debit", amount: 50 },
        { partnerKey: "a", date: "2026-09-01", side: "credit", amount: 150 },
        { partnerKey: "b", date: "2026-01-01", side: "debit", amount: 10 },
        { partnerKey: "b", date: "2026-02-01", side: "credit", amount: 20 }, // overpaid: nothing open
        { partnerKey: "c", date: "2026-12-01", side: "debit", amount: 999 }, // after asOf
      ],
      "2026-11-01",
    );
    // a: 100 settled, 50 of 200 settled → 150 open from 08-15 (78 days), 50 from 10-20 (12 days)
    expect(aging).toEqual({ "0–30일": 50, "31–60일": 0, "61–90일": 150, "90일 초과": 0 });
  });
});

describe("costComposition", () => {
  const accts = [
    { accountId: 1, code: "801", name: "임원급여", amount: 100, prior: 80 },
    { accountId: 2, code: "802", name: "직원급여", amount: 300, prior: 300 },
    { accountId: 3, code: "819", name: "지급임차료", amount: 50, prior: null },
    { accountId: 4, code: "814", name: "통신비", amount: 30, prior: 30 },
    { accountId: 5, code: "830", name: "소모품비", amount: 20, prior: 40 },
    { accountId: 6, code: "848", name: "잡비", amount: 0, prior: 5 },
  ];
  it("keeps the top accounts and folds the rest into 기타", () => {
    const c = costComposition(accts, 1000, { top: 3, hasPrior: true });
    expect(c.total).toBe(500);
    expect(c.rows.map((r) => [r.label, r.amount, r.share, r.changePct])).toEqual([
      ["802 직원급여", 300, 60, 0],
      ["801 임원급여", 100, 20, 25],
      ["819 지급임차료", 50, 10, null],
      ["기타 2개 계정", 50, 10, -28.6],
    ]);
    expect(c.labor).toEqual({ amount: 400, shareOfCosts: 80, shareOfRevenue: 40, codes: ["801", "802"] });
  });
  it("hides changes without prior data", () => {
    expect(costComposition(accts, 0, { hasPrior: false }).rows.every((r) => r.changePct === null)).toBe(true);
    expect(costComposition(accts, 0, { hasPrior: false }).labor.shareOfRevenue).toBeNull();
  });
});

describe("vat", () => {
  it("finds the current 과세기간 and due date", () => {
    expect(currentVatPeriod("2026-11-01", "corporation")).toEqual({
      year: 2026, term: 2, kind: "final", from: "2026-10-01", to: "2026-12-31", due: "2027-01-25",
    });
    expect(currentVatPeriod("2026-02-10", "corporation")).toMatchObject({ kind: "prelim", from: "2026-01-01", to: "2026-03-31", due: "2026-04-27" });
    expect(currentVatPeriod("2026-02-10", "individual")).toMatchObject({ kind: "final", from: "2026-01-01", to: "2026-06-30" });
  });
  it("counts only deductible input tax", () => {
    const e = (entryType: "sale" | "purchase", vatAmount: number, vatDeductible: boolean | null) =>
      ({ entryType, vatAmount, vatDeductible }) as VatEntry;
    expect(vatEstimate([e("sale", 1000, null), e("purchase", 300, true), e("purchase", 200, false)])).toEqual({
      outputTax: 1000, inputTax: 300, payable: 700, saleCount: 1, purchaseCount: 2,
    });
  });
});

describe("schedule", () => {
  it("dates 법인세 from the fiscal year end", () => {
    expect(corporateTaxDues("2027-01-05", 1)).toEqual({ fyEnd: "2026-12-31", corporate: "2027-03-31", local: "2027-04-30" });
    expect(corporateTaxDues("2027-05-01", 1).corporate).toBe("2028-03-31");
    // A fiscal year starting in April ends in March: due end of June / July.
    expect(corporateTaxDues("2026-05-01", 4)).toEqual({ fyEnd: "2026-03-31", corporate: "2026-06-30", local: "2026-07-31" });
  });

  it("builds payroll, VAT, tax, card and dividend rows capped by book balances", () => {
    const items = buildSchedule({
      asOf: "2026-11-01",
      fiscalStartMonth: 1,
      balances: { "254": 8_000, "262": 6_000, "261": 500, "264": 1_100, "265": 300 },
      payroll: [
        { payMonth: "2026-09", tax: 999, insurance: 999 }, // due 10-12, already past
        { payMonth: "2026-10", tax: 2_000, insurance: 12_000 },
      ],
      cards: [{ partnerId: 7, name: "OO카드", balance: 4_000 }, { partnerId: 8, name: "XX카드", balance: 0 }],
    });
    expect(items.map((i) => [i.kind, i.due, i.amount])).toEqual([
      ["withholding", "2026-11-10", 2_000],
      ["insurance", "2026-11-10", 12_000], // 6,000 from 미지급비용 + 6,000 left in 예수금
      ["card", "2026-11-16", 4_000], // 15th is a Sunday
      ["vat", "2027-01-25", 500],
      ["corporateTax", "2027-03-31", 1_000],
      ["localTax", "2027-04-30", 100],
      ["dividend", null, 300],
    ]);
  });

  it("skips accounts that do not exist and empty balances", () => {
    const items = buildSchedule({ asOf: "2026-11-01", fiscalStartMonth: 1, balances: { "254": 0 }, payroll: [{ payMonth: "2026-10", tax: 5, insurance: 5 }], cards: [] });
    expect(items).toEqual([]);
  });
});
