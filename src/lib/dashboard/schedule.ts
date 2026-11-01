// 납부·지급 일정: due dates from book balances and confirmed payroll runs (pure).

import { addMonths, monthEnd, nextBusinessDay } from "./dates";

export type ScheduleKind = "withholding" | "insurance" | "vat" | "corporateTax" | "localTax" | "card" | "dividend";

export type ScheduleItem = {
  kind: ScheduleKind;
  label: string;
  /** null = 날짜 미정. */
  due: string | null;
  amount: number;
  basis: string;
  /** Account code the amount comes from (for the ledger link). */
  accountCode: string;
  partnerId?: number;
};

/** Payroll totals of the confirmed runs paid in one month (지급일 month). */
export type PayrollMonth = { payMonth: string; tax: number; insurance: number };

export type ScheduleInput = {
  asOf: string;
  fiscalStartMonth: number;
  /** Book balance (normal side positive) by account code, as of `asOf`. Missing codes are skipped. */
  balances: Record<string, number | undefined>;
  payroll: PayrollMonth[];
  /** 미지급금 balances of card partners. */
  cards: { partnerId: number; name: string; balance: number }[];
};

const BALANCE_BASIS = "장부 잔액 기준";

/** The first `day`-th of a month on or after `asOf` (weekend → next Monday). */
function nextDayOfMonth(asOf: string, day: number): string {
  const month = asOf.slice(0, 7);
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < 3; i++) {
    const d = nextBusinessDay(`${addMonths(month, i)}-${pad(day)}`);
    if (d >= asOf) return d;
  }
  throw new Error("unreachable");
}

/** 25th of the month after a VAT period end (Mar, Jun, Sep, Dec) on or after `asOf`. */
function nextVatDue(asOf: string): string {
  const year = Number(asOf.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    for (const m of ["01", "04", "07", "10"]) {
      const d = nextBusinessDay(`${y}-${m}-25`);
      if (d >= asOf) return d;
    }
  }
  throw new Error("unreachable");
}

/**
 * 법인세 is due at the end of the 3rd month after the fiscal year end, 법인지방소득세 at the end of the 4th.
 * Uses the most recent fiscal year end whose 지방소득세 due date is still on or after `asOf`.
 */
export function corporateTaxDues(asOf: string, fiscalStartMonth: number): { fyEnd: string; corporate: string; local: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = Number(asOf.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    // The fiscal year that starts in `year` ends the month before `fiscalStartMonth` (of `year + 1` unless January).
    const endMonth = addMonths(`${year}-${pad(fiscalStartMonth)}`, 11);
    const local = nextBusinessDay(monthEnd(addMonths(endMonth, 4)));
    if (local >= asOf) {
      return { fyEnd: monthEnd(endMonth), corporate: nextBusinessDay(monthEnd(addMonths(endMonth, 3))), local };
    }
  }
  throw new Error("unreachable");
}

export function buildSchedule(input: ScheduleInput): ScheduleItem[] {
  const { asOf, balances } = input;
  const items: ScheduleItem[] = [];
  const bal = (code: string) => balances[code];

  // 원천세 and 4대보험: the 10th after the payroll month, capped by what is still on the books.
  let withholding = Math.max(0, bal("254") ?? 0);
  let accrued = Math.max(0, bal("262") ?? 0);
  for (const p of [...input.payroll].sort((a, b) => a.payMonth.localeCompare(b.payMonth))) {
    const due = nextBusinessDay(`${addMonths(p.payMonth, 1)}-10`);
    if (due < asOf) continue;
    const month = Number(p.payMonth.slice(5));
    if (bal("254") !== undefined) {
      const tax = Math.min(Math.max(0, p.tax), withholding);
      withholding -= tax;
      if (tax > 0) {
        items.push({ kind: "withholding", label: `${month}월 지급분 원천세·지방소득세`, due, amount: tax, basis: `급여 대장, ${BALANCE_BASIS}`, accountCode: "254" });
      }
    }
    if (bal("254") !== undefined || bal("262") !== undefined) {
      // Employee parts sit in 예수금, the company parts in 미지급비용.
      const ins = Math.min(Math.max(0, p.insurance), withholding + accrued);
      const fromAccrued = Math.min(ins, accrued);
      accrued -= fromAccrued;
      withholding -= ins - fromAccrued;
      if (ins > 0) {
        items.push({ kind: "insurance", label: `${month}월분 4대보험료`, due, amount: ins, basis: `급여 대장, ${BALANCE_BASIS}`, accountCode: "262" });
      }
    }
  }

  const vat = bal("261");
  if (vat !== undefined && vat > 0) {
    items.push({ kind: "vat", label: "부가가치세", due: nextVatDue(asOf), amount: vat, basis: `미지급세금 ${BALANCE_BASIS}`, accountCode: "261" });
  }

  const corp = bal("264");
  if (corp !== undefined && corp > 0) {
    const d = corporateTaxDues(asOf, input.fiscalStartMonth);
    // 지방소득세 is 1/10 of the 법인세, so 1/11 of the combined balance (truncated to 10원).
    const local = Math.floor(corp / 11 / 10) * 10;
    if (d.corporate >= asOf) {
      items.push({ kind: "corporateTax", label: "법인세", due: d.corporate, amount: corp - local, basis: `미지급법인세 ${BALANCE_BASIS} (10/11 추정)`, accountCode: "264" });
    }
    items.push({ kind: "localTax", label: "법인지방소득세", due: d.local, amount: d.corporate >= asOf ? local : corp, basis: `미지급법인세 ${BALANCE_BASIS} (1/11 추정)`, accountCode: "264" });
  }

  for (const c of input.cards) {
    if (c.balance > 0) {
      items.push({ kind: "card", label: `${c.name} 대금`, due: nextDayOfMonth(asOf, 15), amount: c.balance, basis: `미지급금 ${BALANCE_BASIS}`, accountCode: "253", partnerId: c.partnerId });
    }
  }

  const dividend = bal("265");
  if (dividend !== undefined && dividend > 0) {
    items.push({ kind: "dividend", label: "미지급 배당금", due: null, amount: dividend, basis: `미지급배당금 ${BALANCE_BASIS}`, accountCode: "265" });
  }

  return items.sort((a, b) => (a.due ?? "9999") .localeCompare(b.due ?? "9999"));
}
