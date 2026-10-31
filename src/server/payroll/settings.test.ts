import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUser } from "@/server/auth/service";
import { accounts, users } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { deleteItem, listItems, saveItem, type PayItemInput } from "./items";
import { getPayrollSettings, savePayrollSettings, type PayrollSettingsInput } from "./settings";

const db = getTestDb();
let admin: SessionUser;
let staff: SessionUser;

const DEFAULTS: PayrollSettingsInput = {
  pensionCompanyCode: "817",
  insuranceCompanyCode: "811",
  withholdingCode: "254",
  companyPayableCode: "262",
  netPayCode: "103",
  executiveCode: "801",
  staffCode: "802",
  pensionPartnerId: null,
  healthPartnerId: null,
  employmentPartnerId: null,
  taxPartnerId: null,
  localTaxPartnerId: null,
};

const item = (over: Partial<PayItemInput> = {}): PayItemInput => ({
  code: "family",
  name: "가족수당",
  taxable: true,
  nontaxLimit: null,
  inEmploymentBase: true,
  debitAccountCode: null,
  sort: 70,
  isActive: true,
  ...over,
});

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin" };
  const [s] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "직원", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: s.id, email: "s@test.kr", name: "직원", role: "staff" };
});

describe("payroll settings", () => {
  it("reads the seeded defaults", async () => {
    expect(await getPayrollSettings(db)).toMatchObject(DEFAULTS);
  });

  it("saves 817/811/254/262/103/801/802 and partners", async () => {
    const p = await createPartner(db, {
      name: "국민연금공단",
      businessNumber: "",
      representative: null,
      phone: null,
      email: null,
      memo: null,
    });
    if (!p.ok) throw new Error(p.error);
    expect(await savePayrollSettings(db, admin, { ...DEFAULTS, pensionPartnerId: p.value.id })).toEqual({
      ok: true,
      value: undefined,
    });
    expect((await getPayrollSettings(db)).pensionPartnerId).toBe(p.value.id);
  });

  it("rejects an unknown or inactive code and an unknown partner", async () => {
    expect((await savePayrollSettings(db, admin, { ...DEFAULTS, netPayCode: "999" })).ok).toBe(false);
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.code, "811"));
    expect((await savePayrollSettings(db, admin, DEFAULTS)).ok).toBe(false);
    await db.update(accounts).set({ isActive: true }).where(eq(accounts.code, "811"));
    expect((await savePayrollSettings(db, admin, { ...DEFAULTS, taxPartnerId: 99_999 })).ok).toBe(false);
    expect((await getPayrollSettings(db)).netPayCode).toBe("103");
  });

  it("is forbidden for staff", async () => {
    expect((await savePayrollSettings(db, staff, DEFAULTS)).ok).toBe(false);
  });
});

describe("pay items", () => {
  it("lists the six seeded items in order", async () => {
    expect((await listItems(db)).map((i) => i.code)).toEqual(["basic", "bonus", "meal", "car", "position", "overtime"]);
  });

  it("adds and updates an item", async () => {
    expect((await saveItem(db, admin, item())).ok).toBe(true);
    expect((await saveItem(db, admin, item({ name: "가족 수당", debitAccountCode: "802" }))).ok).toBe(true);
    expect((await listItems(db)).find((i) => i.code === "family")).toMatchObject({
      name: "가족 수당",
      debitAccountCode: "802",
    });
  });

  it("validates code, account and 비과세 한도", async () => {
    expect((await saveItem(db, admin, item({ code: "Family" }))).ok).toBe(false);
    expect((await saveItem(db, admin, item({ code: "f" }))).ok).toBe(false);
    expect((await saveItem(db, admin, item({ debitAccountCode: "999" }))).ok).toBe(false);
    expect((await saveItem(db, admin, item({ name: " " }))).ok).toBe(false);
    expect((await saveItem(db, admin, item({ taxable: false, nontaxLimit: -1 }))).ok).toBe(false);
  });

  it("deactivates but never deletes a seeded item", async () => {
    expect((await deleteItem(db, admin, "meal")).ok).toBe(false);
    const meal = (await listItems(db)).find((i) => i.code === "meal")!;
    expect((await saveItem(db, admin, { ...meal, isActive: false })).ok).toBe(true);
    expect((await listItems(db)).find((i) => i.code === "meal")?.isActive).toBe(false);
  });

  it("deletes an added item", async () => {
    await saveItem(db, admin, item());
    expect((await deleteItem(db, admin, "family")).ok).toBe(true);
    expect((await listItems(db)).some((i) => i.code === "family")).toBe(false);
  });

  it("is forbidden for staff", async () => {
    expect((await saveItem(db, staff, item())).ok).toBe(false);
  });
});
