import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { eq } from "drizzle-orm";
import { company, users, voucherHistory, vouchers } from "@/server/db/schema";
import { getCompany, updateCompany, type Company } from "./service";

const db = getTestDb();

const valid: Company = {
  name: "테스트 주식회사",
  businessNumber: "220-81-62517",
  representative: "홍길동",
  fiscalYearStartMonth: 4,
  approvalRequired: true,
};

let actorId: string;

beforeEach(async () => {
  await resetDb(db);
  await db.insert(company).values({ id: 1, name: "우리회사" });
  [{ id: actorId }] = await db
    .insert(users)
    .values({ email: "a@test.kr", name: "관리자", role: "admin", passwordHash: "x" })
    .returning({ id: users.id });
});

describe("company service", () => {
  it("rejects an invalid checksum without writing", async () => {
    const r = await updateCompany(db, { ...valid, businessNumber: "220-81-62518" }, actorId);
    expect(r).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
    expect((await getCompany(db)).name).toBe("우리회사");
  });
  it("rejects business numbers with non-digit characters and keeps the stored value", async () => {
    await updateCompany(db, valid, actorId);
    for (const bad of ["abc", "220-81-6251x", "220.81.62517"]) {
      const r = await updateCompany(db, { ...valid, businessNumber: bad }, actorId);
      expect(r).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
    }
    expect((await getCompany(db)).businessNumber).toBe("2208162517");
  });
  it("rejects an empty name", async () => {
    const r = await updateCompany(db, { ...valid, name: "   " }, actorId);
    expect(r).toEqual({ ok: false, error: "회사명을 입력하세요." });
  });
  it.each([0, 13, 1.5, Number.NaN])("rejects month %s", async (m) => {
    const r = await updateCompany(db, { ...valid, fiscalYearStartMonth: m }, actorId);
    expect(r).toEqual({ ok: false, error: "회계연도 시작 월은 1~12 사이여야 합니다." });
  });
  it("round-trips a valid update with 10-digit storage", async () => {
    const r = await updateCompany(db, valid, actorId);
    expect(r.ok).toBe(true);
    expect(await getCompany(db)).toEqual({
      name: "테스트 주식회사",
      businessNumber: "2208162517",
      representative: "홍길동",
      fiscalYearStartMonth: 4,
      approvalRequired: true,
    });
  });
  it("stores null for empty business number and representative", async () => {
    await updateCompany(db, valid, actorId);
    const r = await updateCompany(db, { ...valid, businessNumber: " ", representative: "" }, actorId);
    expect(r.ok).toBe(true);
    const c = await getCompany(db);
    expect(c.businessNumber).toBeNull();
    expect(c.representative).toBeNull();
  });
  it("getCompany throws when the row is missing", async () => {
    await resetDb(db);
    await expect(getCompany(db)).rejects.toThrow(/회사 정보/);
  });
  it("switching approval off approves pending vouchers in the same update", async () => {
    await updateCompany(db, valid, actorId);
    const [{ id }] = await db
      .insert(vouchers)
      .values({ date: "2026-10-30", no: 1, entryType: "general", status: "pending", createdBy: actorId, updatedBy: actorId })
      .returning({ id: vouchers.id });
    expect(await updateCompany(db, { ...valid, approvalRequired: false }, actorId)).toEqual({ ok: true });
    const [v] = await db.select().from(vouchers).where(eq(vouchers.id, id));
    expect(v).toMatchObject({ status: "approved", approvedBy: actorId });
    const h = await db.select().from(voucherHistory).where(eq(voucherHistory.voucherId, id));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: "approved", note: "전표 승인 기능 해제로 자동 승인" });
    expect((await getCompany(db)).approvalRequired).toBe(false);
  });
});
