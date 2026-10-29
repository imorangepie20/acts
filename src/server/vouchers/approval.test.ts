import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, sites, users, vouchers } from "@/server/db/schema";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import {
  approveVoucher,
  countPending,
  createVoucher,
  getVoucher,
  listHistory,
  rejectVoucher,
  updateVoucher,
} from "./service";

const db = getTestDb();

const MSG = {
  notPending: "승인 대기 중인 전표가 아닙니다.",
  reason: "반려 사유를 입력하세요.",
  forbidden: "승인 권한이 없습니다.",
  conflict: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
  notFound: "전표를 찾을 수 없습니다.",
  auto: "전표 승인 기능 해제로 자동 승인",
};

let staff: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;

async function mkUser(email: string, name: string, role: SessionUser["role"]): Promise<SessionUser> {
  const [u] = await db.insert(users).values({ email, name, role, passwordHash: "x" }).returning({ id: users.id });
  return { id: u.id, email, name, role };
}

async function setApproval(on: boolean, actor = manager) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, approvalRequired: on }, actor.id);
  if (!r.ok) throw new Error(r.error);
}

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  staff = await mkUser("staff@test.kr", "직원", "staff");
  manager = await mkUser("manager@test.kr", "팀장", "manager");
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  await setApproval(true);
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

const input = (description = "회식비"): VoucherInput => ({
  date: "2026-10-30",
  description,
  entryType: "general",
  partnerId: null,
  evidenceType: "none",
  vatType: null,
  vatDeductible: null,
  supplyAmount: null,
  vatAmount: null,
  lines: [line("811", "debit", 10000), line("101", "credit", 10000)],
});

async function pendingVoucher(description?: string): Promise<string> {
  const r = await createVoucher(db, staff, input(description));
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

describe("approveVoucher", () => {
  it("approves a pending voucher and records approver and history", async () => {
    const id = await pendingVoucher();
    expect((await getVoucher(db, id))!.status).toBe("pending");
    const r = await approveVoucher(db, manager, id, 1);
    expect(r).toEqual({ ok: true });
    const v = (await getVoucher(db, id))!;
    expect(v).toMatchObject({ status: "approved", approvedBy: { id: manager.id }, version: 2 });
    expect(v.approvedAt).toBeInstanceOf(Date);
    const h = await listHistory(db, id);
    expect(h.map((e) => e.action)).toEqual(["created", "approved"]);
    expect(h[1]).toMatchObject({ userName: "팀장", note: null });
    expect(h[1].snapshot.status).toBe("approved");
  });
  it("allows self-approval", async () => {
    const own = await createVoucher(db, manager, input());
    if (!own.ok) throw new Error(own.error);
    expect(await approveVoucher(db, manager, own.value.id, 1)).toEqual({ ok: true });
  });
  it("rejects actors without voucher:approve", async () => {
    const id = await pendingVoucher();
    expect(await approveVoucher(db, staff, id, 1)).toEqual({ ok: false, error: MSG.forbidden });
    expect(await rejectVoucher(db, staff, id, 1, "x")).toEqual({ ok: false, error: MSG.forbidden });
    expect((await getVoucher(db, id))!.status).toBe("pending");
  });
  it("only approves pending vouchers", async () => {
    const id = await pendingVoucher();
    await approveVoucher(db, manager, id, 1);
    expect(await approveVoucher(db, manager, id, 2)).toEqual({ ok: false, error: MSG.notPending });
    expect(await rejectVoucher(db, manager, id, 2, "사유")).toEqual({ ok: false, error: MSG.notPending });
  });
  it("checks the version and existence", async () => {
    const id = await pendingVoucher();
    expect(await approveVoucher(db, manager, id, 5)).toEqual({ ok: false, error: MSG.conflict });
    expect(await approveVoucher(db, manager, "nope", 1)).toEqual({ ok: false, error: MSG.notFound });
    expect((await getVoucher(db, id))!.status).toBe("pending");
  });
});

describe("rejectVoucher", () => {
  it("stores the trimmed reason and history note", async () => {
    const id = await pendingVoucher();
    expect(await rejectVoucher(db, manager, id, 1, "  증빙 누락  ")).toEqual({ ok: true });
    const v = (await getVoucher(db, id))!;
    expect(v).toMatchObject({ status: "rejected", rejectReason: "증빙 누락", approvedBy: null, version: 2 });
    const h = await listHistory(db, id);
    expect(h.map((e) => e.action)).toEqual(["created", "rejected"]);
    expect(h[1].note).toBe("증빙 누락");
  });
  it("requires a non-blank reason", async () => {
    const id = await pendingVoucher();
    expect(await rejectVoucher(db, manager, id, 1, "   ")).toEqual({ ok: false, error: MSG.reason });
    expect((await getVoucher(db, id))!.status).toBe("pending");
  });
  it("editing a rejected voucher returns it to pending and clears the reason", async () => {
    const id = await pendingVoucher();
    await rejectVoucher(db, manager, id, 1, "증빙 누락");
    expect(await updateVoucher(db, staff, id, 2, input("수정"))).toEqual({ ok: true });
    const v = (await getVoucher(db, id))!;
    expect(v).toMatchObject({ status: "pending", rejectReason: null, description: "수정" });
  });
});

describe("countPending", () => {
  it("counts only pending vouchers", async () => {
    expect(await countPending(db)).toBe(0);
    const a = await pendingVoucher("a");
    await pendingVoucher("b");
    await pendingVoucher("c");
    expect(await countPending(db)).toBe(3);
    await approveVoucher(db, manager, a, 1);
    expect(await countPending(db)).toBe(2);
  });
});

describe("turning approval off", () => {
  it("approves pending vouchers with a history note and leaves rejected ones", async () => {
    const p = await pendingVoucher("대기");
    const rej = await pendingVoucher("반려");
    await rejectVoucher(db, manager, rej, 1, "사유");
    await setApproval(false);

    const v = (await getVoucher(db, p))!;
    expect(v).toMatchObject({ status: "approved", approvedBy: { id: manager.id }, version: 2 });
    const h = await listHistory(db, p);
    expect(h.map((e) => e.action)).toEqual(["created", "approved"]);
    expect(h[1]).toMatchObject({ note: MSG.auto, userName: "팀장" });

    expect((await getVoucher(db, rej))!).toMatchObject({ status: "rejected", rejectReason: "사유" });
    expect(await countPending(db)).toBe(0);
  });
  it("turning it on changes nothing that exists", async () => {
    await setApproval(false);
    const r = await createVoucher(db, staff, input());
    if (!r.ok) throw new Error(r.error);
    await setApproval(true);
    expect((await getVoucher(db, r.value.id))!.status).toBe("approved");
    expect((await db.select().from(vouchers).where(eq(vouchers.id, r.value.id)))[0].version).toBe(1);
  });
  it("saving with approval already off does not touch vouchers", async () => {
    await setApproval(false);
    const c = await getCompany(db);
    expect(await updateCompany(db, c, manager.id)).toEqual({ ok: true });
  });
});
