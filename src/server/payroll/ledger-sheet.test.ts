import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUser } from "@/server/auth/service";
import { sites, users } from "@/server/db/schema";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { createEmployee } from "./employees";
import { buildPayrollLedgerSheet } from "./ledger-sheet";
import { createRun, getRun } from "./runs";

const db = getTestDb();
let admin: SessionUser;

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin" };
});

async function runWith(rrn: string, type: "regular" | "bonus") {
  const [{ id: siteId }] = await db.select({ id: sites.id }).from(sites).limit(1);
  const e = await createEmployee(db, admin, {
    employeeNo: "E001",
    name: "홍길동",
    rrn,
    hiredOn: "2024-01-01",
    leftOn: null,
    siteId,
    departmentId: null,
    isExecutive: false,
    dependents: 1,
    children: 0,
    withholdingRate: 100,
    bank: "국민은행",
    account: "110-222-334455",
    insPension: true,
    insHealth: true,
    insEmployment: true,
    pensionBase: 3_000_000,
    healthBase: 3_000_000,
    defaultAmounts: { basic: 3_000_000, meal: 200_000 },
  });
  if (!e.ok) throw new Error(e.error);
  const r = await createRun(db, admin, { type, yearMonth: "2026-06", payDate: "2026-06-25" });
  if (!r.ok) throw new Error(r.error);
  return (await getRun(db, r.value.id))!;
}

it("has the masked 주민등록번호 and account only, items, deductions and a 합계 row", async () => {
  const run = await runWith("900101-1234568", "regular");
  const spec = buildPayrollLedgerSheet(run, "테스트 회사");
  expect(spec.fileName).toBe("급여대장_2026-06");
  expect(spec.title).toBe("2026년 6월 정기 급여 대장");
  expect(spec.meta).toContain("회사: 테스트 회사");
  expect(spec.columns.map((c) => c.header)).toEqual(
    expect.arrayContaining(["주민등록번호", "기본급", "식대", "국민연금", "소득세", "공제 계", "실지급액"]),
  );
  const [line, total] = spec.rows;
  expect(line).toMatchObject({ employeeNo: "E001", rrn: "900101-1******", "item:basic": 3_000_000, "item:meal": 200_000 });
  expect(line["ded:pension"]).toBe(run.lines[0].result.deductions.pension);
  expect(total).toMatchObject({ employeeNo: "합계", gross: 3_200_000, netPay: run.lines[0].result.netPay });
  expect(spec.emphasis).toEqual([1]);

  const text = JSON.stringify(spec);
  expect(text).not.toContain("1234568");
  expect(text).not.toContain("9001011234568");
  expect(text).not.toContain("334455");
});

it("names a 상여 file with the _상여 suffix", async () => {
  const run = await runWith("900101-1234568", "bonus");
  expect(buildPayrollLedgerSheet(run, "회사").fileName).toBe("급여대장_2026-06_상여");
});
