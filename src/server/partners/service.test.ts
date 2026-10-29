import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import {
  createPartner,
  listPartners,
  searchPartners,
  updatePartner,
  type PartnerInput,
} from "./service";

const db = getTestDb();
beforeEach(() => resetDb(db));

const base: PartnerInput = {
  name: "테스트 상사",
  businessNumber: null,
  representative: null,
  phone: null,
  email: null,
  memo: null,
};
const BN = "2208162517";

describe("createPartner", () => {
  it("creates, trims the name, normalizes dashed numbers, nulls empty strings", async () => {
    const r = await createPartner(db, {
      ...base,
      name: "  가나다  ",
      businessNumber: "220-81-62517",
      representative: "  ",
      phone: "",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      name: "가나다",
      businessNumber: BN,
      representative: null,
      phone: null,
      isActive: true,
    });
  });

  it("requires a name", async () => {
    const r = await createPartner(db, { ...base, name: "   " });
    expect(r).toEqual({ ok: false, error: "거래처명을 입력하세요." });
  });

  it.each(["123-45-67890", "22081625X7", "123"])("rejects bad business number %s", async (bn) => {
    const r = await createPartner(db, { ...base, businessNumber: bn });
    expect(r).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
  });

  it("rejects a duplicate business number", async () => {
    await createPartner(db, { ...base, businessNumber: BN });
    const r = await createPartner(db, { ...base, name: "다른", businessNumber: "220-81-62517" });
    expect(r).toEqual({ ok: false, error: "이미 등록된 사업자등록번호입니다." });
  });

  it("maps a race on the unique index to the duplicate error", async () => {
    const rs = await Promise.all([
      createPartner(db, { ...base, name: "A", businessNumber: BN }),
      createPartner(db, { ...base, name: "B", businessNumber: BN }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "이미 등록된 사업자등록번호입니다." });
  });

  it("allows many partners without a business number", async () => {
    const a = await createPartner(db, { ...base, name: "A" });
    const b = await createPartner(db, { ...base, name: "B" });
    expect(a.ok && b.ok).toBe(true);
  });
});

describe("updatePartner", () => {
  it("updates fields and deactivates", async () => {
    const c = await createPartner(db, { ...base, businessNumber: BN });
    if (!c.ok) throw new Error("setup");
    const r = await updatePartner(db, c.value.id, {
      ...base,
      name: "새 이름",
      businessNumber: null,
      isActive: false,
    });
    expect(r.ok).toBe(true);
    const [row] = await listPartners(db);
    expect(row).toMatchObject({ name: "새 이름", businessNumber: null, isActive: false });
  });

  it("rejects a duplicate number owned by another partner but allows keeping its own", async () => {
    await createPartner(db, { ...base, name: "A", businessNumber: BN });
    const b = await createPartner(db, { ...base, name: "B" });
    if (!b.ok) throw new Error("setup");
    const dup = await updatePartner(db, b.value.id, { ...base, name: "B", businessNumber: BN, isActive: true });
    expect(dup).toEqual({ ok: false, error: "이미 등록된 사업자등록번호입니다." });
    const [a] = await listPartners(db, { q: "A" });
    const same = await updatePartner(db, a.id, { ...base, name: "A2", businessNumber: BN, isActive: true });
    expect(same.ok).toBe(true);
  });

  it("validates name and number, and reports a missing partner", async () => {
    const c = await createPartner(db, base);
    if (!c.ok) throw new Error("setup");
    expect(await updatePartner(db, c.value.id, { ...base, name: "", isActive: true })).toEqual({
      ok: false,
      error: "거래처명을 입력하세요.",
    });
    expect(
      await updatePartner(db, c.value.id, { ...base, businessNumber: "111", isActive: true }),
    ).toEqual({ ok: false, error: "사업자등록번호가 올바르지 않습니다." });
    expect((await updatePartner(db, 99999, { ...base, isActive: true })).ok).toBe(false);
  });
});

describe("listPartners / searchPartners", () => {
  beforeEach(async () => {
    await createPartner(db, { ...base, name: "나 상사", businessNumber: BN });
    await createPartner(db, { ...base, name: "가 물산" });
    const x = await createPartner(db, { ...base, name: "다 중지" });
    if (x.ok) await updatePartner(db, x.value.id, { ...base, name: "다 중지", isActive: false });
  });

  it("lists ordered by name, optionally active only", async () => {
    expect((await listPartners(db)).map((p) => p.name)).toEqual(["가 물산", "나 상사", "다 중지"]);
    expect((await listPartners(db, { activeOnly: true })).map((p) => p.name)).toEqual(["가 물산", "나 상사"]);
  });

  it("filters by name or business-number digits", async () => {
    expect((await listPartners(db, { q: "물산" })).map((p) => p.name)).toEqual(["가 물산"]);
    expect((await listPartners(db, { q: "220-81" })).map((p) => p.name)).toEqual(["나 상사"]);
  });

  it("search finds by number prefix, excludes inactive, honors limit", async () => {
    expect((await searchPartners(db, "220")).map((p) => p.businessNumber)).toEqual([BN]);
    expect(await searchPartners(db, "중지")).toEqual([]);
    expect(await searchPartners(db, "상", 0)).toEqual([]);
  });

  it("escapes LIKE wildcards in the query", async () => {
    expect(await searchPartners(db, "%")).toEqual([]);
  });
});
