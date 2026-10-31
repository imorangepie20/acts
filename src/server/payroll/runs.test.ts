import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import { bonusIncomeTax } from "@/lib/payroll/bonus";
import { floor10, monthlyIncomeTax } from "@/lib/payroll/calc";
import { addAttachment } from "@/server/attachments/service";
import type { SessionUser } from "@/server/auth/service";
import { closeMonth } from "@/server/closing/periods";
import { accounts, company, employees, payrollRuns, sites, users, voucherHistory, vouchers } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import {
  canDecidePayroll,
  deleteVoucher,
  ERR_CONFLICT,
  ERR_PAYROLL_ONLY,
  rejectVoucher,
  updateVoucher,
} from "@/server/vouchers/service";
import { createEmployee, type EmployeeInput } from "./employees";
import { loadRates, loadWithholdingTable } from "./rates";
import {
  addEmployeeToRun,
  cancelConfirm,
  confirmRun,
  createRun,
  deleteRun,
  getRun,
  listRuns,
  recomputeRun,
  removeEmployeeFromRun,
  updateRunLines,
  type RunLineChange,
} from "./runs";
import { savePayrollSettings } from "./settings";

const db = getTestDb();
let admin: SessionUser;
let staff: SessionUser;
let siteId: number;
let seq = 0;

function withCheck(first12: string): string {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((a, x, i) => a + x * Number(first12[i]), 0);
  return first12 + String((11 - (sum % 11)) % 10);
}

