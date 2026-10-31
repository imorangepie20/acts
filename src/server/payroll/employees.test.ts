import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUserWithMfa } from "@/server/auth/service";
import { employees, payrollAudit, sites, users } from "@/server/db/schema";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import {
  createEmployee,
  getEmployee,
  listEmployees,
  revealEmployeeSecret,
  updateEmployee,
  type EmployeeInput,
} from "./employees";

const db = getTestDb();
let admin: SessionUserWithMfa;
let staff: SessionUserWithMfa;
let siteId: number;

function withCheck(first12: string): string {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = w.reduce((a, x, i) => a + x * Number(first12[i]), 0);
  return first12 + String((11 - (sum % 11)) % 10);
}

const RRN = withCheck("900101123456");
const RRN2 = withCheck("850515234567");
const hyphen = (d: string) => `${d.slice(0, 6)}-${d.slice(6)}`;

const input = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  employeeNo: "E001",
  name: "김철수",
  rrn: hyphen(RRN),
  hiredOn: "2024-03-01",
  leftOn: null,
  siteId,
  departmentId: null,
  isExecutive: false,
  dependents: 3,
  children: 1,
  withholdingRate: 100,
  bank: "국민은행",
  account: "123-456-789012",
  insPension: true,
  insHealth: true,
  insEmployment: true,
  pensionBase: 3_000_000,
  healthBase: 3_000_000,
  defaultAmounts: { basic: 3_000_000, meal: 200_000 },
  ...over,
});

function base(): Omit<EmployeeInput, "rrn" | "account"> {
  const { rrn: _rrn, account: _account, ...rest } = input();
  void _rrn;
  void _account;
  return rest;
}

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin", mfa: "verified" };
  const [s] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "직원", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: s.id, email: "s@test.kr", name: "직원", role: "staff", mfa: "verified" };
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites).limit(1);
});

