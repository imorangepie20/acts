import { and, asc, eq, gte, lte, max } from "drizzle-orm";
import { splitTaxable } from "@/lib/payroll/calc";
import type { ItemDef } from "@/lib/payroll/types";
import type { ReturnRunInput } from "@/lib/withholding/return";
import type { Db } from "@/server/db/client";
import { payrollItems, payrollRunLines, payrollRuns } from "@/server/db/schema";

/**
 * Confirmed runs paid from `payFrom` to `payTo` (both inclusive, YYYY-MM-DD), shaped for `buildReturn`.
 * A line computed before Phase 3 has no `excludedNontaxable`; it is recomputed from the current items.
 */
export async function loadReturnRuns(db: Db, range: { payFrom: string; payTo: string }): Promise<ReturnRunInput[]> {
  const rows = await db
    .select({
      runId: payrollRuns.id,
      yearMonth: payrollRuns.yearMonth,
      payDate: payrollRuns.payDate,
      employeeId: payrollRunLines.employeeId,
      amounts: payrollRunLines.amounts,
      result: payrollRunLines.result,
    })
    .from(payrollRuns)
    .innerJoin(payrollRunLines, eq(payrollRunLines.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollRuns.status, "confirmed"),
        gte(payrollRuns.payDate, range.payFrom),
        lte(payrollRuns.payDate, range.payTo),
      ),
    )
    .orderBy(asc(payrollRuns.payDate), asc(payrollRuns.yearMonth), asc(payrollRuns.id), asc(payrollRunLines.employeeId));

  let items: ItemDef[] | null = null;
  const currentItems = async (): Promise<ItemDef[]> =>
    (items ??= await db
      .select({
        code: payrollItems.code,
        name: payrollItems.name,
        taxable: payrollItems.taxable,
        nontaxLimit: payrollItems.nontaxLimit,
        inEmploymentBase: payrollItems.inEmploymentBase,
        excludeFromTotalPaid: payrollItems.excludeFromTotalPaid,
      })
      .from(payrollItems));

  const byRun = new Map<string, ReturnRunInput>();
  for (const r of rows) {
    let run = byRun.get(r.runId);
    if (!run) {
      run = { yearMonth: r.yearMonth, payDate: r.payDate, lines: [] };
      byRun.set(r.runId, run);
    }
    const excludedNontaxable =
      r.result.excludedNontaxable ?? splitTaxable(await currentItems(), r.amounts).excludedNontaxable;
    run.lines.push({
      employeeId: r.employeeId,
      gross: r.result.gross,
      excludedNontaxable,
      incomeTax: r.result.deductions.incomeTax,
      localTax: r.result.deductions.localTax,
    });
  }
  return [...byRun.values()];
}

/** The 지급월 (YYYY-MM) of the latest confirmed run, or null when none is confirmed. */
export async function latestConfirmedPayMonth(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ d: max(payrollRuns.payDate) })
    .from(payrollRuns)
    .where(eq(payrollRuns.status, "confirmed"));
  return row?.d ? row.d.slice(0, 7) : null;
}