async function emp(over: Partial<EmployeeInput> = {}): Promise<number> {
  seq += 1;
  const rrn = withCheck(`9001011${String(seq).padStart(5, "0")}`);
  const input: EmployeeInput = {
    employeeNo: `E${String(seq).padStart(3, "0")}`,
    name: `사원${seq}`,
    rrn,
    hiredOn: "2024-01-01",
    leftOn: null,
    siteId,
    departmentId: null,
    isExecutive: false,
    dependents: 2,
    children: 0,
    withholdingRate: 100,
    bank: "국민은행",
    account: `110-222-33${String(seq).padStart(4, "0")}`,
    insPension: true,
    insHealth: true,
    insEmployment: true,
    pensionBase: 3_000_000,
    healthBase: 3_000_000,
    defaultAmounts: { basic: 3_000_000, meal: 200_000 },
    ...over,
  };
  const r = await createEmployee(db, admin, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

async function run(input: Parameters<typeof createRun>[2]): Promise<string> {
  const r = await createRun(db, admin, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

const regular = (yearMonth: string, payDate: string) => ({ type: "regular" as const, yearMonth, payDate });

async function detail(id: string) {
  const d = await getRun(db, id);
  if (!d) throw new Error("run not found");
  return d;
}

async function confirm(id: string) {
  const r = await confirmRun(db, admin, id, (await detail(id)).version);
  if (!r.ok) throw new Error(r.error);
  return detail(id);
}

const setApproval = (on: boolean) => db.update(company).set({ approvalRequired: on }).where(eq(company.id, 1));

beforeEach(async () => {
  seq = 0;
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin" };
  const [s] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "직원", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: s.id, email: "s@test.kr", name: "직원", role: "staff" };
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites).limit(1);
});

describe("createRun", () => {
  it("createRun skips employees not employed in the 귀속월", async () => {
    const active = await emp();
    await emp({ hiredOn: "2024-01-01", leftOn: "2026-05-31" }); // left before
    await emp({ hiredOn: "2026-07-01" }); // hired after
    const leftOnFirst = await emp({ hiredOn: "2024-01-01", leftOn: "2026-06-01" });
    const hiredOnLast = await emp({ hiredOn: "2026-06-30" });
    const d = await detail(await run(regular("2026-06", "2026-06-25")));
    expect(d.lines.map((l) => l.employeeId).sort((x, y) => x - y)).toEqual([active, leftOnFirst, hiredOnLast]);
    expect(d.status).toBe("draft");
    expect(d.lines[0].amounts).toEqual({ basic: 3_000_000, meal: 200_000 });
  });

  it("createRun uses 귀속월 rates and 지급일 table", async () => {
    await emp({ pensionBase: 8_000_000, healthBase: 3_000_000 });
    const d = await detail(await run(regular("2026-06", "2026-07-10")));
    const rates = await loadRates(db, "2026-06-01");
    const table = await loadWithholdingTable(db, "2026-07-10");
    const line = d.lines[0];
    expect(line.snapshot.rates.pensionCap).toBe(6_370_000);
    expect(line.result.deductions.pension).toBe(floor10((6_370_000 * rates.pensionEmployee) / 100));
    expect(line.result.deductions.incomeTax).toBe(monthlyIncomeTax(table, 3_000_000, 2, 0));
    expect(line.result.taxable).toBe(3_000_000);
    expect(line.result.nontaxable).toBe(200_000);
  });

  it("rejects a duplicate regular run with the exact message; a second bonus run succeeds", async () => {
    await emp();
    await run(regular("2026-06", "2026-06-25"));
    expect(await createRun(db, admin, regular("2026-06", "2026-06-30"))).toEqual({
      ok: false,
      error: "2026년 6월 정기 급여 대장이 이미 있습니다.",
    });
    const bonus = { type: "bonus" as const, yearMonth: "2026-06", payDate: "2026-06-25" };
    expect((await createRun(db, admin, bonus)).ok).toBe(true);
    expect((await createRun(db, admin, bonus)).ok).toBe(true);
    const b = (await listRuns(db, { year: 2026 })).filter((r) => r.type === "bonus");
    expect(b).toHaveLength(2);
  });

  it("starts bonus runs at 0 and copies the latest confirmed regular amounts", async () => {
    const e = await emp();
    const may = await run(regular("2026-05", "2026-05-25"));
    await updateRunLines(db, admin, may, (await detail(may)).version, [{ employeeId: e, amounts: { basic: 3_300_000 } }]);
    await confirm(may);
    const june = await detail(await run(regular("2026-06", "2026-06-25")));
    expect(june.lines[0].amounts).toEqual({ basic: 3_300_000, meal: 200_000 });
    const bonus = await detail(await run({ type: "bonus", yearMonth: "2026-06", payDate: "2026-06-25" }));
    expect(bonus.lines[0].result.gross).toBe(0);
  });

  it("refuses without payroll:manage and on bad input", async () => {
    expect((await createRun(db, staff, regular("2026-06", "2026-06-25"))).ok).toBe(false);
    expect((await createRun(db, admin, regular("2026-13", "2026-06-25"))).ok).toBe(false);
    expect((await createRun(db, admin, regular("2026-06", "2026-06-31"))).ok).toBe(false);
    expect(
      (await createRun(db, admin, { type: "bonus", yearMonth: "2026-06", payDate: "2026-06-25", bonusFrom: "2026-03" }))
        .ok,
    ).toBe(false);
  });
});

describe("editing a draft run", () => {
  it("recomputes changed lines, sets and clears overrides, rejects negatives", async () => {
    const e = await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    let d = await detail(id);
    const calculated = d.lines[0].result.deductions.incomeTax;

    const r = await updateRunLines(db, admin, id, d.version, [
      { employeeId: e, amounts: { basic: 4_000_000 }, overrides: { incomeTax: 12_340 } },
    ]);
    expect(r).toEqual({ ok: true, value: { version: d.version + 1 } });
    d = await detail(id);
    expect(d.lines[0].amounts.basic).toBe(4_000_000);
    expect(d.lines[0].result.gross).toBe(4_200_000);
    expect(d.lines[0].result.deductions.incomeTax).toBe(12_340);
    expect(d.lines[0].result.deductions.localTax).toBe(1_230);
    expect(d.lines[0].overrides).toEqual({ incomeTax: 12_340 });
    expect(d.lines[0].snapshot.calculated.incomeTax).not.toBe(calculated);

    expect((await updateRunLines(db, admin, id, d.version, [{ employeeId: e, overrides: { incomeTax: null } }])).ok).toBe(
      true,
    );
    d = await detail(id);
    expect(d.lines[0].overrides).toEqual({});
    expect(d.lines[0].result.deductions.incomeTax).toBe(d.lines[0].snapshot.calculated.incomeTax);

    const bads: RunLineChange[] = [
      { employeeId: e, amounts: { basic: -1 } },
      { employeeId: e, amounts: { basic: 1.5 } },
      { employeeId: e, amounts: { nope: 1 } },
      { employeeId: e, overrides: { health: -10 } },
      { employeeId: 999_999, amounts: { basic: 1 } },
    ];
    for (const bad of bads) {
      expect((await updateRunLines(db, admin, id, d.version, [bad])).ok).toBe(false);
    }
    expect((await detail(id)).version).toBe(d.version);
  });

  it("adds, removes, recomputes and deletes a draft run", async () => {
    const a = await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    const b = await emp({ hiredOn: "2026-07-01" }); // not employed in June: only added by hand
    let d = await detail(id);
    expect((await addEmployeeToRun(db, admin, id, d.version, b)).ok).toBe(true);
    d = await detail(id);
    expect(d.lines).toHaveLength(2);
    expect((await addEmployeeToRun(db, admin, id, d.version, b)).ok).toBe(false);
    expect((await removeEmployeeFromRun(db, admin, id, d.version, b)).ok).toBe(true);
    d = await detail(id);
    expect(d.lines.map((l) => l.employeeId)).toEqual([a]);

    await db.update(employees).set({ dependents: 4 }).where(eq(employees.id, a));
    expect((await recomputeRun(db, admin, id, d.version)).ok).toBe(true);
    d = await detail(id);
    expect(d.lines[0].snapshot.calc.dependents).toBe(4);

    expect(await deleteRun(db, admin, id, d.version - 1)).toEqual({ ok: false, error: ERR_CONFLICT });
    expect((await deleteRun(db, admin, id, d.version)).ok).toBe(true);
    expect(await getRun(db, id)).toBeNull();
  });

  it("keeps plain 주민등록번호 and account numbers out of the line snapshot", async () => {
    await emp();
    const d = await detail(await run(regular("2026-06", "2026-06-25")));
    const s = d.lines[0].snapshot;
    const json = JSON.stringify(s);
    expect(s.rrnMasked).toMatch(/^900101-1\*{6}$/);
    expect(json).not.toMatch(/9001011\d{6}/);
    expect(json).not.toContain("110-222-33");
    expect(s.accountMasked).toBe("***-****-0001");
  });
});

describe("confirmRun", () => {
  it("confirm creates one approved payroll voucher when approval is off", async () => {
    await emp();
    await emp({ isExecutive: true, defaultAmounts: { basic: 5_000_000 } });
    const id = await run(regular("2026-06", "2026-06-25"));
    const d = await confirm(id);
    expect(d.status).toBe("confirmed");
    expect(d.voucherStatus).toBe("approved");
    const vs = await db.select().from(vouchers);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ id: d.voucherId, kind: "payroll", status: "approved", date: "2026-06-25" });
    expect(vs[0].description).toBe("2026년 6월 급여");
    expect((await updateRunLines(db, admin, id, d.version, [{ employeeId: d.lines[0].employeeId, amounts: { basic: 1 } }])).ok).toBe(
      false,
    );
  });

  it("confirm creates a pending voucher when approval is on", async () => {
    await emp();
    await setApproval(true);
    const d = await confirm(await run(regular("2026-06", "2026-06-25")));
    expect(d.voucherStatus).toBe("pending");
  });

  it("confirm fails with ERR_CONFLICT after a concurrent line edit", async () => {
    const e = await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    const stale = (await detail(id)).version;
    expect((await updateRunLines(db, admin, id, stale, [{ employeeId: e, amounts: { basic: 3_100_000 } }])).ok).toBe(true);
    expect(await confirmRun(db, admin, id, stale)).toEqual({ ok: false, error: ERR_CONFLICT });
    expect(await db.select().from(vouchers)).toHaveLength(0);
  });

  it("refuses an unusable mapped account and a missing required partner", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.code, "254"));
    expect(await confirmRun(db, admin, id, (await detail(id)).version)).toEqual({
      ok: false,
      error: "급여 설정의 예수금(근로자 부담분·소득세) 계정을 사용할 수 없습니다. 급여 설정에서 계정을 다시 고르세요.",
    });
    await db.update(accounts).set({ isActive: true, requiresPartner: true }).where(eq(accounts.code, "254"));
    expect(await confirmRun(db, admin, id, (await detail(id)).version)).toEqual({
      ok: false,
      error: "254 예수금 계정은 거래처가 필요합니다. 급여 설정에서 기관 거래처를 지정하세요.",
    });
    expect(await db.select().from(vouchers)).toHaveLength(0);

    const p = async (name: string) => {
      const r = await createPartner(db, {
        name,
        businessNumber: null,
        representative: null,
        phone: null,
        email: null,
        memo: null,
      });
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const ids = [await p("국민연금공단"), await p("국민건강보험공단"), await p("근로복지공단"), await p("세무서"), await p("구청")];
    const s = await savePayrollSettings(db, admin, {
      pensionCompanyCode: "817",
      insuranceCompanyCode: "811",
      withholdingCode: "254",
      companyPayableCode: "262",
      netPayCode: "103",
      executiveCode: "801",
      staffCode: "802",
      pensionPartnerId: ids[0],
      healthPartnerId: ids[1],
      employmentPartnerId: ids[2],
      taxPartnerId: ids[3],
      localTaxPartnerId: ids[4],
    });
    expect(s.ok).toBe(true);
    const d = await confirm(id);
    expect(d.status).toBe("confirmed");
  });

  it("refuses in a closed month", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-07-10"));
    expect((await closeMonth(db, admin, "2026-07")).ok).toBe(true);
    const r = await confirmRun(db, admin, id, (await detail(id)).version);
    expect(r).toEqual({ ok: false, error: "마감된 월(2026-07)의 전표는 추가·수정·삭제할 수 없습니다." });
    expect((await detail(id)).status).toBe("draft");
  });
});

