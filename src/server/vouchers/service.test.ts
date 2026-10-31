import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_WON } from "@/lib/money";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { buildSimpleVoucher } from "@/lib/vouchers/simple";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { getIncomeStatement } from "@/server/reports/service";
import { accounts, departments, partners, sites, users, voucherImports, voucherLines, vouchers } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { assertMonthsOpen } from "@/server/closing/periods";
import {
  canDecidePayroll,
  canModify,
  createVoucher,
  deletePayrollVoucher,
  deleteVoucher,
  ERR_PAYROLL_ONLY,
  getVoucher,
  listHistory,
  listVouchers,
  updateVoucher,
  writePayrollVoucher,
} from "./service";

const db = getTestDb();

const MSG = {
  date: "날짜가 올바르지 않습니다.",
  lines: "전표에는 2줄 이상이 필요합니다.",
  amount: "금액은 1원 이상 1조 원 미만의 정수여야 합니다.",
  balance: "차변 합계와 대변 합계가 일치하지 않습니다.",
  account: "사용할 수 없는 계정과목입니다.",
  ref: "사용할 수 없는 거래처, 사업장 또는 부서입니다.",
  invalid: "입력값이 올바르지 않습니다.",
  conflict: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
  notFound: "전표를 찾을 수 없습니다.",
  forbidden: "이 전표를 수정할 권한이 없습니다.",
};

let staff: SessionUser;
let staff2: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;
let partnerA: number;

async function mkUser(email: string, name: string, role: SessionUser["role"]): Promise<SessionUser> {
  const [u] = await db
    .insert(users)
    .values({ email, name, role, passwordHash: "x" })
    .returning({ id: users.id });
  return { id: u.id, email, name, role };
}

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  staff = await mkUser("staff@test.kr", "직원", "staff");
  staff2 = await mkUser("staff2@test.kr", "직원2", "staff");
  manager = await mkUser("manager@test.kr", "팀장", "manager");
  const p = await createPartner(db, {
    name: "거래처A",
    businessNumber: null,
    representative: null,
    phone: null,
    email: null,
    memo: null,
  });
  if (!p.ok) throw new Error(p.error);
  partnerA = p.value.id;
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
});

const line = (code: string, side: LineInput["side"], amount: number, extra: Partial<LineInput> = {}): LineInput => ({
  accountId: acc[code],
  side,
  amount,
  partnerId: null,
  siteId,
  departmentId: null,
  description: "",
  ...extra,
});

const general = (over: Partial<VoucherInput> = {}): VoucherInput => ({
  date: "2026-10-30",
  description: "회식비",
  entryType: "general",
  kind: "general",
  partnerId: null,
  evidenceType: "none",
  vatType: null,
  vatDeductible: null,
  supplyAmount: null,
  vatAmount: null,
  lines: [line("811", "debit", 10000), line("101", "credit", 10000)],
  ...over,
});

async function create(input: VoucherInput, actor = staff): Promise<string> {
  const r = await createVoucher(db, actor, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

async function setApproval(on: boolean) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, approvalRequired: on }, manager.id);
  if (!r.ok) throw new Error(r.error);
}

describe("createVoucher import source", () => {
  const meta = { approvalNo: "A1", merchantName: null, merchantBusinessNumber: null, cardNo: null };

  it("records the import key in the same transaction and refuses a repeated key", async () => {
    const src = { key: "nts:1", source: "tax_invoice" as const, meta };
    const first = await createVoucher(db, staff, general(), src);
    expect(first.ok).toBe(true);
    const [row] = await db.select().from(voucherImports);
    expect(row).toMatchObject({ importKey: "nts:1", source: "tax_invoice", voucherId: first.ok ? first.value.id : "" });

    const second = await createVoucher(db, staff, general(), src);
    expect(second).toEqual({ ok: false, error: "이미 불러온 자료입니다." });
    expect(await db.select().from(vouchers)).toHaveLength(1);
  });

  it("leaves validation failures alone and writes no import row", async () => {
    const r = await createVoucher(db, staff, general({ date: "bad" }), { key: "nts:2", source: "card", meta });
    expect(r).toEqual({ ok: false, error: MSG.date });
    expect(await db.select().from(voucherImports)).toHaveLength(0);
  });
});

