import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { suggestGroup } from "@/lib/accounts";
import { accounts } from "@/server/db/schema";
import { STANDARD_ACCOUNTS } from "./standard-chart";
import {
  createAccount,
  getVatAccountIds,
  listAccounts,
  seedStandardAccounts,
  updateAccount,
} from "./service";

const db = getTestDb();
beforeEach(() => resetDb(db));

const base = { name: "테스트", group: "sga" as const, requiresPartner: false };

describe("createAccount", () => {
  it("creates and lists ordered by code", async () => {
    const b = await createAccount(db, { ...base, code: "850" });
    const a = await createAccount(db, { ...base, code: "840", name: "가" });
    expect(a.ok && b.ok).toBe(true);
    expect((await listAccounts(db)).map((r) => r.code)).toEqual(["840", "850"]);
  });
  it("validates code", async () => {
    for (const code of ["1000", "abc", "100", "10", "000"]) {
      expect(await createAccount(db, { ...base, code })).toEqual({
        ok: false,
        error: "계정코드는 101~999 사이의 3자리 숫자여야 합니다.",
      });
    }
  });
  it("rejects duplicates", async () => {
    await createAccount(db, { ...base, code: "850" });
    expect(await createAccount(db, { ...base, code: "850" })).toEqual({
      ok: false,
      error: "이미 사용 중인 계정코드입니다.",
    });
  });
  it("requires a name", async () => {
    expect(await createAccount(db, { ...base, code: "850", name: "  " })).toEqual({
      ok: false,
      error: "계정명을 입력하세요.",
    });
  });
});

describe("updateAccount", () => {
  it("updates fields and hides", async () => {
    const r = await createAccount(db, { ...base, code: "850" });
    if (!r.ok) throw new Error();
    expect(await updateAccount(db, r.value.id, { name: " 새이름 ", isActive: false, requiresPartner: true })).toEqual({ ok: true });
    const [row] = await listAccounts(db);
    expect(row).toMatchObject({ name: "새이름", isActive: false, requiresPartner: true });
  });
  it("sets and clears the dashboard role", async () => {
    const r = await createAccount(db, { ...base, code: "850", group: "current_liability", dashboardRole: "payable" });
    if (!r.ok) throw new Error();
    expect(r.value.dashboardRole).toBe("payable");
    expect(await updateAccount(db, r.value.id, { group: "current_asset", dashboardRole: "cash" })).toEqual({ ok: true });
    expect((await listAccounts(db))[0].dashboardRole).toBe("cash");
    expect(await updateAccount(db, r.value.id, { dashboardRole: null })).toEqual({ ok: true });
    expect((await listAccounts(db))[0].dashboardRole).toBeNull();
  });
  it("blank name rejected", async () => {
    const r = await createAccount(db, { ...base, code: "850" });
    if (!r.ok) throw new Error();
    expect(await updateAccount(db, r.value.id, { name: " " })).toEqual({ ok: false, error: "계정명을 입력하세요." });
  });
  it("unknown id", async () => {
    expect(await updateAccount(db, 999999, { name: "x" })).toEqual({ ok: false, error: "계정과목을 찾을 수 없습니다." });
  });
  it("VAT accounts cannot be hidden", async () => {
    await seedStandardAccounts(db);
    const { inputAccountId, outputAccountId } = await getVatAccountIds(db);
    for (const id of [inputAccountId, outputAccountId]) {
      expect(await updateAccount(db, id, { isActive: false })).toEqual({
        ok: false,
        error: "부가세 계정은 숨길 수 없습니다.",
      });
    }
  });
});

describe("standard chart", () => {
  it("seeds idempotently as system accounts", async () => {
    await seedStandardAccounts(db);
    await seedStandardAccounts(db);
    const rows = await db.select().from(accounts);
    expect(rows).toHaveLength(STANDARD_ACCOUNTS.length);
    expect(rows.every((r) => r.isSystem)).toBe(true);
  });
  it("seeds dashboard roles", async () => {
    await seedStandardAccounts(db);
    const rows = await listAccounts(db);
    const role = (c: string) => rows.find((r) => r.code === c)?.dashboardRole;
    expect(role("103")).toBe("cash");
    expect(role("108")).toBe("receivable");
    expect(role("253")).toBe("payable");
    expect(role("811")).toBeNull();
  });
  it("groups match Douzone ranges and codes are unique", () => {
    for (const a of STANDARD_ACCOUNTS) expect(a.group, a.code).toBe(suggestGroup(a.code));
    expect(new Set(STANDARD_ACCOUNTS.map((a) => a.code)).size).toBe(STANDARD_ACCOUNTS.length);
  });
  it("activeOnly omits hidden", async () => {
    const r = await createAccount(db, { ...base, code: "850" });
    if (!r.ok) throw new Error();
    await updateAccount(db, r.value.id, { isActive: false });
    expect(await listAccounts(db, { activeOnly: true })).toHaveLength(0);
    expect(await listAccounts(db)).toHaveLength(1);
  });
  it("getVatAccountIds", async () => {
    await seedStandardAccounts(db);
    const ids = await getVatAccountIds(db);
    const rows = await listAccounts(db);
    expect(rows.find((r) => r.id === ids.inputAccountId)?.code).toBe("135");
    expect(rows.find((r) => r.id === ids.outputAccountId)?.code).toBe("255");
  });
  it("getVatAccountIds throws when missing", async () => {
    await expect(getVatAccountIds(db)).rejects.toThrow();
  });
});