describe("cancelConfirm", () => {
  it("cancelConfirm deletes the voucher and returns to draft", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    const d = await confirm(id);
    expect((await cancelConfirm(db, admin, id, d.version)).ok).toBe(true);
    const after = await detail(id);
    expect(after).toMatchObject({ status: "draft", voucherId: null, voucherStatus: null, version: d.version + 1 });
    expect(await db.select().from(vouchers)).toHaveLength(0);
    const history = await db.select().from(voucherHistory).where(eq(voucherHistory.voucherId, d.voucherId!));
    expect(history.map((h) => h.action)).toEqual(["created", "deleted"]);
    // and confirm again
    expect((await confirm(id)).status).toBe("confirmed");
  });

  it("cancelConfirm refuses in a closed month", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-07-10"));
    const d = await confirm(id);
    expect((await closeMonth(db, admin, "2026-07")).ok).toBe(true);
    expect(await cancelConfirm(db, admin, id, d.version)).toEqual({
      ok: false,
      error: "마감된 월(2026-07)의 전표는 추가·수정·삭제할 수 없습니다.",
    });
    expect(await detail(id)).toMatchObject({ status: "confirmed", voucherId: d.voucherId, version: d.version });
    expect(await db.select().from(vouchers).where(eq(vouchers.id, d.voucherId!))).toHaveLength(1);
  });

  it("returns a run whose voucher is gone to draft", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    const d = await confirm(id);
    await db.delete(vouchers).where(eq(vouchers.id, d.voucherId!));
    expect((await cancelConfirm(db, admin, id, d.version)).ok).toBe(true);
    expect((await detail(id)).status).toBe("draft");
  });

  it("refuses a draft run and a stale version", async () => {
    await emp();
    const id = await run(regular("2026-06", "2026-06-25"));
    expect((await cancelConfirm(db, admin, id, (await detail(id)).version)).ok).toBe(false);
    const d = await confirm(id);
    expect(await cancelConfirm(db, admin, id, d.version - 1)).toEqual({ ok: false, error: ERR_CONFLICT });
    expect((await deleteRun(db, admin, id, d.version)).ok).toBe(false);
  });
});