describe("createVoucher", () => {
  it("creates a balanced 2-line general voucher, approved when approval is off", async () => {
    const r = await createVoucher(db, staff, general());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = await getVoucher(db, r.value.id, { hidePayroll: false });
    expect(v).toMatchObject({
      id: r.value.id,
      date: "2026-10-30",
      no: 1,
      kind: "general",
      status: "approved",
      version: 1,
      rejectReason: null,
      createdBy: { id: staff.id, name: "직원" },
      approvedBy: { id: staff.id, name: "직원" },
      description: "회식비",
    });
    expect(v!.approvedAt).toBeInstanceOf(Date);
    expect(v!.lines).toHaveLength(2);
    expect(v!.lines[0]).toMatchObject({
      accountId: acc["811"],
      side: "debit",
      amount: 10000,
      account: { code: "811", name: "복리후생비" },
      siteName: "본점",
      partnerName: null,
      departmentName: null,
    });
    const h = await listHistory(db, r.value.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: "created", userName: "직원", note: null });
    expect(h[0].snapshot).toMatchObject({ no: 1, status: "approved", attachments: [], description: "회식비" });
    expect(h[0].snapshot.lines).toHaveLength(2);
  });

  it("is pending with no approver when approval is required", async () => {
    await setApproval(true);
    const id = await create(general());
    const v = await getVoucher(db, id, { hidePayroll: false });
    expect(v).toMatchObject({ status: "pending", approvedBy: null, approvedAt: null });
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await getVoucher(db, "00000000-0000-0000-0000-000000000000", { hidePayroll: false })).toBeNull();
    expect(await getVoucher(db, "not-a-uuid", { hidePayroll: false })).toBeNull();
  });
});

describe("validation", () => {
  const expectFail = async (input: VoucherInput, message: string) => {
    const r = await createVoucher(db, staff, input);
    expect(r).toEqual({ ok: false, error: message });
  };

  it("rejects a bad date", async () => {
    await expectFail(general({ date: "2026-02-30" }), MSG.date);
    await expectFail(general({ date: "20261030" }), MSG.date);
  });

  it("limits the date to 2000 through next year (Seoul)", async () => {
    const nextYear = Number(todayInSeoul().slice(0, 4)) + 1;
    await expectFail(general({ date: "1999-12-31" }), MSG.date);
    await expectFail(general({ date: `${nextYear + 1}-01-01` }), MSG.date);
    expect((await createVoucher(db, staff, general({ date: "2000-01-01" }))).ok).toBe(true);
    expect((await createVoucher(db, staff, general({ date: `${nextYear}-12-31` }))).ok).toBe(true);
  });

  it("requires two lines", async () => {
    await expectFail(general({ lines: [line("811", "debit", 1000)] }), MSG.lines);
  });

  it("rejects non-integer, zero and too-large amounts", async () => {
    await expectFail(general({ lines: [line("811", "debit", 0), line("101", "credit", 0)] }), MSG.amount);
    await expectFail(general({ lines: [line("811", "debit", 1.5), line("101", "credit", 1.5)] }), MSG.amount);
    await expectFail(
      general({ lines: [line("811", "debit", MAX_WON + 1), line("101", "credit", MAX_WON + 1)] }),
      MSG.amount,
    );
  });

  it("rejects unbalanced lines", async () => {
    await expectFail(general({ lines: [line("811", "debit", 1000), line("101", "credit", 999)] }), MSG.balance);
  });

  it("rejects unknown and hidden accounts", async () => {
    const unknown = general();
    unknown.lines[0] = { ...unknown.lines[0], accountId: 999999 };
    await expectFail(unknown, MSG.account);
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.code, "811"));
    await expectFail(general(), MSG.account);
  });

  it("requires a partner on requiresPartner accounts", async () => {
    await expectFail(
      general({ lines: [line("108", "debit", 5000), line("401", "credit", 5000)] }),
      "108 외상매출금 계정은 거래처를 입력해야 합니다.",
    );
  });

  it("rejects unknown or inactive partners, sites and departments", async () => {
    await expectFail(general({ partnerId: 999999 }), MSG.ref);
    await expectFail(
      general({ lines: [line("811", "debit", 1000, { siteId: 999999 }), line("101", "credit", 1000)] }),
      MSG.ref,
    );
    const [d] = await db.insert(departments).values({ name: "영업부", isActive: false }).returning();
    await expectFail(
      general({ lines: [line("811", "debit", 1000, { departmentId: d.id }), line("101", "credit", 1000)] }),
      MSG.ref,
    );
    await db.update(partners).set({ isActive: false }).where(eq(partners.id, partnerA));
    await expectFail(
      general({ lines: [line("811", "debit", 1000, { partnerId: partnerA }), line("101", "credit", 1000)] }),
      MSG.ref,
    );
  });

  it("rejects VAT header fields on a general voucher", async () => {
    await expectFail(general({ vatType: "taxable" }), MSG.invalid);
    await expectFail(general({ supplyAmount: 1.5 }), MSG.invalid);
    await expectFail(general({ vatAmount: -5 }), MSG.invalid);
    await expectFail(general({ vatDeductible: false }), MSG.invalid);
  });

  it("rejects a non-general voucher that is not the builder's shape", async () => {
    await expectFail(
      general({
        entryType: "transfer",
        lines: [line("103", "debit", 1000), line("101", "credit", 500), line("101", "credit", 500)],
      }),
      MSG.invalid,
    );
  });
});

