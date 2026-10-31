import { eq } from "drizzle-orm";
import { seedPayroll } from "../../scripts/seed";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { payrollRuns, sites } from "@/server/db/schema";
import { createEmployee } from "@/server/payroll/employees";
import { confirmRun, createRun, getRun } from "@/server/payroll/runs";

/**
 * One confirmed 정기 payroll run (one non-executive employee, 기본급 3,000,000 + 식대 200,000, so the
 * voucher debits 802). Needs the reference data and a manager/admin `actor`; returns the voucher id.
 * The voucher is approved when the company's approval setting is off.
 */
export async function createPayrollVoucher(
  db: Db,
  actor: SessionUser,
  opts: { yearMonth?: string; payDate?: string } = {},
): Promise<string> {
  await seedPayroll(db);
  const [{ id: siteId }] = await db.select({ id: sites.id }).from(sites).limit(1);
  const e = await createEmployee(db, actor, {
    employeeNo: "P001",
    name: "급여사원",
    rrn: "9001011234568",
    hiredOn: "2024-01-01",
    leftOn: null,
    siteId,
    departmentId: null,
    isExecutive: false,
    dependents: 1,
    children: 0,
    withholdingRate: 100,
    bank: "국민은행",
    account: "110-222-330001",
    insPension: true,
    insHealth: true,
    insEmployment: true,
    pensionBase: 3_000_000,
    healthBase: 3_000_000,
    defaultAmounts: { basic: 3_000_000, meal: 200_000 },
  });
  if (!e.ok) throw new Error(e.error);
  const r = await createRun(db, actor, {
    type: "regular",
    yearMonth: opts.yearMonth ?? "2026-06",
    payDate: opts.payDate ?? "2026-06-25",
  });
  if (!r.ok) throw new Error(r.error);
  const run = await getRun(db, r.value.id);
  if (!run) throw new Error("run not found");
  const c = await confirmRun(db, actor, run.id, run.version);
  if (!c.ok) throw new Error(c.error);
  const [row] = await db.select({ voucherId: payrollRuns.voucherId }).from(payrollRuns).where(eq(payrollRuns.id, run.id));
  if (!row?.voucherId) throw new Error("no payroll voucher");
  return row.voucherId;
}