describe("the payroll voucher from the voucher screens", () => {
  it("updateVoucher / deleteVoucher / addAttachment give ERR_PAYROLL_ONLY", async () => {
    await emp();
    const d = await confirm(await run(regular("2026-06", "2026-06-25")));
    const [v] = await db.select().from(vouchers).where(eq(vouchers.id, d.voucherId!));
    expect(ERR_PAYROLL_ONLY).toBe("급여 전표는 급여 대장에서 확정을 취소해야 고칠 수 있습니다.");
    const input = {
      date: v.date,
      description: "x",
      entryType: "general" as const,
      kind: "general" as const,
      partnerId: null,
      evidenceType: "none" as const,
      vatType: null,
      vatDeductible: null,
      supplyAmount: null,
      vatAmount: null,
      lines: [],
    };
    expect(await updateVoucher(db, admin, v.id, v.version, input)).toEqual({ ok: false, error: ERR_PAYROLL_ONLY });
    expect(await deleteVoucher(db, admin, v.id, v.version)).toEqual({ ok: false, error: ERR_PAYROLL_ONLY });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await addAttachment(db, admin, v.id, { name: "a.png", bytes: png })).toEqual({
      ok: false,
      error: ERR_PAYROLL_ONLY,
    });
  });

  it("shows a rejected voucher and its reason in getRun; cancelConfirm then deletes it", async () => {
    await emp();
    await setApproval(true);
    const id = await run(regular("2026-06", "2026-06-25"));
    const d = await confirm(id);
    const [v] = await db.select().from(vouchers).where(eq(vouchers.id, d.voucherId!));
    expect((await rejectVoucher(db, admin, v.id, v.version, "금액 확인 필요")).ok).toBe(true);
    const rejected = await detail(id);
    expect(rejected).toMatchObject({ voucherStatus: "rejected", voucherRejectReason: "금액 확인 필요" });
    expect((await cancelConfirm(db, admin, id, rejected.version)).ok).toBe(true);
    expect(await db.select().from(vouchers)).toHaveLength(0);
  });

  it("approving a payroll voucher needs payroll:manage as well", () => {
    expect(canDecidePayroll("staff")).toBe(false);
    expect(canDecidePayroll("executive")).toBe(false);
    expect(canDecidePayroll("manager")).toBe(true);
    expect(canDecidePayroll("admin")).toBe(true);
  });
});

