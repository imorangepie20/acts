import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { todayInSeoul } from "@/lib/vouchers/dates";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import { addAttachment, removeAttachment } from "@/server/attachments/service";
import type { SessionUser } from "@/server/auth/service";
import { createAccount, updateAccount } from "@/server/accounts/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, periodCloses, sites, users, voucherAttachments, voucherHistory, vouchers } from "@/server/db/schema";
import {
  approveVoucher,
  createVoucher,
  deleteVoucher,
  rejectVoucher,
  updateVoucher,
} from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import {
  assertMonthsOpen,
  closeMonth,
  isMonthClosed,
  listMonthStatus,
  monthKey,
  monthOf,
  reopenMonth,
} from "./periods";

const db = getTestDb();

const MSG = {
  noPermission: "마감 권한이 없습니다.",
  invalid: "입력값이 올바르지 않습니다.",
  notEnded: "아직 끝나지 않은 월은 마감할 수 없습니다.",
  already: "이미 마감된 월입니다.",
  earlier: (m: string) => `이전 월(${m})을 먼저 마감하세요.`,
  pending: (n: number) => `승인 대기 전표가 ${n}건 있어 마감할 수 없습니다.`,
  notLatest: "가장 최근에 마감한 월부터 해제할 수 있습니다.",
  notClosed: "마감되지 않은 월입니다.",
  closed: (m: string) => `마감된 월(${m})의 전표는 추가·수정·삭제할 수 없습니다.`,
  conflict: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let dir: string;
let prevUploadDir: string | undefined;
let admin: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;

beforeAll(async () => {
  prevUploadDir = process.env.UPLOAD_DIR;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "acts-closing-"));
  process.env.UPLOAD_DIR = dir;
});

afterAll(async () => {
  if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevUploadDir;
  await fs.rm(dir, { recursive: true, force: true });
});

async function mkUser(email: string, name: string, role: SessionUser["role"]): Promise<SessionUser> {
  const [u] = await db.insert(users).values({ email, name, role, passwordHash: "x" }).returning({ id: users.id });
  return { id: u.id, email, name, role };
}

async function setApproval(on: boolean) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, approvalRequired: on }, admin.id);
  if (!r.ok) throw new Error(r.error);
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
});

const line = (code: string, side: LineInput["side"], amount: number): LineInput => ({
  accountId: acc[code],
  side,
  amount,
  partnerId: null,
  siteId,
  departmentId: null,
  description: "",
});

const input = (date: string, description = "회식비"): VoucherInput => ({
  date,
  description,
  entryType: "general", kind: "general",
  partnerId: null,
  evidenceType: "none",
  vatType: null,
  vatDeductible: null,
  supplyAmount: null,
  vatAmount: null,
  lines: [line("811", "debit", 10000), line("101", "credit", 10000)],
});

