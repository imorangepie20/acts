import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_WON } from "@/lib/money";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { closeMonth } from "@/server/closing/periods";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, partners, sites, users, voucherHistory, voucherLines, vouchers } from "@/server/db/schema";
import { getTrialBalance } from "@/server/reports/service";
import { approveVoucher, createVoucher, deleteVoucher, updateVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { getOpening, getOpeningCutoff, saveOpening, type OpeningLine } from "./opening";

const db = getTestDb();

const MSG = {
  permission: "기초잔액 입력 권한이 없습니다.",
  date: "날짜가 올바르지 않습니다.",
  amount: "금액은 1원 이상 1조 원 미만의 정수여야 합니다.",
  unbalanced: (diff: string) => `차변과 대변 합계가 일치하지 않습니다. (차액 ${diff}원)`,
  partner: (code: string, name: string) => `${code} ${name} 계정은 거래처를 입력해야 합니다.`,
  firstVoucher: (d: string) => `기초잔액 기준일은 첫 전표 날짜(${d})보다 앞서야 합니다.`,
  closed: (m: string) => `마감된 월(${m})의 전표는 추가·수정·삭제할 수 없습니다.`,
  conflict: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
  cutoff: (d: string) => `기초잔액 기준일(${d}) 이후 날짜만 입력할 수 있습니다.`,
  openingOnly: "기초잔액은 기초잔액 화면에서 수정하세요.",
};

let admin: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;
let partnerA: number;
let partnerB: number;

async function mkUser(email: string, name: string, role: SessionUser["role"]): Promise<SessionUser> {
  const [u] = await db.insert(users).values({ email, name, role, passwordHash: "x" }).returning({ id: users.id });
  return { id: u.id, email, name, role };
}

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  admin = await mkUser("admin@test.kr", "관리자", "admin");
  manager = await mkUser("manager@test.kr", "팀장", "manager");
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  [{ id: partnerA }] = await db.insert(partners).values({ name: "가거래처" }).returning({ id: partners.id });
  [{ id: partnerB }] = await db.insert(partners).values({ name: "나거래처" }).returning({ id: partners.id });
});

const ol = (code: string, balance: number, partnerId: number | null = null): OpeningLine => ({
  accountId: acc[code],
  partnerId,
  balance,
});

/** 101 1,000,000 · 108 (가 300,000, 나 200,000) · 212 500,000 · 213 −200,000 · 331 1,800,000 */
const fullLines = (): OpeningLine[] => [
  ol("101", 1_000_000),
  ol("108", 300_000, partnerA),
  ol("108", 200_000, partnerB),
  ol("212", 500_000),
  ol("213", -200_000),
  ol("331", 1_800_000),
];
const simpleLines = (amount = 1_000_000): OpeningLine[] => [ol("101", amount), ol("331", amount)];

async function mustSave(date: string, lines = simpleLines(), version: number | null = null) {
  const r = await saveOpening(db, admin, { date, version, lines });
  if (!r.ok) throw new Error(r.error);
}

const line = (code: string, side: LineInput["side"], amount: number): LineInput => ({
  accountId: acc[code],
  side,
  amount,
  partnerId: null,
  siteId,
  departmentId: null,
  description: "",
});
const voucher = (date: string): VoucherInput => ({
  date,
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
});

async function openingRows() {
  return db.select().from(vouchers).where(eq(vouchers.kind, "opening"));
}