describe("bonus runs", () => {
  async function regularRuns(e: number, months: string[], basic: number) {
    for (const m of months) {
      const id = await run(regular(m, `${m}-25`));
      await updateRunLines(db, admin, id, (await detail(id)).version, [{ employeeId: e, amounts: { basic } }]);
      await confirm(id);
    }
  }

  it("a bonus run's 소득세 matches bonusIncomeTax given the confirmed regular runs in the period", async () => {
    const e = await emp({ dependents: 3, children: 1 });
    await regularRuns(e, ["2026-01", "2026-02", "2026-03"], 3_500_000);
    // a draft regular run in the period does not count
    await run(regular("2026-04", "2026-04-25"));
    const id = await run({ type: "bonus", yearMonth: "2026-04", payDate: "2026-04-10", bonusFrom: "2026-01", bonusTo: "2026-04" });
    expect((await updateRunLines(db, admin, id, (await detail(id)).version, [{ employeeId: e, amounts: { bonus: 6_000_000 } }])).ok).toBe(true);
    const d = await detail(id);
    const line = d.lines[0];

    const runs = (await listRuns(db, { year: 2026 })).filter((r) => r.type === "regular" && r.status === "confirmed");
    expect(runs).toHaveLength(3);
    let regularTaxable = 0;
    let withheld = 0;
    for (const r of runs) {
      const l = (await detail(r.id)).lines[0];
      regularTaxable += l.result.taxable;
      withheld += l.result.deductions.incomeTax;
    }
    const expected = bonusIncomeTax({
      table: await loadWithholdingTable(db, "2026-04-10"),
      bonusTaxable: 6_000_000,
      periodRegularTaxable: regularTaxable,
      periodWithheld: withheld,
      months: 4,
      dependents: 3,
      children: 1,
      withholdingRate: 100,
    });
    expect(regularTaxable).toBe(3 * 3_500_000);
    expect(line.result.deductions.incomeTax).toBe(expected);
    expect(line.result.deductions.localTax).toBe(floor10(expected / 10));
    expect(line.snapshot.bonus).toEqual({ from: "2026-01", to: "2026-04", months: 4, regularTaxable, withheld });
    // 상여 has no 국민연금 / 건강 / 장기요양, but 고용보험 applies
    expect(line.result.deductions.pension).toBe(0);
    expect(line.result.deductions.health).toBe(0);
    expect(line.result.deductions.ltc).toBe(0);
    expect(line.result.deductions.employment).toBeGreaterThan(0);

    const v = await confirm(id);
    const [voucher] = await db.select().from(vouchers).where(eq(vouchers.id, v.voucherId!));
    expect(voucher.description).toBe("2026년 4월 상여");
  });

  it("without a period: January, or the month after an earlier 상여 paid the same year (소득세법 제136조)", async () => {
    const e = await emp();
    const first = await run({ type: "bonus", yearMonth: "2026-02", payDate: "2026-02-10" });
    await updateRunLines(db, admin, first, (await detail(first)).version, [{ employeeId: e, amounts: { bonus: 1_000_000 } }]);
    expect((await detail(first)).lines[0].snapshot.bonus).toMatchObject({ from: "2026-01", to: "2026-02", months: 2 });
    await confirm(first);

    const second = await run({ type: "bonus", yearMonth: "2026-06", payDate: "2026-06-10" });
    await updateRunLines(db, admin, second, (await detail(second)).version, [{ employeeId: e, amounts: { bonus: 1_000_000 } }]);
    expect((await detail(second)).lines[0].snapshot.bonus).toMatchObject({ from: "2026-03", to: "2026-06", months: 4 });
  });
});

describe("listRuns", () => {
  it("lists the year's runs with totals", async () => {
    await emp();
    await emp();
    await run(regular("2026-06", "2026-06-25"));
    await run(regular("2025-12", "2025-12-26"));
    const rows = await listRuns(db, { year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ yearMonth: "2026-06", type: "regular", status: "draft", employeeCount: 2, gross: 6_400_000 });
    const [r] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.yearMonth, "2025-12")));
    expect(r.type).toBe("regular");
  });
});
