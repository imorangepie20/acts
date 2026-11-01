import { returnPairs, buildReturn, type ReturnFigures, type ReturnPeriod } from "@/lib/withholding/return";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { getCompany } from "@/server/company/service";
import type { Db } from "@/server/db/client";
import { latestConfirmedPayMonth, loadReturnRuns } from "./return";

export type SearchParams = Record<string, string | string[] | undefined>;

/** The chosen period as the picker shows it (always complete, defaults filled in). */
export type ReturnSelection =
  | { mode: "monthly"; pay: string; attr: string | null; refund: number }
  | { mode: "semiannual"; year: number; half: 1 | 2; refund: number };

export type ReturnView = {
  selection: ReturnSelection;
  company: { name: string; businessNumber: string | null; representative: string | null };
  /** One form per 귀속월 paid in the 지급월 (monthly), or the single 반기 form. */
  forms: ReturnFigures[];
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** Reads `mode`, `pay`, `attr`, `year`, `half`, `refund`; anything invalid falls back to the default. */
export function parseReturnParams(
  sp: SearchParams,
  defaults: { semiannual: boolean; payMonth: string },
): ReturnSelection {
  const mode = one(sp.mode) === "semiannual" ? "semiannual" : one(sp.mode) === "monthly" ? "monthly" : defaults.semiannual ? "semiannual" : "monthly";
  const rawRefund = one(sp.refund);
  const refund = rawRefund && /^\d{1,12}$/.test(rawRefund) ? Number(rawRefund) : 0;
  if (mode === "monthly") {
    const pay = one(sp.pay);
    const attr = one(sp.attr);
    return {
      mode,
      pay: pay && MONTH_RE.test(pay) ? pay : defaults.payMonth,
      attr: attr && MONTH_RE.test(attr) ? attr : null,
      refund,
    };
  }
  const y = one(sp.year);
  const h = one(sp.half);
  const defHalf: 1 | 2 = Number(defaults.payMonth.slice(5)) <= 6 ? 1 : 2;
  return {
    mode,
    year: y && /^\d{4}$/.test(y) ? Number(y) : Number(defaults.payMonth.slice(0, 4)),
    half: h === "1" ? 1 : h === "2" ? 2 : defHalf,
    refund,
  };
}

/** Loads the confirmed runs of the selection and builds the form(s). */
export async function loadReturnView(db: Db, sp: SearchParams): Promise<ReturnView> {
  const company = await getCompany(db);
  const payMonth = (await latestConfirmedPayMonth(db)) ?? todayInSeoul().slice(0, 7);
  const selection = parseReturnParams(sp, { semiannual: company.withholdingSemiannual, payMonth });
  const companyInfo = {
    name: company.name,
    businessNumber: company.businessNumber,
    representative: company.representative,
  };

  if (selection.mode === "semiannual") {
    const { year, half } = selection;
    const runs = await loadReturnRuns(db, {
      payFrom: `${year}-${half === 1 ? "01" : "07"}-01`,
      payTo: `${year}-${half === 1 ? "06-30" : "12-31"}`,
    });
    // No confirmed run in the half: no form (the page says so and the export is refused).
    if (runs.length === 0) return { selection, company: companyInfo, forms: [] };
    const period: ReturnPeriod = { mode: "semiannual", year, half };
    return { selection, company: companyInfo, forms: [buildReturn(period, runs, selection.refund)] };
  }

  const [y, m] = selection.pay.split("-").map(Number);
  const runs = await loadReturnRuns(db, {
    payFrom: `${selection.pay}-01`,
    payTo: `${selection.pay}-${pad(lastDay(y, m))}`,
  });
  // An explicit 귀속월 keeps only its pair; no confirmed run for it means no form.
  const pairs = returnPairs(runs).filter((p) => !selection.attr || p.attributionMonth === selection.attr);
  // One ⑫ for the whole 지급월: each form carries its ⑳ into the next, so it is never applied twice.
  let carried = selection.refund;
  const forms = pairs.map((p) => {
    const f = buildReturn({ mode: "monthly", ...p }, runs, carried);
    carried = f.refund.carriedOut;
    return f;
  });
  return { selection, company: companyInfo, forms };
}