describe("saveOpening rules", () => {
  it("1: requires period:close", async () => {
    expect(await saveOpening(db, manager, { date: "2023-12-31", version: null, lines: simpleLines() })).toEqual({
      ok: false,
      error: MSG.permission,
    });
  });

  it("2: rejects an invalid date or amount", async () => {
    for (const date of ["2023-02-30", "1999-12-31", "2023/12/31", ""]) {
      expect(await saveOpening(db, admin, { date, version: null, lines: simpleLines() })).toEqual({
        ok: false,
        error: MSG.date,
      });
    }
    for (const balance of [1.5, MAX_WON + 1, -(MAX_WON + 1), Number.NaN]) {
      const lines = [ol("101", balance), ol("331", 1000)];
      expect(await saveOpening(db, admin, { date: "2023-12-31", version: null, lines })).toEqual({
        ok: false,
        error: MSG.amount,
      });
    }
  });

  it("3: drops zero balances", async () => {
    await mustSave("2023-12-31", [...simpleLines(), ol("103", 0), ol("251", 0)]);
    const [v] = await openingRows();
    const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, v.id));
    expect(lines.map((l) => l.accountId).sort()).toEqual([acc["101"], acc["331"]].sort());
  });

  it("4: debits and credits built from the signs must match", async () => {
    const lines = [ol("101", 1_000_000), ol("331", 900_000)];
    expect(await saveOpening(db, admin, { date: "2023-12-31", version: null, lines })).toEqual({
      ok: false,
      error: MSG.unbalanced("100,000"),
    });
    // a negative balance on a debit-normal (contra) account is a credit
    const contra = [ol("212", 500_000), ol("213", -200_000), ol("331", 500_000)];
    expect(await saveOpening(db, admin, { date: "2023-12-31", version: null, lines: contra })).toEqual({
      ok: false,
      error: MSG.unbalanced("200,000"),
    });
  });

  it("5: a requiresPartner account needs a partner on every line", async () => {
    const lines = [ol("108", 500_000), ol("331", 500_000)];
    expect(await saveOpening(db, admin, { date: "2023-12-31", version: null, lines })).toEqual({
      ok: false,
      error: MSG.partner("108", "외상매출금"),
    });
    await mustSave("2023-12-31", fullLines());
  });

  it("6: the cut-off must precede every regular voucher", async () => {
    const r = await createVoucher(db, admin, voucher("2024-03-10"));
    expect(r.ok).toBe(true);
    for (const date of ["2024-03-10", "2024-05-01"]) {
      expect(await saveOpening(db, admin, { date, version: null, lines: simpleLines() })).toEqual({
        ok: false,
        error: MSG.firstVoucher("2024-03-10"),
      });
    }
    await mustSave("2024-03-09");
  });

  it("7: the month of the cut-off and of the stored opening must be open", async () => {
    // an empty closed month
    expect((await closeMonth(db, admin, "2023-11")).ok).toBe(true);
    expect(await saveOpening(db, admin, { date: "2023-11-30", version: null, lines: simpleLines() })).toEqual({
      ok: false,
      error: MSG.closed("2023-11"),
    });
    await mustSave("2023-12-31");
    expect((await closeMonth(db, admin, "2023-12")).ok).toBe(true);
    // the stored opening's month is closed: neither re-saving nor moving it out is allowed
    for (const date of ["2023-12-31", "2024-01-31"]) {
      expect(await saveOpening(db, admin, { date, version: 1, lines: simpleLines(5) })).toEqual({
        ok: false,
        error: MSG.closed("2023-12"),
      });
    }
    const [v] = await openingRows();
    expect(v.version).toBe(1);
  });

  it("checks the rules in order", async () => {
    await createVoucher(db, admin, voucher("2023-11-15"));
    expect((await closeMonth(db, admin, "2023-11")).ok).toBe(true);
    // unbalanced, missing partner, after the first voucher, in a closed month
    const bad = [ol("108", 500_000), ol("331", 400_000)];
    const save = (lines: OpeningLine[]) => saveOpening(db, admin, { date: "2023-11-20", version: null, lines });
    expect(await save(bad)).toEqual({ ok: false, error: MSG.unbalanced("100,000") });
    expect(await save([ol("108", 500_000), ol("331", 500_000)])).toEqual({
      ok: false,
      error: MSG.partner("108", "외상매출금"),
    });
    expect(await save([ol("108", 500_000, partnerA), ol("331", 500_000)])).toEqual({
      ok: false,
      error: MSG.firstVoucher("2023-11-15"),
    });
    expect(
      await saveOpening(db, admin, { date: "2023-11-10", version: null, lines: simpleLines() }),
    ).toEqual({ ok: false, error: MSG.closed("2023-11") });
    expect(await openingRows()).toHaveLength(0);
  });
});