describe("simple entry types", () => {
  it("saves a purchase built by buildSimpleVoucher", async () => {
    const vat = await getVatAccountIds(db);
    const b = buildSimpleVoucher(
      {
        type: "purchase",
        date: "2026-10-30",
        description: "사무용품",
        mainAccountId: acc["811"],
        counterAccountId: acc["101"],
        partnerId: partnerA,
        siteId,
        departmentId: null,
        evidenceType: "card",
        vatType: "taxable",
        vatDeductible: true,
        supplyAmount: 10000,
        vatAmount: 1000,
      },
      vat,
    );
    if (!b.ok) throw new Error(b.error);
    const id = await create(b.value);
    const v = await getVoucher(db, id, { hidePayroll: false });
    expect(v).toMatchObject({ entryType: "purchase", supplyAmount: 10000, vatAmount: 1000, vatDeductible: true });
    expect(v!.lines.map((l) => [l.account.code, l.side, l.amount, l.partnerName])).toEqual([
      ["811", "debit", 10000, "거래처A"],
      ["135", "debit", 1000, "거래처A"],
      ["101", "credit", 11000, "거래처A"],
    ]);
  });

  it("re-checks the VAT rules for a simple receipt that claims VAT", async () => {
    const r = await createVoucher(db, staff, {
      date: "2026-10-30",
      description: "간식",
      entryType: "purchase",
      kind: "general",
      partnerId: null,
      evidenceType: "simple_receipt",
      vatType: "taxable",
      vatDeductible: true,
      supplyAmount: 9091,
      vatAmount: 909,
      lines: [
        line("811", "debit", 9091, { description: "간식" }),
        line("135", "debit", 909, { description: "간식" }),
        line("101", "credit", 10000, { description: "간식" }),
      ],
    });
    expect(r).toEqual({
      ok: false,
      error: "간이영수증·증빙 없음은 부가세를 공제받을 수 없습니다. 합계를 공급가액으로 입력하세요.",
    });
  });

  it("rejects a trade whose supply + VAT line exceeds MAX_WON", async () => {
    const vat = await getVatAccountIds(db);
    const b = buildSimpleVoucher(
      {
        type: "purchase",
        date: "2026-10-30",
        description: "설비",
        mainAccountId: acc["811"],
        counterAccountId: acc["101"],
        partnerId: null,
        siteId,
        departmentId: null,
        evidenceType: "tax_invoice",
        vatType: "taxable",
        vatDeductible: true,
        supplyAmount: MAX_WON,
        vatAmount: 10,
      },
      vat,
    );
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const r = await createVoucher(db, staff, b.value);
    expect(r).toEqual({ ok: false, error: MSG.amount });
  });
});

