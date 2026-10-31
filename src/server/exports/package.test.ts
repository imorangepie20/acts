import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import unzipper from "unzipper";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { accounts, sites, users, voucherAttachments, vouchers } from "@/server/db/schema";
import { addAttachment } from "@/server/attachments/service";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { buildTaxPackage, getPackageSummary, safeFileName } from "./package";

const db = getTestDb();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let dir: string;
let prevUploadDir: string | undefined;
let staff: SessionUser;
let acc: Record<string, number>;
let siteId: number;

beforeAll(async () => {
  prevUploadDir = process.env.UPLOAD_DIR;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "acts-pkg-"));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevUploadDir;
  await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const [u] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "s", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: u.id, email: "s@test.kr", name: "s", role: "staff" };
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  acc = Object.fromEntries((await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]));
});

async function mkVoucher(date = "2026-10-05"): Promise<{ id: string }> {
  const line = (code: string, side: LineInput["side"]): LineInput => ({
    accountId: acc[code], side, amount: 10000, partnerId: null, siteId, departmentId: null, description: "",
  });
  const input: VoucherInput = {
    date, description: "t", entryType: "general", kind: "general", partnerId: null,
    evidenceType: "none", vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null,
    lines: [line("811", "debit"), line("101", "credit")],
  };
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
  await db.update(vouchers).set({ status: "approved" }).where(eq(vouchers.id, r.value.id));
  return r.value;
}

async function attach(id: string, name: string) {
  const r = await addAttachment(db, staff, id, { name, bytes: PNG });
  if (!r.ok) throw new Error(r.error);
}

async function unpack(from = "2026-10-01", to = "2026-10-31"): Promise<Map<string, Buffer>> {
  const stream = await buildTaxPackage(db, from, to);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const opened = await unzipper.Open.buffer(Buffer.concat(chunks));
  const out = new Map<string, Buffer>();
  for (const f of opened.files) if (f.type === "File") out.set(f.path, await f.buffer());
  return out;
}

describe("safeFileName", () => {
  it("replaces separators, reserved and control characters and trims to 100", () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j\u0001k.png')).toBe("a_b_c_d_e_f_g_h_i_j_k.png");
    expect(safeFileName("가".repeat(150))).toHaveLength(100);
  });
});

describe("buildTaxPackage", () => {
  it("contains the four workbooks and posted attachments only", async () => {
    const v = await mkVoucher();
    await attach(v.id, "영수증.png");
    const pending = await mkVoucher();
    await db.update(vouchers).set({ status: "pending" }).where(eq(vouchers.id, pending.id));
    await attach(pending.id, "대기.png");

    const files = await unpack();
    const names = [...files.keys()].sort();
    expect(names).toContain("분개장.xlsx");
    expect(names).toContain("합계잔액시산표.xlsx");
    expect(names).toContain("세금계산서.xlsx");
    expect(names).toContain("카드·현금영수증 매입.xlsx");
    const evidence = names.filter((n) => n.startsWith("증빙/"));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatch(/^증빙\/\d{8}-\d{4}_1_영수증\.png$/);
    expect(files.get(evidence[0])).toEqual(Buffer.from(PNG));
    expect(names).not.toContain("누락된 증빙.txt");
  });

  it("lists a missing stored file in 누락된 증빙.txt", async () => {
    const v = await mkVoucher();
    await attach(v.id, "a.png");
    await attach(v.id, "b.png");
    const rows = await db.select().from(voucherAttachments).where(eq(voucherAttachments.fileName, "b.png"));
    await fs.rm(path.join(dir, rows[0].storagePath));

    const files = await unpack();
    const txt = files.get("누락된 증빙.txt")!.toString("utf8");
    expect(txt).toMatch(/^\d{8}-\d{4} b\.png$/m);
    expect(txt).not.toContain("a.png");
    expect([...files.keys()].filter((n) => n.startsWith("증빙/"))).toHaveLength(1);
  });

  it("reports an unreadable stored path as missing instead of failing", async () => {
    const v = await mkVoucher();
    await attach(v.id, "a.png");
    await attach(v.id, "b.png");
    const [row] = await db.select().from(voucherAttachments).where(eq(voucherAttachments.fileName, "b.png"));
    await fs.rm(path.join(dir, row.storagePath));
    await fs.mkdir(path.join(dir, row.storagePath)); // a directory where the file should be

    const files = await unpack();
    expect(files.get("누락된 증빙.txt")!.toString("utf8")).toMatch(/b\.png/);
    expect([...files.keys()].filter((n) => n.startsWith("증빙/"))).toHaveLength(1);
  });

  it("keeps a traversal name inside 증빙/", async () => {
    const v = await mkVoucher();
    await attach(v.id, "x.png");
    // the attachment service already strips directories from uploads; force the raw name to test the zip itself
    await db.update(voucherAttachments).set({ fileName: "../../evil.png" });
    const files = await unpack();
    const evidence = [...files.keys()].filter((n) => n.startsWith("증빙/"));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatch(/^증빙\/\d{8}-\d{4}_1_\.\._\.\._evil\.png$/);
    expect(evidence[0].split("/")).toHaveLength(2);
  });
});

describe("getPackageSummary", () => {
  it("counts attachments of posted vouchers and pending vouchers in range", async () => {
    const v = await mkVoucher();
    await attach(v.id, "a.png");
    const p = await mkVoucher();
    await db.update(vouchers).set({ status: "pending" }).where(eq(vouchers.id, p.id));
    await attach(p.id, "p.png");
    const s = await getPackageSummary(db, "2026-10-01", "2026-10-31");
    expect(s.attachments).toEqual({ count: 1, bytes: PNG.length });
    expect(s.pending).toBe(1);
    expect(s.invoicesSale).toEqual({ count: 0, total: 0 });
    expect(s.cards).toEqual({ count: 0, total: 0 });
  });
});
