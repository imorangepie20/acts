import { desc, lte } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { payrollRateKind, payrollRates, withholdingTables } from "@/server/db/schema";
import type { Rates, WithholdingTable } from "@/lib/payroll/types";
import type { RateKind } from "./seed-data/rates";

const FIELD: Record<RateKind, keyof Rates> = {
  pension_employee: "pensionEmployee",
  pension_company: "pensionCompany",
  pension_cap: "pensionCap",
  pension_floor: "pensionFloor",
  health_employee: "healthEmployee",
  health_company: "healthCompany",
  ltc_employee: "ltcEmployee",
  ltc_company: "ltcCompany",
  employment_employee: "employmentEmployee",
  employment_company: "employmentCompany",
};

/** Per kind, the row with the latest effective_from <= date (the 귀속월 1일). */
export async function loadRates(db: Db, date: string): Promise<Rates> {
  const rows = await db
    .selectDistinctOn([payrollRates.kind], { kind: payrollRates.kind, value: payrollRates.value })
    .from(payrollRates)
    .where(lte(payrollRates.effectiveFrom, date))
    .orderBy(payrollRates.kind, desc(payrollRates.effectiveFrom));
  const byKind = new Map(rows.map((r) => [r.kind, Number(r.value)]));
  const rates = {} as Rates;
  for (const kind of payrollRateKind.enumValues) {
    const v = byKind.get(kind);
    if (v === undefined) throw new Error(`${date} 기준 ${kind} 요율이 없습니다.`);
    rates[FIELD[kind]] = v;
  }
  return rates;
}

/** The 간이세액표 in force on date (the run's 지급일). */
export async function loadWithholdingTable(db: Db, date: string): Promise<WithholdingTable> {
  const [row] = await db
    .select({ data: withholdingTables.data })
    .from(withholdingTables)
    .where(lte(withholdingTables.effectiveFrom, date))
    .orderBy(desc(withholdingTables.effectiveFrom))
    .limit(1);
  if (!row) throw new Error(`${date} 기준 근로소득 간이세액표가 없습니다.`);
  return row.data;
}
