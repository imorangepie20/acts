import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { company } from "@/server/db/schema";
import { getCompany, updateCompany, type Company } from "./service";

const db = getTestDb();

const valid: Company = {
  name: "테스트 주식회사",
  businessNumber: "220-81-62517",
  representative: "홍길동",
  fiscalYearStartMonth: 4,
  approvalRequired: true,
};

beforeEach(async () => {
  await resetDb(db);
  await db.insert(company).values({ id: 1, name: "우리회사" });
});

describe("company service", () => {
  it("rejects an invalid checksum without writing", async () => {
    const r = await updateCompany(db, { ...valid, businessNumber: "220-81-62518" });
    expect(r).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
    expect((await getCompany(db)).name).toBe("우리회사");
  });
  it("rejects an empty name", async () => {
    const r = await updateCompany(db, { ...valid, name: "   " });
    expect(r).toEqual({ ok: false, error: "회사명을 입력하세요." });
  });
  it.each([0, 13, 1.5, Number.NaN])("rejects month %s", async (m) => {
    const r = await updateCompany(db, { ...valid, fiscalYearStartMonth: m });
    expect(r).toEqual({ ok: false, error: "회계연도 시작 월은 1~12 사이여야 합니다." });
  });
  it("round-trips a valid update with 10-digit storage", async () => {
    const r = await updateCompany(db, valid);
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
    await updateCompany(db, valid);
    const r = await updateCompany(db, { ...valid, businessNumber: " ", representative: "" });
    expect(r.ok).toBe(true);
    const c = await getCompany(db);
    expect(c.businessNumber).toBeNull();
    expect(c.representative).toBeNull();
  });
  it("getCompany throws when the row is missing", async () => {
    await resetDb(db);
    await expect(getCompany(db)).rejects.toThrow(/회사 정보/);
  });
});
