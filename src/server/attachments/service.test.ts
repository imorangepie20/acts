import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { accounts, sites, users, voucherAttachments } from "@/server/db/schema";
import { createVoucher, deleteVoucher, getVoucher, listHistory } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { addAttachment, getAttachmentFile, listAttachments, removeAttachment } from "./service";
import { MAX_ATTACHMENT_BYTES } from "./storage";

const db = getTestDb();

const MSG = {
  size: "파일은 10MB 이하여야 합니다.",
  type: "JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.",
  forbidden: "이 전표를 수정할 권한이 없습니다.",
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"));

let dir: string;
let prevUploadDir: string | undefined;
let staff: SessionUser;
let staff2: SessionUser;
let manager: SessionUser;
let voucherId: string;

beforeAll(async () => {
  prevUploadDir = process.env.UPLOAD_DIR;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "acts-uploads-"));
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

async function mkVoucher(actor: SessionUser): Promise<string> {
  const acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  const [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  const line = (code: string, side: LineInput["side"]): LineInput => ({
    accountId: acc[code],
    side,
    amount: 10000,
    partnerId: null,
    siteId,
    departmentId: null,
    description: "",
  });
  const input: VoucherInput = {
    date: "2026-10-30",
    description: "회식비",
    entryType: "general",
    partnerId: null,
    evidenceType: "none",
    vatType: null,
    vatDeductible: null,
    supplyAmount: null,
    vatAmount: null,
    lines: [line("811", "debit"), line("101", "credit")],
  };
  const r = await createVoucher(db, actor, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

async function filesOnDisk(): Promise<string[]> {
  const out = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return out.filter((d) => d.isFile()).map((d) => path.relative(dir, path.join(d.parentPath, d.name)));
}

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  staff = await mkUser("staff@test.kr", "직원", "staff");
  staff2 = await mkUser("staff2@test.kr", "직원2", "staff");
  manager = await mkUser("manager@test.kr", "팀장", "manager");
  voucherId = await mkVoucher(staff);
});

describe("addAttachment", () => {
  it("stores a PNG under yyyy/mm/<uuid>.png with a row and an `attached` history entry", async () => {
    const before = await getVoucher(db, voucherId);
    const r = await addAttachment(db, staff, voucherId, { name: "영수증.png", bytes: PNG });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db.select().from(voucherAttachments);
    expect(row).toMatchObject({
      id: r.value.id,
      voucherId,
      fileName: "영수증.png",
      mimeType: "image/png",
      size: PNG.length,
      uploadedBy: staff.id,
    });
    expect(row.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(row.storagePath).not.toContain("영수증");
    const stored = await fs.readFile(path.join(dir, row.storagePath));
    expect(new Uint8Array(stored)).toEqual(PNG);

    const h = await listHistory(db, voucherId);
    expect(h.at(-1)).toMatchObject({ action: "attached", note: "영수증.png", userName: "직원" });
    expect(h.at(-1)!.snapshot.attachments).toEqual(["영수증.png"]);

    // the voucher itself is untouched
    const after = await getVoucher(db, voucherId);
    expect(after!.version).toBe(before!.version);
    expect(after!.status).toBe(before!.status);

    expect(await listAttachments(db, voucherId)).toEqual([
      { id: r.value.id, fileName: "영수증.png", mimeType: "image/png", size: PNG.length, createdAt: expect.any(Date) },
    ]);
    const file = await getAttachmentFile(db, r.value.id);
    expect(file).toEqual({
      fileName: "영수증.png",
      mimeType: "image/png",
      absolutePath: path.resolve(dir, row.storagePath),
    });
  });

  it("uses the sniffed type, not the name: a PDF named .jpg is stored as .pdf", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "scan.jpg", bytes: PDF });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(voucherAttachments);
    expect(row.mimeType).toBe("application/pdf");
    expect(row.storagePath).toMatch(/\.pdf$/);
  });

  it("rejects an HTML payload named receipt.jpg and writes nothing", async () => {
    const html = new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>"));
    expect(await addAttachment(db, staff, voucherId, { name: "receipt.jpg", bytes: html })).toEqual({
      ok: false,
      error: MSG.type,
    });
    expect(await addAttachment(db, staff, voucherId, { name: "empty.png", bytes: new Uint8Array() })).toEqual({
      ok: false,
      error: MSG.type,
    });
    expect(await db.select().from(voucherAttachments)).toHaveLength(0);
    expect(await filesOnDisk()).toEqual([]);
  });

  it("rejects files over 10MB", async () => {
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PNG);
    expect(await addAttachment(db, staff, voucherId, { name: "big.png", bytes: big })).toEqual({
      ok: false,
      error: MSG.size,
    });
    expect(await filesOnDisk()).toEqual([]);
  });

  it("forbids staff from attaching to another staff member's voucher; a manager may", async () => {
    expect(await addAttachment(db, staff2, voucherId, { name: "a.png", bytes: PNG })).toEqual({
      ok: false,
      error: MSG.forbidden,
    });
    expect(await filesOnDisk()).toEqual([]);
    expect((await addAttachment(db, manager, voucherId, { name: "a.png", bytes: PNG })).ok).toBe(true);
  });

  it("strips path components from the display name", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "..\\..\\evil/../x.png", bytes: PNG });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(voucherAttachments);
    expect(row.fileName).toBe("x.png");
  });

  it("drops control and bidi-override characters from the display name", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "‮gnp.exe\u0000", bytes: PNG });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(voucherAttachments);
    expect(row.fileName).toBe("gnp.exe");
  });

  it("returns not found for an unknown voucher", async () => {
    const r = await addAttachment(db, staff, "00000000-0000-0000-0000-000000000000", { name: "a.png", bytes: PNG });
    expect(r).toEqual({ ok: false, error: "전표를 찾을 수 없습니다." });
    expect(await filesOnDisk()).toEqual([]);
  });
});