describe("numbering", () => {
  it("numbers per date", async () => {
    const nos = [];
    for (let i = 0; i < 3; i++) nos.push((await getVoucher(db, await create(general()), { hidePayroll: false }))!.no);
    expect(nos).toEqual([1, 2, 3]);
    expect((await getVoucher(db, await create(general({ date: "2026-10-31" })), { hidePayroll: false }))!.no).toBe(1);
  });

  it("gives concurrent creates on the same date distinct numbers", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map(() => createVoucher(db, staff, general())));
    const nos = [];
    for (const r of rs) {
      if (!r.ok) throw new Error(r.error);
      nos.push((await getVoucher(db, r.value.id, { hidePayroll: false }))!.no);
    }
    expect(nos.sort()).toEqual([1, 2, 3, 4]);
  });

  it("renumbers a voucher moved to another date", async () => {
    await create(general({ date: "2026-10-31" }));
    const id = await create(general());
    const r = await updateVoucher(db, staff, id, 1, general({ date: "2026-10-31" }));
    expect(r.ok).toBe(true);
    expect((await getVoucher(db, id, { hidePayroll: false }))!.no).toBe(2);
  });
});

describe("updateVoucher", () => {
  it("version conflict", async () => {
    const id = await create(general());
    const first = await updateVoucher(db, staff, id, 1, general({ description: "첫 수정" }));
    expect(first.ok).toBe(true);
    expect((await getVoucher(db, id, { hidePayroll: false }))!.version).toBe(2);
    const second = await updateVoucher(db, staff, id, 1, general({ description: "둘째 수정" }));
    expect(second).toEqual({ ok: false, error: MSG.conflict });
    expect((await getVoucher(db, id, { hidePayroll: false }))!.description).toBe("첫 수정");
  });

  it("replaces the lines, clears the reject reason and records history", async () => {
    const id = await create(general());
    await db.update(vouchers).set({ status: "rejected", rejectReason: "증빙 누락" }).where(eq(vouchers.id, id));
    await setApproval(true);
    const r = await updateVoucher(
      db,
      staff,
      id,
      1,
      general({ lines: [line("812", "debit", 3000), line("811", "debit", 2000), line("103", "credit", 5000)] }),
    );
    expect(r.ok).toBe(true);
    const v = await getVoucher(db, id, { hidePayroll: false });
    expect(v).toMatchObject({ status: "pending", rejectReason: null, approvedBy: null, version: 2 });
    expect(v!.lines.map((l) => l.account.code)).toEqual(["812", "811", "103"]);
    const h = await listHistory(db, id);
    expect(h.map((e) => e.action)).toEqual(["created", "updated"]);
    expect(h[1].snapshot.lines).toHaveLength(3);
    expect(h[1].snapshot.status).toBe("pending");
  });

  it("keeps hidden account on existing line", async () => {
    const id = await create(general());
    await db.update(accounts).set({ isActive: false }).where(eq(accounts.code, "811"));
    expect(await updateVoucher(db, staff, id, 1, general({ description: "설명만 수정" }))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await createVoucher(db, staff, general())).toEqual({ ok: false, error: MSG.account });
  });

  it("keeps a hidden partner already on a line", async () => {
    const withPartner = general({
      lines: [line("811", "debit", 1000, { partnerId: partnerA }), line("101", "credit", 1000)],
    });
    const id = await create(withPartner);
    await db.update(partners).set({ isActive: false }).where(eq(partners.id, partnerA));
    expect((await updateVoucher(db, staff, id, 1, withPartner)).ok).toBe(true);
  });

  it("reports a missing voucher", async () => {
    expect(await updateVoucher(db, staff, "00000000-0000-0000-0000-000000000000", 1, general())).toEqual({
      ok: false,
      error: MSG.notFound,
    });
  });

  it("validates the new input", async () => {
    const id = await create(general());
    expect(
      await updateVoucher(db, staff, id, 1, general({ lines: [line("811", "debit", 1), line("101", "credit", 2)] })),
    ).toEqual({ ok: false, error: MSG.balance });
  });
});