async function mkVoucher(date: string, actor = admin): Promise<string> {
  const r = await createVoucher(db, actor, input(date));
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

async function mustClose(month: string) {
  const r = await closeMonth(db, admin, month);
  if (!r.ok) throw new Error(r.error);
}

/** Everything a refused write must leave untouched. */
async function dbState() {
  const vs = await db
    .select({ id: vouchers.id, date: vouchers.date, version: vouchers.version, status: vouchers.status })
    .from(vouchers)
    .orderBy(vouchers.id);
  const atts = await db.select({ id: voucherAttachments.id }).from(voucherAttachments).orderBy(voucherAttachments.id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(voucherHistory);
  return { vs, atts, history: n };
}

describe("month helpers", () => {
  it("monthOf and monthKey", () => {
    expect(monthOf("2024-03-15")).toBe("2024-03");
    expect(monthKey("2024-01")).toBe(2024 * 12);
    expect(monthKey("2024-12")).toBe(2024 * 12 + 11);
    expect(monthKey("2025-01") - monthKey("2024-12")).toBe(1);
  });
});

describe("closeMonth rules", () => {
  it("requires period:close", async () => {
    expect(await closeMonth(db, manager, "2024-03")).toEqual({ ok: false, error: MSG.noPermission });
    await mustClose("2024-03");
    expect(await reopenMonth(db, manager, "2024-03")).toEqual({ ok: false, error: MSG.noPermission });
  });
  it("rejects a malformed month", async () => {
    for (const m of ["2024-13", "2024-3", "24-03", "2024-03-01", "", "2024-00"]) {
      expect(await closeMonth(db, admin, m)).toEqual({ ok: false, error: MSG.invalid });
      expect(await reopenMonth(db, admin, m)).toEqual({ ok: false, error: MSG.invalid });
    }
  });
  it("refuses the current month and later", async () => {
    const current = todayInSeoul().slice(0, 7);
    expect(await closeMonth(db, admin, current)).toEqual({ ok: false, error: MSG.notEnded });
    const next = `${Number(current.slice(0, 4)) + 1}-01`;
    expect(await closeMonth(db, admin, next)).toEqual({ ok: false, error: MSG.notEnded });
  });
  it("refuses an already closed month", async () => {
    await mustClose("2024-03");
    expect(await closeMonth(db, admin, "2024-03")).toEqual({ ok: false, error: MSG.already });
    // an empty earlier month is closed through the watermark
    expect(await closeMonth(db, admin, "2024-02")).toEqual({ ok: false, error: MSG.already });
  });
  it("requires the earliest open month with vouchers to be closed first", async () => {
    await mkVoucher("2024-01-10");
    await mkVoucher("2024-02-10");
    expect(await closeMonth(db, admin, "2024-03")).toEqual({ ok: false, error: MSG.earlier("2024-01") });
    await mustClose("2024-01");
    expect(await closeMonth(db, admin, "2024-03")).toEqual({ ok: false, error: MSG.earlier("2024-02") });
    await mustClose("2024-02");
    expect(await closeMonth(db, admin, "2024-03")).toEqual({ ok: true });
    // empty earlier months need not be closed
    expect(await closeMonth(db, admin, "2024-06")).toEqual({ ok: true });
  });
  it("counts rejected vouchers as having vouchers", async () => {
    await setApproval(true);
    const id = await mkVoucher("2024-01-10");
    expect(await rejectVoucher(db, admin, id, 1, "사유")).toEqual({ ok: true });
    expect(await closeMonth(db, admin, "2024-02")).toEqual({ ok: false, error: MSG.earlier("2024-01") });
  });
  it("refuses a month with pending vouchers", async () => {
    await setApproval(true);
    await mkVoucher("2024-03-10");
    await mkVoucher("2024-03-11");
    expect(await closeMonth(db, admin, "2024-03")).toEqual({ ok: false, error: MSG.pending(2) });
    expect(await isMonthClosed(db, "2024-03")).toBe(false);
  });
  it("records who closed the month", async () => {
    await mkVoucher("2024-03-10");
    await mustClose("2024-03");
    expect(await isMonthClosed(db, "2024-03")).toBe(true);
    const [row] = await db.select().from(periodCloses).where(eq(periodCloses.month, "2024-03"));
    expect(row.closedBy).toBe(admin.id);
    expect(row.closedAt).toBeInstanceOf(Date);
  });
});

describe("reopenMonth rules", () => {
  it("only reopens the latest closed month", async () => {
    await mustClose("2024-01");
    await mustClose("2024-02");
    expect(await reopenMonth(db, admin, "2024-01")).toEqual({ ok: false, error: MSG.notLatest });
    expect(await reopenMonth(db, admin, "2024-02")).toEqual({ ok: true });
    expect(await isMonthClosed(db, "2024-02")).toBe(false);
    expect(await reopenMonth(db, admin, "2024-01")).toEqual({ ok: true });
  });
  it("refuses a month that is not closed", async () => {
    expect(await reopenMonth(db, admin, "2024-05")).toEqual({ ok: false, error: MSG.notClosed });
    await mustClose("2024-03");
    expect(await reopenMonth(db, admin, "2024-05")).toEqual({ ok: false, error: MSG.notClosed });
  });
  it("refuses an empty month closed only through the watermark", async () => {
    await mustClose("2024-03");
    expect(await reopenMonth(db, admin, "2024-02")).toEqual({ ok: false, error: MSG.notLatest });
  });
});

describe("listMonthStatus", () => {
  it("lists the 12 months of the fiscal year with counts and closer", async () => {
    await setApproval(true);
    const a = await mkVoucher("2024-01-05");
    await approveVoucher(db, admin, a, 1);
    await mkVoucher("2024-02-05"); // pending
    const b = await mkVoucher("2024-02-06");
    await approveVoucher(db, admin, b, 1);
    await mustClose("2024-01");
    await mkVoucher("2025-01-01"); // outside the fiscal year
    const rows = await listMonthStatus(db, "2024-01-01");
    expect(rows.map((r) => r.month)).toEqual([
      "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
      "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
    ]);
    expect(rows[0]).toMatchObject({
      closed: true,
      reopenable: true,
      closedByName: "관리자",
      voucherCount: 1,
      pendingCount: 0,
    });
    expect(rows[0].closedAt).toBeInstanceOf(Date);
    expect(rows[1]).toEqual({
      month: "2024-02",
      closed: false,
      reopenable: false,
      closedAt: null,
      closedByName: null,
      voucherCount: 2,
      pendingCount: 1,
    });
    expect(rows[2]).toMatchObject({ closed: false, voucherCount: 0, pendingCount: 0 });
  });
  it("shows months through the watermark as closed; only the latest explicit close is reopenable", async () => {
    await mustClose("2024-03");
    const rows = await listMonthStatus(db, "2024-01-01");
    expect(rows.slice(0, 4).map((r) => [r.month, r.closed, r.reopenable, r.closedByName])).toEqual([
      ["2024-01", true, false, null],
      ["2024-02", true, false, null],
      ["2024-03", true, true, "관리자"],
      ["2024-04", false, false, null],
    ]);
  });
  it("starts at the fiscal start month across the calendar year", async () => {
    const rows = await listMonthStatus(db, "2024-04-01");
    expect(rows[0].month).toBe("2024-04");
    expect(rows[11].month).toBe("2025-03");
  });
});

describe("assertMonthsOpen", () => {
  it("returns the message for the first closed month, else null", async () => {
    await mustClose("2024-03");
    const r = await db.transaction(async (tx) => ({
      open: await assertMonthsOpen(tx, ["2024-04-01", "2024-05-31"]),
      closed: await assertMonthsOpen(tx, ["2024-04-01", "2024-03-31", "2024-02-01"]),
    }));
    expect(r).toEqual({ open: null, closed: MSG.closed("2024-02") });
  });
});

describe("every write path respects month close", () => {
  it("refuses create, update, delete, approve, reject, attach and detach in a closed month", async () => {
    const m = "2024-03";
    const vUpdate = await mkVoucher("2024-03-01");
    const vDelete = await mkVoucher("2024-03-02");
    const vApprove = await mkVoucher("2024-03-03");
    const vReject = await mkVoucher("2024-03-04");
    const vAttach = await mkVoucher("2024-03-05");
    const att = await addAttachment(db, admin, vAttach, { name: "a.png", bytes: PNG });
    if (!att.ok) throw new Error(att.error);
    await mustClose(m);
    // A pending voucher cannot be in a closed month by construction; force two to test the gate.
    await db.execute(sql`update vouchers set status = 'pending', approved_by = null, approved_at = null
      where id in (${vApprove}, ${vReject})`);
    const before = await dbState();

    const closed = { ok: false, error: MSG.closed(m) };
    expect(await createVoucher(db, admin, input("2024-03-20"))).toEqual(closed);
    expect(await updateVoucher(db, admin, vUpdate, 1, input("2024-03-01", "변경"))).toEqual(closed);
    expect(await deleteVoucher(db, admin, vDelete, 1)).toEqual(closed);
    expect(await approveVoucher(db, admin, vApprove, 1)).toEqual(closed);
    expect(await rejectVoucher(db, admin, vReject, 1, "사유")).toEqual(closed);
    expect(await addAttachment(db, admin, vAttach, { name: "b.png", bytes: PNG })).toEqual(closed);
    expect(await removeAttachment(db, admin, att.value.id)).toEqual(closed);

    expect(await dbState()).toEqual(before);
    // the refused upload left no file behind; only the first attachment is on disk
    const files = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    expect(files.filter((f) => f.isFile())).toHaveLength(1);
  });

  it("refuses moving a voucher into or out of a closed month", async () => {
    const inside = await mkVoucher("2024-03-10");
    const outside = await mkVoucher("2024-04-10");
    await mustClose("2024-03");
    const before = await dbState();
    expect(await updateVoucher(db, admin, outside, 1, input("2024-03-15"))).toEqual({
      ok: false,
      error: MSG.closed("2024-03"),
    });
    expect(await updateVoucher(db, admin, inside, 1, input("2024-04-15"))).toEqual({
      ok: false,
      error: MSG.closed("2024-03"),
    });
    expect(await dbState()).toEqual(before);
    // still free inside the open month
    expect(await updateVoucher(db, admin, outside, 1, input("2024-04-20"))).toEqual({ ok: true });
  });

  it("refuses a write into an empty earlier month once a later month is closed", async () => {
    await mustClose("2024-03");
    const before = await dbState();
    expect(await createVoucher(db, admin, input("2024-02-10"))).toEqual({ ok: false, error: MSG.closed("2024-02") });
    const later = await mkVoucher("2024-04-10");
    expect(await updateVoucher(db, admin, later, 1, input("2023-12-01"))).toEqual({
      ok: false,
      error: MSG.closed("2023-12"),
    });
    expect(await isMonthClosed(db, "2024-02")).toBe(true);
    expect(await isMonthClosed(db, "2024-04")).toBe(false);
    await deleteVoucher(db, admin, later, 1);
    expect((await dbState()).vs).toEqual(before.vs);
  });

  it("allows writes again after reopening", async () => {
    const id = await mkVoucher("2024-03-10");
    await mustClose("2024-03");
    expect(await reopenMonth(db, admin, "2024-03")).toEqual({ ok: true });
    expect(await updateVoucher(db, admin, id, 1, input("2024-03-11"))).toEqual({ ok: true });
    expect(await deleteVoucher(db, admin, id, 2)).toEqual({ ok: true });
  });
});

/** Starts `f` after `ms` (0 = right away), so iterations cover close-first, write-first and overlap. */
const after = <T>(ms: number, f: () => Promise<T>): Promise<T> =>
  ms === 0 ? f() : new Promise((resolve, reject) => setTimeout(() => f().then(resolve, reject), ms));

describe("close races a write", () => {
  it("never leaves a voucher written into a month after its close committed", async () => {
    // With approval on, a voucher written first is pending and blocks the close, and a close
    // committed first refuses the write: exactly one side must win, every time.
    await setApproval(true);
    const m = "2024-05";
    for (let i = 0; i < 10; i++) {
      await db.execute(sql`truncate period_closes, voucher_history, voucher_lines, voucher_attachments, voucher_imports, vouchers, payroll_runs CASCADE`);
      const [close, write] = await Promise.all([
        after(i * 2, () => closeMonth(db, admin, m)),
        createVoucher(db, admin, input("2024-05-15", `race ${i}`)),
      ]);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(vouchers)
        .where(sql`${vouchers.date} between '2024-05-01' and '2024-05-31'`);
      const closedNow = await isMonthClosed(db, m);
      if (close.ok) {
        expect(write).toEqual({ ok: false, error: MSG.closed(m) });
        expect(n).toBe(0);
        expect(closedNow).toBe(true);
      } else {
        expect(close).toEqual({ ok: false, error: MSG.pending(1) });
        expect(write.ok).toBe(true);
        expect(n).toBe(1);
        expect(closedNow).toBe(false);
      }
    }
  });

  it("a write into an empty earlier month: exactly one of close and write wins", async () => {
    // Write first: a pending voucher in 2024-02 makes the close fail (earlier month not closed).
    // Close first: 2024-02 is closed through the watermark and the write is refused.
    await setApproval(true);
    for (let i = 0; i < 10; i++) {
      await db.execute(sql`truncate period_closes, voucher_history, voucher_lines, voucher_attachments, voucher_imports, vouchers, payroll_runs CASCADE`);
      const [close, write] = await Promise.all([
        after(i * 2, () => closeMonth(db, admin, "2024-03")),
        createVoucher(db, admin, input("2024-02-10", `race ${i}`)),
      ]);
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(vouchers);
      if (close.ok) {
        expect(write).toEqual({ ok: false, error: MSG.closed("2024-02") });
        expect(n).toBe(0);
      } else {
        expect(close).toEqual({ ok: false, error: MSG.earlier("2024-02") });
        expect(write.ok).toBe(true);
        expect(n).toBe(1);
        expect(await isMonthClosed(db, "2024-03")).toBe(false);
      }
    }
  });

  it("an update moving a voucher into the month: exactly one of close and update wins", async () => {
    // With approval on the update leaves the voucher pending, which blocks the close.
    await setApproval(true);
    for (let i = 0; i < 10; i++) {
      await db.execute(sql`truncate period_closes, voucher_history, voucher_lines, voucher_attachments, voucher_imports, vouchers, payroll_runs CASCADE`);
      const id = await mkVoucher("2024-06-10");
      expect(await approveVoucher(db, admin, id, 1)).toEqual({ ok: true });
      const [close, write] = await Promise.all([
        after(i * 2, () => closeMonth(db, admin, "2024-05")),
        updateVoucher(db, admin, id, 2, input("2024-05-20", `race ${i}`)),
      ]);
      const [v] = await db.select({ date: vouchers.date, version: vouchers.version }).from(vouchers);
      if (close.ok) {
        expect(write).toEqual({ ok: false, error: MSG.closed("2024-05") });
        expect(v).toEqual({ date: "2024-06-10", version: 2 });
      } else {
        expect(close).toEqual({ ok: false, error: MSG.pending(1) });
        expect(write).toEqual({ ok: true });
        expect(v).toEqual({ date: "2024-05-20", version: 3 });
      }
    }
  });
});

describe("final-review guards", () => {
  it("refuses a fiscal-start change while a month is closed, but allows other saves", async () => {
    await mkVoucher("2020-01-10");
    await mustClose("2020-01");
    const c = await getCompany(db);
    const other = (c.fiscalYearStartMonth % 12) + 1;
    expect(await updateCompany(db, { ...c, fiscalYearStartMonth: other }, admin.id)).toEqual({
      ok: false,
      error: "마감된 월이 있어 회계연도 시작 월을 바꿀 수 없습니다. 마감을 모두 해제한 뒤 변경하세요.",
    });
    expect((await getCompany(db)).fiscalYearStartMonth).toBe(c.fiscalYearStartMonth);
    expect((await updateCompany(db, { ...c, name: "새 이름" }, admin.id)).ok).toBe(true);
    expect((await getCompany(db)).name).toBe("새 이름");
    await reopenMonth(db, admin, "2020-01");
    expect((await updateCompany(db, { ...c, fiscalYearStartMonth: other }, admin.id)).ok).toBe(true);
  });

  it("refuses an account group change once it has voucher lines; other edits stay allowed", async () => {
    await mkVoucher("2020-01-10");
    const err = "전표가 있는 계정은 구분을 바꿀 수 없습니다.";
    expect(await updateAccount(db, acc["811"], { group: "revenue" })).toEqual({ ok: false, error: err });
    expect((await updateAccount(db, acc["811"], { group: "sga", name: "복리후생비2", requiresPartner: true })).ok).toBe(true);
    expect((await updateAccount(db, acc["811"], { isActive: false })).ok).toBe(true);
    const fresh = await createAccount(db, { code: "899", name: "새", group: "sga", requiresPartner: false });
    if (!fresh.ok) throw new Error(fresh.error);
    expect((await updateAccount(db, fresh.value.id, { group: "revenue" })).ok).toBe(true);
  });

  it("validates dashboardRole against the account group", async () => {
    const err = "대시보드 구분이 계정 구분과 맞지 않습니다.";
    const base = { name: "역할", requiresPartner: false };
    expect(await createAccount(db, { ...base, code: "890", group: "sga", dashboardRole: "cash" })).toEqual({ ok: false, error: err });
    expect(await createAccount(db, { ...base, code: "890", group: "current_asset", dashboardRole: "payable" })).toEqual({ ok: false, error: err });
    const a = await createAccount(db, { ...base, code: "891", group: "current_asset", dashboardRole: "receivable" });
    const l = await createAccount(db, { ...base, code: "892", group: "current_liability", dashboardRole: "payable" });
    if (!a.ok || !l.ok) throw new Error("create failed");
    expect(await updateAccount(db, a.value.id, { group: "sga" })).toEqual({ ok: false, error: err });
    expect(await updateAccount(db, l.value.id, { dashboardRole: "cash" })).toEqual({ ok: false, error: err });
    expect((await updateAccount(db, l.value.id, { group: "noncurrent_liability" })).ok).toBe(true);
  });
});