describe("saveOpening writes one opening voucher", () => {
  it("creates an approved opening voucher regardless of the approval setting", async () => {
    const c = await getCompany(db);
    expect((await updateCompany(db, { ...c, approvalRequired: true }, admin.id)).ok).toBe(true);
    const [second] = await db.insert(sites).values({ name: "지점" }).returning({ id: sites.id });
    await db.update(sites).set({ isActive: false }).where(eq(sites.id, siteId));

    await mustSave("2023-12-31", fullLines());
    const [v] = await openingRows();
    expect(v).toMatchObject({
      date: "2023-12-31",
      kind: "opening",
      entryType: "general",
      description: "기초잔액",
      partnerId: null,
      evidenceType: "none",
      vatType: null,
      vatDeductible: null,
      supplyAmount: null,
      vatAmount: null,
      status: "approved",
      approvedBy: admin.id,
      version: 1,
      no: 1,
    });
    const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, v.id));
    expect(lines.every((l) => l.siteId === second.id && l.description === "기초잔액" && l.departmentId === null)).toBe(
      true,
    );
    const by = (code: string, partnerId: number | null = null) =>
      lines.find((l) => l.accountId === acc[code] && l.partnerId === partnerId);
    expect(by("101")).toMatchObject({ side: "debit", amount: 1_000_000 });
    expect(by("108", partnerA)).toMatchObject({ side: "debit", amount: 300_000 });
    expect(by("108", partnerB)).toMatchObject({ side: "debit", amount: 200_000 });
    expect(by("213")).toMatchObject({ side: "credit", amount: 200_000 });
    expect(by("331")).toMatchObject({ side: "credit", amount: 1_800_000 });

    expect(await getOpeningCutoff(db)).toBe("2023-12-31");
    const opening = await getOpening(db);
    expect(opening).toMatchObject({ voucherId: v.id, version: 1, date: "2023-12-31" });
    expect(opening.lines).toEqual(expect.arrayContaining(fullLines()));
    expect(opening.lines).toHaveLength(fullLines().length);
  });

  it("is empty before anything is saved", async () => {
    expect(await getOpening(db)).toEqual({ voucherId: null, version: null, date: null, lines: [] });
    expect(await getOpeningCutoff(db)).toBeNull();
  });

  it("saving twice replaces the same voucher: version 2, two history rows", async () => {
    await mustSave("2023-12-31");
    const [first] = await openingRows();
    await mustSave("2023-12-30", fullLines(), 1);
    const rows = await openingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, version: 2, date: "2023-12-30", status: "approved" });
    const history = await db
      .select({ action: voucherHistory.action })
      .from(voucherHistory)
      .where(eq(voucherHistory.voucherId, first.id))
      .orderBy(voucherHistory.id);
    expect(history.map((h) => h.action)).toEqual(["created", "updated"]);
    const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, first.id));
    expect(lines).toHaveLength(fullLines().length);
  });

  it("refuses a stale or missing version", async () => {
    await mustSave("2023-12-31");
    expect(await saveOpening(db, admin, { date: "2023-12-31", version: null, lines: simpleLines(7) })).toEqual({
      ok: false,
      error: MSG.conflict,
    });
    await mustSave("2023-12-31", simpleLines(8), 1);
    expect(await saveOpening(db, admin, { date: "2023-12-31", version: 1, lines: simpleLines(9) })).toEqual({
      ok: false,
      error: MSG.conflict,
    });
    expect((await openingRows())[0].version).toBe(2);
  });

  it("a concurrent second create gets the conflict message", async () => {
    const results = await Promise.all([
      saveOpening(db, admin, { date: "2023-12-31", version: null, lines: simpleLines(1) }),
      saveOpening(db, admin, { date: "2023-12-30", version: null, lines: simpleLines(2) }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: MSG.conflict }]);
    expect(await openingRows()).toHaveLength(1);
  });

  it("the database allows only one opening voucher", async () => {
    await mustSave("2023-12-31");
    const [v] = await openingRows();
    await expect(
      db.insert(vouchers).values({ ...v, id: undefined, date: "2023-12-01", no: 1 }),
    ).rejects.toMatchObject({ cause: { code: "23505", constraint_name: "vouchers_single_opening_uq" } });
    // other kinds are not constrained
    expect((await createVoucher(db, admin, voucher("2024-01-02"))).ok).toBe(true);
    expect((await createVoucher(db, admin, voucher("2024-01-03"))).ok).toBe(true);
  });

  it("the trial balance as of the cut-off equals the entered balances", async () => {
    await mustSave("2023-12-31", fullLines());
    const tb = await getTrialBalance(db, { from: "2023-12-31", to: "2023-12-31", siteId: null, departmentId: null });
    const row = (code: string) => {
      const r = tb.rows.find((x) => x.kind === "account" && x.code === code);
      if (!r || r.kind !== "account") throw new Error(`no row ${code}`);
      return { debit: r.debitBalance, credit: r.creditBalance };
    };
    expect(row("101")).toEqual({ debit: 1_000_000, credit: 0 });
    expect(row("108")).toEqual({ debit: 500_000, credit: 0 });
    expect(row("212")).toEqual({ debit: 500_000, credit: 0 });
    expect(row("213")).toEqual({ debit: 0, credit: 200_000 });
    expect(row("331")).toEqual({ debit: 0, credit: 1_800_000 });
    expect(tb.balanced).toBe(true);
    expect(tb.total.debitBalance).toBe(2_000_000);
  });
});