describe("permissions", () => {
  it("staff cannot update or delete another staff member's voucher; manager can", async () => {
    const id = await create(general());
    expect(await updateVoucher(db, staff2, id, 1, general())).toEqual({ ok: false, error: MSG.forbidden });
    expect(await deleteVoucher(db, staff2, id, 1)).toEqual({ ok: false, error: MSG.forbidden });
    expect((await updateVoucher(db, manager, id, 1, general({ description: "팀장 수정" }))).ok).toBe(true);
    expect((await deleteVoucher(db, manager, id, 2)).ok).toBe(true);
  });

  it("canModify", () => {
    expect(canModify(staff, { createdBy: staff.id })).toBe(true);
    expect(canModify(staff, { createdBy: staff2.id })).toBe(false);
    expect(canModify(manager, { createdBy: staff.id })).toBe(true);
    expect(canModify({ ...manager, role: "executive" }, { createdBy: manager.id })).toBe(false);
  });
});

describe("deleteVoucher", () => {
  it("deletes the voucher and its lines, keeping history with the pre-delete snapshot", async () => {
    const id = await create(general({ description: "삭제 대상" }));
    expect(await deleteVoucher(db, staff, id, 2)).toEqual({ ok: false, error: MSG.conflict });
    expect(await deleteVoucher(db, staff, id, 1)).toEqual({ ok: true, value: undefined });
    expect(await getVoucher(db, id, { hidePayroll: false })).toBeNull();
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(voucherLines)
      .where(eq(voucherLines.voucherId, id));
    expect(n).toBe(0);
    const h = await listHistory(db, id);
    expect(h.map((e) => e.action)).toEqual(["created", "deleted"]);
    expect(h[1].snapshot).toMatchObject({ description: "삭제 대상", no: 1, status: "approved" });
    expect(h[1].snapshot.lines).toHaveLength(2);
    expect(await deleteVoucher(db, staff, id, 1)).toEqual({ ok: false, error: MSG.notFound });
  });
});

describe("listVouchers", () => {
  beforeEach(async () => {
    await create(general({ date: "2026-10-01", description: "택시비" }));
    await create(general({ date: "2026-10-15", description: "점심", partnerId: partnerA }));
    await setApproval(true);
    await create(general({ date: "2026-10-31", description: "간식" }));
  });

  it("lists newest first with the debit total", async () => {
    const { rows, total } = await listVouchers(db, { hidePayroll: false });
    expect(total).toBe(3);
    expect(rows.map((r) => r.description)).toEqual(["간식", "점심", "택시비"]);
    expect(rows[1]).toMatchObject({
      date: "2026-10-15",
      no: 1,
      entryType: "general",
      partnerName: "거래처A",
      amount: 10000,
      status: "approved",
      createdByName: "직원",
    });
  });

  it("filters by date range, status and q", async () => {
    expect((await listVouchers(db, { hidePayroll: false, from: "2026-10-10", to: "2026-10-31" })).total).toBe(2);
    expect((await listVouchers(db, { hidePayroll: false, to: "2026-10-14" })).rows.map((r) => r.description)).toEqual(["택시비"]);
    expect((await listVouchers(db, { hidePayroll: false, status: "pending" })).rows.map((r) => r.description)).toEqual(["간식"]);
    expect((await listVouchers(db, { hidePayroll: false, q: "택시" })).rows.map((r) => r.description)).toEqual(["택시비"]);
    expect((await listVouchers(db, { hidePayroll: false, q: "거래처" })).rows.map((r) => r.description)).toEqual(["점심"]);
    expect((await listVouchers(db, { hidePayroll: false, q: "%" })).total).toBe(0);
  });

  it("pages 50 rows while total counts every match", async () => {
    for (let i = 0; i < 50; i++) await create(general({ date: "2026-09-01" }));
    const p1 = await listVouchers(db, { hidePayroll: false });
    expect(p1.total).toBe(53);
    expect(p1.rows).toHaveLength(50);
    const p2 = await listVouchers(db, { hidePayroll: false, page: 2 });
    expect(p2.rows).toHaveLength(3);
    expect(p2.rows.at(-1)).toMatchObject({ date: "2026-09-01", no: 1 });
  });
});

