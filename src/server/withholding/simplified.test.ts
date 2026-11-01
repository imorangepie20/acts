import { EMPTY_SEMIANNUAL_NOTICE } from "@/lib/withholding/notices";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUserWithMfa } from "@/server/auth/service";
import { company, employees, payrollAudit, users } from "@/server/db/schema";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { createPayrollVoucher } from "../../../tests/helpers/payroll";
import { buildSimplifiedDownload, loadSimplifiedRows, parseSimplifiedParams } from "./simplified";

const db = getTestDb();
let admin: SessionUserWithMfa;
const FILING = {
  taxOfficeCode: "123",
  businessNumber: "1234567890",
  representative: "홍길동",
  hometaxId: "acts01",
  filingContactDept: "경리팀",
  filingContactName: "김담당",
  filingContactPhone: "02-123-4567",
  businessType: "corporation",
  corporateNumber: "1101111234567",
};
const setCompany = (v: Partial<typeof FILING> & { name?: string }) => db.update(company).set(v);
const savedKey = process.env.PAYROLL_ENCRYPTION_KEY;

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin", mfa: "verified" };
  await createPayrollVoucher(db, admin, { yearMonth: "2026-06", payDate: "2026-07-10" });
});
afterEach(() => {
  process.env.PAYROLL_ENCRYPTION_KEY = savedKey;
});

describe("loadSimplifiedRows", () => {
  it("lists confirmed runs by 귀속월, masked, wages = taxable total", async () => {
    const rows = await loadSimplifiedRows(db, 2026, 1);
    expect(rows).toEqual([
      { employeeId: expect.any(Number), name: "급여사원", rrnMasked: "900101-1******", from: "2026-01-01", to: "2026-06-30", wages: 3_000_000, noWork: false },
    ]);
    expect(await loadSimplifiedRows(db, 2026, 2)).toEqual([]);
  });
});

describe("parseSimplifiedParams", () => {
  it("defaults to the half that just ended", () => {
    expect(parseSimplifiedParams({}, "2026-11-01")).toEqual({ year: 2026, half: 1 });
    expect(parseSimplifiedParams({}, "2026-02-01")).toEqual({ year: 2025, half: 2 });
    expect(parseSimplifiedParams({ year: "2024", half: "2" }, "2026-11-01")).toEqual({ year: 2024, half: 2 });
    expect(parseSimplifiedParams({ year: "x", half: "9" }, "2026-11-01")).toEqual({ year: 2026, half: 1 });
  });
});

describe("buildSimplifiedDownload", () => {
  const run = (ownerRrn?: string) => buildSimplifiedDownload(db, admin, { year: 2026, half: 1, ownerRrn });
  const audits = () => db.select().from(payrollAudit).where(eq(payrollAudit.field, "simplified_statement"));

  it.each([
    [{ taxOfficeCode: "" }, "세무서코드를 회사 설정에 입력하세요."],
    [{ hometaxId: "" }, "홈택스 ID를 회사 설정에 입력하세요."],
    [{ filingContactName: "" }, "담당자 성명을 회사 설정에 입력하세요."],
    [{ filingContactPhone: "" }, "담당자 전화번호를 회사 설정에 입력하세요."],
    [{ corporateNumber: "" }, "법인등록번호를 회사 설정에 입력하세요."],
  ])("refuses missing company field %j", async (patch, error) => {
    await setCompany({ ...FILING, ...patch });
    expect(await run()).toEqual({ ok: false, error });
    expect(await audits()).toHaveLength(0);
  });

  it("individual needs a valid 대표자 주민등록번호, never stored", async () => {
    await setCompany({ ...FILING, businessType: "individual", corporateNumber: "" });
    expect(await run()).toEqual({ ok: false, error: "대표자 주민등록번호를 입력하세요." });
    expect(await run("123")).toEqual({ ok: false, error: "대표자 주민등록번호가 올바르지 않습니다." });
    const r = await run("900101-1234568");
    expect(r.ok).toBe(true);
    const dump = JSON.stringify([await db.select().from(company), await audits()]);
    expect(dump).not.toContain("9001011234568");
    expect(dump).not.toContain("900101-1234568");
  });

  it("success: one audit row per included employee; file is 192-byte records", async () => {
    await setCompany(FILING);
    const r = await run();
    if (!r.ok) throw new Error(r.error);
    expect(r.fileName).toBe("SC1234567.890");
    expect(r.body.length % 192).toBe(0);
    const [emp] = await db.select({ id: employees.id }).from(employees);
    expect(await audits()).toEqual([expect.objectContaining({ userId: admin.id, employeeId: emp.id })]);
  });

  it("no confirmed run in the half: error, no audit", async () => {
    await setCompany(FILING);
    const r = await buildSimplifiedDownload(db, admin, { year: 2026, half: 2 });
    expect(r).toEqual({ ok: false, error: EMPTY_SEMIANNUAL_NOTICE });
    expect(await audits()).toHaveLength(0);
  });

  it("refuses a user without payroll:manage", async () => {
    await setCompany(FILING);
    const r = await buildSimplifiedDownload(db, { ...admin, role: "staff" }, { year: 2026, half: 1 });
    expect(r.ok).toBe(false);
    expect(await audits()).toHaveLength(0);
  });

  it("key missing: throws the encryption-key message, no audit", async () => {
    await setCompany(FILING);
    delete process.env.PAYROLL_ENCRYPTION_KEY;
    await expect(run()).rejects.toThrow("PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.");
    expect(await audits()).toHaveLength(0);
  });
});
