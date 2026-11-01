import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUser } from "@/server/auth/service";
import { payrollRunLines, users } from "@/server/db/schema";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { createPayrollVoucher } from "../../../tests/helpers/payroll";
import { createRun } from "@/server/payroll/runs";
import { latestConfirmedPayMonth, loadReturnRuns } from "./return";

const db = getTestDb();
let admin: SessionUser;

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin" };
});

it("ignores draft runs", async () => {
  await createPayrollVoucher(db, admin, { yearMonth: "2026-06", payDate: "2026-06-25" });
  const d = await createRun(db, admin, { type: "regular", yearMonth: "2026-07", payDate: "2026-07-25" });
  if (!d.ok) throw new Error(d.error);
  const runs = await loadReturnRuns(db, { payFrom: "2026-01-01", payTo: "2026-12-31" });
  expect(runs.map((r) => r.yearMonth)).toEqual(["2026-06"]);
  expect(await latestConfirmedPayMonth(db)).toBe("2026-06");
});

it("returns gross, tax and local tax per line", async () => {
  await createPayrollVoucher(db, admin);
  const [run] = await loadReturnRuns(db, { payFrom: "2026-06-01", payTo: "2026-06-30" });
  expect(run.payDate).toBe("2026-06-25");
  expect(run.lines).toHaveLength(1);
  expect(run.lines[0]).toMatchObject({ gross: 3_200_000, excludedNontaxable: 0 });
  expect(run.lines[0].incomeTax).toBeGreaterThanOrEqual(0);
});

it("recomputes excludedNontaxable from current items for lines without it", async () => {
  await createPayrollVoucher(db, admin);
  const [row] = await db.select().from(payrollRunLines);
  expect(row.result.excludedNontaxable).toBeDefined();
  // Old-style line: no field, and a 자가운전보조금 amount in the run.
  const { excludedNontaxable: _drop, ...rest } = row.result;
  void _drop;
  await db
    .update(payrollRunLines)
    .set({ result: rest, amounts: { ...row.amounts, car: 300_000 } })
    .where(eq(payrollRunLines.runId, row.runId));
  const [run] = await loadReturnRuns(db, { payFrom: "2026-06-01", payTo: "2026-06-30" });
  expect(run.lines[0].excludedNontaxable).toBe(200_000);
});

it("range is inclusive on pay dates", async () => {
  await createPayrollVoucher(db, admin, { yearMonth: "2026-06", payDate: "2026-06-25" });
  expect(await loadReturnRuns(db, { payFrom: "2026-06-25", payTo: "2026-06-25" })).toHaveLength(1);
  expect(await loadReturnRuns(db, { payFrom: "2026-06-26", payTo: "2026-06-30" })).toHaveLength(0);
  expect(await loadReturnRuns(db, { payFrom: "2026-06-01", payTo: "2026-06-24" })).toHaveLength(0);
});