describe("removeAttachment", () => {
  it("deletes the row and the file and writes `detached`", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "a.png", bytes: PNG });
    if (!r.ok) throw new Error(r.error);
    expect(await filesOnDisk()).toHaveLength(1);

    expect(await removeAttachment(db, staff2, r.value.id)).toEqual({ ok: false, error: MSG.forbidden });
    expect(await filesOnDisk()).toHaveLength(1);

    expect(await removeAttachment(db, staff, r.value.id)).toEqual({ ok: true, value: undefined });
    expect(await db.select().from(voucherAttachments)).toHaveLength(0);
    expect(await filesOnDisk()).toEqual([]);
    const h = await listHistory(db, voucherId);
    expect(h.at(-1)).toMatchObject({ action: "detached", note: "a.png" });
    expect(h.at(-1)!.snapshot.attachments).toEqual([]);
    expect(await getAttachmentFile(db, r.value.id)).toBeNull();
  });

  it("still succeeds when the file is already gone", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "a.png", bytes: PNG });
    if (!r.ok) throw new Error(r.error);
    const [row] = await db.select().from(voucherAttachments);
    await fs.unlink(path.join(dir, row.storagePath));
    expect((await removeAttachment(db, staff, r.value.id)).ok).toBe(true);
  });
});

describe("deleteVoucher", () => {
  it("removes the voucher's files after commit", async () => {
    await addAttachment(db, staff, voucherId, { name: "a.png", bytes: PNG });
    await addAttachment(db, staff, voucherId, { name: "b.pdf", bytes: PDF });
    expect(await filesOnDisk()).toHaveLength(2);
    const v = await getVoucher(db, voucherId);
    const r = await deleteVoucher(db, staff, voucherId, v!.version);
    expect(r.ok).toBe(true);
    expect(await filesOnDisk()).toEqual([]);
    expect(await db.select().from(voucherAttachments)).toHaveLength(0);
    const h = await listHistory(db, voucherId);
    expect(h.at(-1)!.snapshot.attachments).toEqual(["a.png", "b.pdf"]);
  });

  it("keeps the files when the delete is refused", async () => {
    await addAttachment(db, staff, voucherId, { name: "a.png", bytes: PNG });
    const v = await getVoucher(db, voucherId);
    expect((await deleteVoucher(db, staff2, voucherId, v!.version)).ok).toBe(false);
    expect(await filesOnDisk()).toHaveLength(1);
  });
});

describe("getAttachmentFile", () => {
  it("refuses a stored path that escapes the upload root", async () => {
    const r = await addAttachment(db, staff, voucherId, { name: "a.png", bytes: PNG });
    if (!r.ok) throw new Error(r.error);
    await db.update(voucherAttachments).set({ storagePath: "../../etc/passwd" });
    expect(await getAttachmentFile(db, r.value.id)).toBeNull();
    await db.update(voucherAttachments).set({ storagePath: path.resolve(os.tmpdir(), "x.png") });
    expect(await getAttachmentFile(db, r.value.id)).toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await getAttachmentFile(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await getAttachmentFile(db, "../x")).toBeNull();
  });
});