describe("결산 (closing) vouchers", () => {
  const closing = (over: Partial<VoucherInput> = {}) =>
    general({
      kind: "closing",
      description: "감가상각",
      lines: [line("818", "debit", 500_000), line("213", "credit", 500_000)],
      ...over,
    });

  it("rejects a closing purchase voucher", async () => {
    const r = await createVoucher(db, staff, closing({ entryType: "purchase" }));
    expect(r).toEqual({ ok: false, error: "결산 전표는 일반 전표로만 입력합니다." });
  });

  it("saves a closing general voucher and keeps it in the income statement", async () => {
    const f = { from: "2026-01-01", to: "2026-12-31", siteId: null, departmentId: null };
    const operating = async () =>
      (await getIncomeStatement(db, f)).lines.find((l) => l.kind === "computed" && l.key === "operating")!.amount;
    const before = await operating();
    const id = await create(closing());
    const v = await getVoucher(db, id, { hidePayroll: false });
    expect(v).toMatchObject({ kind: "closing", status: "approved" });
    expect(await operating()).toBe(before - 500_000);
  });

  it("filters the list by kind", async () => {
    await create(general({ description: "일반" }));
    await create(closing());
    expect((await listVouchers(db, { hidePayroll: false, kind: "closing" })).rows.map((r) => r.description)).toEqual(["감가상각"]);
    expect((await listVouchers(db, { hidePayroll: false, kind: "closing" })).rows[0].kind).toBe("closing");
    expect((await listVouchers(db, { hidePayroll: false, kind: "general" })).rows.map((r) => r.description)).toEqual(["일반"]);
    expect((await listVouchers(db, { hidePayroll: false })).total).toBe(2);
  });

  it("switches kind on update, writes history with kind, and still requires a general entry type", async () => {
    const id = await create(general());
    const v = await getVoucher(db, id, { hidePayroll: false });
    const r = await updateVoucher(db, staff, id, v!.version, closing({ description: "회식비" }));
    expect(r.ok).toBe(true);
    expect((await getVoucher(db, id, { hidePayroll: false }))!.kind).toBe("closing");
    const h = await listHistory(db, id);
    expect(h.map((x) => x.snapshot.kind)).toEqual(["general", "closing"]);
    const v2 = await getVoucher(db, id, { hidePayroll: false });
    const back = await updateVoucher(db, staff, id, v2!.version, general());
    expect(back.ok).toBe(true);
    expect((await getVoucher(db, id, { hidePayroll: false }))!.kind).toBe("general");
  });
});