describe("regular vouchers and the cut-off", () => {
  it("create and update must be dated after the cut-off", async () => {
    await mustSave("2023-12-31");
    expect(await createVoucher(db, admin, voucher("2023-12-31"))).toEqual({ ok: false, error: MSG.cutoff("2023-12-31") });
    expect(await createVoucher(db, admin, voucher("2023-06-01"))).toEqual({ ok: false, error: MSG.cutoff("2023-12-31") });
    const r = await createVoucher(db, admin, voucher("2024-01-01"));
    if (!r.ok) throw new Error(r.error);
    expect(await updateVoucher(db, admin, r.value.id, 1, voucher("2023-12-31"))).toEqual({
      ok: false,
      error: MSG.cutoff("2023-12-31"),
    });
    expect(await updateVoucher(db, admin, r.value.id, 1, voucher("2024-01-05"))).toEqual({ ok: true, value: undefined });
  });

  it("the opening voucher is changed only through saveOpening", async () => {
    await mustSave("2023-12-31");
    const [v] = await openingRows();
    const asVoucher: VoucherInput = { ...voucher("2023-12-31"), description: "기초잔액" };
    expect(await updateVoucher(db, admin, v.id, 1, asVoucher)).toEqual({ ok: false, error: MSG.openingOnly });
    expect(await deleteVoucher(db, admin, v.id, 1)).toEqual({ ok: false, error: MSG.openingOnly });
    expect(await approveVoucher(db, admin, v.id, 1)).toMatchObject({ ok: false });
    const [after] = await db
      .select({ version: vouchers.version })
      .from(vouchers)
      .where(and(eq(vouchers.id, v.id), eq(vouchers.kind, "opening")));
    expect(after.version).toBe(1);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(voucherHistory);
    expect(n).toBe(1);
  });
});