async function create(over: Partial<EmployeeInput> = {}): Promise<number> {
  const r = await createEmployee(db, admin, input(over));
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

describe("createEmployee / getEmployee", () => {
  it("returns masked values only", async () => {
    const id = await create();
    const e = await getEmployee(db, id);
    expect(e).toMatchObject({
      employeeNo: "E001",
      name: "김철수",
      rrnMasked: "900101-1******",
      accountMasked: "***-****-9012",
      bank: "국민은행",
      defaultAmounts: { basic: 3_000_000, meal: 200_000 },
    });
    expect(e).not.toHaveProperty("rrn");
    expect(e).not.toHaveProperty("account");
    expect(JSON.stringify(e)).not.toContain(RRN);
    expect(JSON.stringify(e)).not.toContain("456789012");
    expect(JSON.stringify(await listEmployees(db, { includeLeft: true }))).not.toContain(RRN);
  });

  it("stores the 주민등록번호 encrypted", async () => {
    const id = await create();
    const [row] = await db.select().from(employees).where(eq(employees.id, id));
    expect(row.rrnEnc).not.toContain("9001011");
    expect(row.rrnEnc).not.toContain(RRN);
    expect(row.accountEnc).not.toContain("456789012");
    expect(row.accountLast4).toBe("9012");
  });

  it("rejects a duplicate 주민등록번호", async () => {
    await create();
    const r = await createEmployee(db, admin, input({ employeeNo: "E002", rrn: RRN }));
    expect(r).toEqual({ ok: false, error: "같은 주민등록번호의 사원이 이미 있습니다." });
  });

  it("rejects an invalid 주민등록번호", async () => {
    const bad = RRN.slice(0, 12) + String((Number(RRN[12]) + 1) % 10);
    const r = await createEmployee(db, admin, input({ rrn: bad }));
    expect(r).toEqual({ ok: false, error: "주민등록번호가 올바르지 않습니다." });
    expect(await createEmployee(db, admin, input({ rrn: "900101-12345" }))).toEqual({
      ok: false,
      error: "주민등록번호가 올바르지 않습니다.",
    });
  });

  it("rejects a duplicate 사번 and bad numbers", async () => {
    await create();
    expect((await createEmployee(db, admin, input({ rrn: RRN2 }))).ok).toBe(false);
    expect((await createEmployee(db, admin, input({ employeeNo: "E2", rrn: RRN2, dependents: 0 }))).ok).toBe(false);
    expect((await createEmployee(db, admin, input({ employeeNo: "E2", rrn: RRN2, withholdingRate: 90 }))).ok).toBe(
      false,
    );
    expect(
      (await createEmployee(db, admin, input({ employeeNo: "E2", rrn: RRN2, defaultAmounts: { nope: 1 } }))).ok,
    ).toBe(false);
    expect(
      (await createEmployee(db, admin, input({ employeeNo: "E2", rrn: RRN2, leftOn: "2024-01-01" }))).ok,
    ).toBe(false);
  });

  it("is forbidden for staff", async () => {
    expect((await createEmployee(db, staff, input())).ok).toBe(false);
  });
});

describe("listEmployees", () => {
  it("hides employees who have left unless asked", async () => {
    await create();
    await create({ employeeNo: "E002", name: "이영희", rrn: RRN2, leftOn: "2025-01-31" });
    expect((await listEmployees(db, { includeLeft: false })).map((e) => e.name)).toEqual(["김철수"]);
    const all = await listEmployees(db, { includeLeft: true });
    expect(all.map((e) => e.rrnMasked)).toEqual(["900101-1******", "850515-2******"]);
  });
});

describe("revealEmployeeSecret", () => {
  it("returns the plain value and writes one audit row", async () => {
    const id = await create();
    expect(await revealEmployeeSecret(db, admin, id, "rrn")).toEqual({ ok: true, value: hyphen(RRN) });
    const audit = await db.select().from(payrollAudit);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: admin.id, employeeId: id, field: "rrn" });
    expect(await revealEmployeeSecret(db, admin, id, "account")).toEqual({ ok: true, value: "123-456-789012" });
    expect(await db.select().from(payrollAudit)).toHaveLength(2);
  });

  it("fails for staff and for a session without the second factor", async () => {
    const id = await create();
    expect((await revealEmployeeSecret(db, staff, id, "rrn")).ok).toBe(false);
    expect((await revealEmployeeSecret(db, { ...admin, mfa: "pending" }, id, "rrn")).ok).toBe(false);
    expect(await db.select().from(payrollAudit)).toHaveLength(0);
  });
});

describe("updateEmployee", () => {
  it("keeps the stored 주민등록번호 and account when omitted", async () => {
    const id = await create();
    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    const r = await updateEmployee(db, admin, id, { ...base(), name: "김철수2", dependents: 2 });
    expect(r.ok).toBe(true);
    const [after] = await db.select().from(employees).where(eq(employees.id, id));
    expect(after.rrnHmac).toBe(before.rrnHmac);
    expect(after.rrnEnc).toBe(before.rrnEnc);
    expect(after.accountEnc).toBe(before.accountEnc);
    expect(after).toMatchObject({ name: "김철수2", dependents: 2 });
  });

  it("replaces or clears them when given", async () => {
    const id = await create();
    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    expect((await updateEmployee(db, admin, id, { ...base(), rrn: RRN2, account: null })).ok).toBe(true);
    const [after] = await db.select().from(employees).where(eq(employees.id, id));
    expect(after.rrnHmac).not.toBe(before.rrnHmac);
    expect(after.accountEnc).toBeNull();
    expect((await getEmployee(db, id))?.rrnMasked).toBe("850515-2******");
  });

  it("rejects a 주민등록번호 another employee has", async () => {
    const id = await create();
    await create({ employeeNo: "E002", rrn: RRN2 });
    expect(await updateEmployee(db, admin, id, { ...base(), rrn: RRN2 })).toEqual({
      ok: false,
      error: "같은 주민등록번호의 사원이 이미 있습니다.",
    });
  });

  it("is forbidden for staff", async () => {
    const id = await create();
    expect((await updateEmployee(db, staff, id, base())).ok).toBe(false);
  });
});