describe("payroll vouchers", () => {
  const payroll = (over: Partial<VoucherInput> = {}) => ({
    ...general({ description: "2026년 9월 급여", ...over }),
    kind: "payroll" as const,
    lines: [line("802", "debit", 3_000_000), line("103", "credit", 3_000_000)],
  });

  async function writePayroll(actor = manager) {
    const vat = await getVatAccountIds(db);
    const r = await db.transaction(async (tx) => {
      const closed = await assertMonthsOpen(tx, ["2026-09-25"]);
      if (closed) throw new Error(closed);
      return writePayrollVoucher(tx, actor, vat, { ...payroll(), date: "2026-09-25" });
    });
    if (!r.ok) throw new Error(r.error);
    return r.value.id;
  }

  it("writePayrollVoucher numbers and validates like createVoucher and follows the approval setting", async () => {
    await create(general({ date: "2026-09-25" }));
    const id = await writePayroll();
    const v = (await getVoucher(db, id, { hidePayroll: false }))!;
    expect(v).toMatchObject({ kind: "payroll", no: 2, status: "approved", entryType: "general" });
    expect((await listHistory(db, id)).map((h) => h.action)).toEqual(["created"]);

    await setApproval(true);
    expect((await getVoucher(db, await writePayroll(), { hidePayroll: false }))!.status).toBe("pending");

    const vat = await getVatAccountIds(db);
    const bad = await db.transaction((tx) =>
      writePayrollVoucher(tx, manager, vat, {
        ...payroll(),
        lines: [line("802", "debit", 3_000_000), line("103", "credit", 2_000_000)],
      }),
    );
    expect(bad).toEqual({ ok: false, error: "차변 합계와 대변 합계가 일치하지 않습니다." });
  });

  it("refuses update, delete, attach from the voucher screens and decide without payroll:manage", async () => {
    const id = await writePayroll();
    const v = (await getVoucher(db, id, { hidePayroll: false }))!;
    expect(await updateVoucher(db, manager, id, v.version, general())).toEqual({ ok: false, error: ERR_PAYROLL_ONLY });
    expect(await deleteVoucher(db, manager, id, v.version)).toEqual({ ok: false, error: ERR_PAYROLL_ONLY });
    expect(canDecidePayroll("manager")).toBe(true);
    expect(canDecidePayroll("staff")).toBe(false);
  });

  it("deletePayrollVoucher writes the deleted history row and ignores the version", async () => {
    const id = await writePayroll();
    const r = await db.transaction((tx) => deletePayrollVoucher(tx, manager, id));
    expect(r.ok).toBe(true);
    expect(await getVoucher(db, id, { hidePayroll: false })).toBeNull();
    expect((await listHistory(db, id)).map((h) => h.action)).toEqual(["created", "deleted"]);
    const general1 = await create(general());
    expect((await db.transaction((tx) => deletePayrollVoucher(tx, manager, general1))).ok).toBe(false);
  });

  it("listVouchers with hidePayroll masks the row: 급여 전표, no amount, no partner, not openable", async () => {
    const id = await writePayroll();
    await create(general({ date: "2026-09-24", description: "택시비", partnerId: partnerA }));
    const hidden = await listVouchers(db, { hidePayroll: true, from: "2026-09-01", to: "2026-09-30" });
    expect(hidden.total).toBe(2);
    expect(hidden.rows[0]).toMatchObject({ id, kind: "payroll", description: "급여 전표", amount: null, partnerName: null, hidden: true });
    expect(hidden.rows[1]).toMatchObject({ description: "택시비", amount: 10000, partnerName: "거래처A", hidden: false });
    // The real description is not searchable; the label is.
    expect((await listVouchers(db, { hidePayroll: true, q: "9월" })).total).toBe(0);
    expect((await listVouchers(db, { hidePayroll: true, q: "급여 전표" })).rows.map((r) => r.id)).toEqual([id]);

    const shown = await listVouchers(db, { hidePayroll: false, from: "2026-09-01", to: "2026-09-30" });
    expect(shown.rows[0]).toMatchObject({ id, description: "2026년 9월 급여", amount: 3_000_000, hidden: false });
    expect((await listVouchers(db, { hidePayroll: false, q: "9월" })).rows.map((r) => r.id)).toEqual([id]);
  });

  it("getVoucher with hidePayroll is null for a payroll voucher only", async () => {
    const id = await writePayroll();
    expect(await getVoucher(db, id, { hidePayroll: true })).toBeNull();
    expect(await getVoucher(db, id, { hidePayroll: false })).not.toBeNull();
    const g = await create(general());
    expect(await getVoucher(db, g, { hidePayroll: true })).not.toBeNull();
  });
});
