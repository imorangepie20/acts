import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { sites } from "@/server/db/schema";
import {
  createDepartment,
  createSite,
  ensureMainSite,
  getEntryOptions,
  getReportFilterOptions,
  listDepartments,
  listSites,
  updateDepartment,
  updateSite,
} from "./service";

const db = getTestDb();
beforeEach(() => resetDb(db));

const BN = "2208162517";

describe("sites", () => {
  it("creates with trimmed name, normalized number, null when blank", async () => {
    const a = await createSite(db, { name: "  지점A ", businessNumber: "220-81-62517" });
    expect(a.ok && a.value).toMatchObject({ name: "지점A", businessNumber: BN, isActive: true });
    const b = await createSite(db, { name: "지점B", businessNumber: " " });
    expect(b.ok && b.value.businessNumber).toBeNull();
  });
  it("rejects blank name, duplicate name, bad number", async () => {
    expect(await createSite(db, { name: "  ", businessNumber: null })).toEqual({ ok: false, error: "사업장명을 입력하세요." });
    await createSite(db, { name: "지점A", businessNumber: null });
    expect(await createSite(db, { name: "지점A", businessNumber: null })).toEqual({ ok: false, error: "이미 있는 사업장명입니다." });
    expect(await createSite(db, { name: "지점C", businessNumber: "123" })).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
  });
  it("updates, rejects duplicate names, reports missing id", async () => {
    const a = await createSite(db, { name: "A", businessNumber: null });
    const b = await createSite(db, { name: "B", businessNumber: null });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await updateSite(db, a.value.id, { name: "A2", businessNumber: BN, isActive: true })).ok).toBe(true);
    expect(await updateSite(db, a.value.id, { name: "B", businessNumber: null, isActive: true })).toEqual({ ok: false, error: "이미 있는 사업장명입니다." });
    expect((await updateSite(db, 9999, { name: "Z", businessNumber: null, isActive: true })).ok).toBe(false);
  });
  it("refuses to deactivate the last active site", async () => {
    const a = await createSite(db, { name: "A", businessNumber: null });
    const b = await createSite(db, { name: "B", businessNumber: null });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await updateSite(db, a.value.id, { name: "A", businessNumber: null, isActive: false })).ok).toBe(true);
    expect(await updateSite(db, b.value.id, { name: "B", businessNumber: null, isActive: false })).toEqual({
      ok: false,
      error: "활성 사업장이 최소 1개 있어야 합니다.",
    });
    // editing an already-inactive site stays allowed
    expect((await updateSite(db, a.value.id, { name: "A", businessNumber: null, isActive: false })).ok).toBe(true);
  });
  it("lists active only on request", async () => {
    const a = await createSite(db, { name: "A", businessNumber: null });
    await createSite(db, { name: "B", businessNumber: null });
    if (!a.ok) throw new Error("setup");
    await updateSite(db, a.value.id, { name: "A", businessNumber: null, isActive: false });
    expect(await listSites(db)).toHaveLength(2);
    expect((await listSites(db, { activeOnly: true })).map((s) => s.name)).toEqual(["B"]);
  });
});

describe("departments", () => {
  it("creates, validates, updates", async () => {
    expect(await createDepartment(db, { name: " " })).toEqual({ ok: false, error: "부서명을 입력하세요." });
    const d = await createDepartment(db, { name: " 영업 " });
    if (!d.ok) throw new Error("setup");
    expect(d.value.name).toBe("영업");
    expect(await createDepartment(db, { name: "영업" })).toEqual({ ok: false, error: "이미 있는 부서명입니다." });
    const e = await createDepartment(db, { name: "총무" });
    if (!e.ok) throw new Error("setup");
    expect(await updateDepartment(db, e.value.id, { name: "영업", isActive: true })).toEqual({ ok: false, error: "이미 있는 부서명입니다." });
    expect((await updateDepartment(db, e.value.id, { name: "총무", isActive: false })).ok).toBe(true);
    expect((await listDepartments(db, { activeOnly: true })).map((x) => x.name)).toEqual(["영업"]);
    expect((await updateDepartment(db, 9999, { name: "x", isActive: true })).ok).toBe(false);
  });
});

describe("ensureMainSite / getEntryOptions", () => {
  it("ensureMainSite inserts 본점 once", async () => {
    await ensureMainSite(db);
    await ensureMainSite(db);
    const rows = await db.select().from(sites);
    expect(rows.map((r) => r.name)).toEqual(["본점"]);
  });
  it("does nothing when sites already exist", async () => {
    await createSite(db, { name: "지점A", businessNumber: null });
    await ensureMainSite(db);
    expect((await listSites(db)).map((s) => s.name)).toEqual(["지점A"]);
  });
  it("shows site/department only when meaningful", async () => {
    await ensureMainSite(db);
    let o = await getEntryOptions(db);
    expect(o).toMatchObject({ showSite: false, showDepartment: false });
    expect(o.sites).toHaveLength(1);
    await createSite(db, { name: "지점A", businessNumber: null });
    await createDepartment(db, { name: "영업" });
    o = await getEntryOptions(db);
    expect(o).toMatchObject({ showSite: true, showDepartment: true });
    expect(o.sites).toHaveLength(2);
  });
  it("counts only active rows", async () => {
    await ensureMainSite(db);
    const a = await createSite(db, { name: "지점A", businessNumber: null });
    const d = await createDepartment(db, { name: "영업" });
    if (!a.ok || !d.ok) throw new Error("setup");
    await updateSite(db, a.value.id, { name: "지점A", businessNumber: null, isActive: false });
    await updateDepartment(db, d.value.id, { name: "영업", isActive: false });
    expect(await getEntryOptions(db)).toMatchObject({ showSite: false, showDepartment: false });
  });
  it("report filter options include inactive rows, labelled", async () => {
    await ensureMainSite(db);
    const a = await createSite(db, { name: "지점A", businessNumber: null });
    const d = await createDepartment(db, { name: "영업" });
    if (!a.ok || !d.ok) throw new Error("setup");
    await updateSite(db, a.value.id, { name: "지점A", businessNumber: null, isActive: false });
    await updateDepartment(db, d.value.id, { name: "영업", isActive: false });
    const o = await getReportFilterOptions(db);
    expect(o).toMatchObject({ showSite: true, showDepartment: true });
    expect(o.sites.map((s) => s.name)).toEqual(["본점", "지점A (사용 안 함)"]);
    expect(o.departments.map((x) => x.name)).toEqual(["영업 (사용 안 함)"]);
  });
});
