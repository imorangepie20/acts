import { asc, eq } from "drizzle-orm";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { voucherAttachments, vouchers } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { canModify } from "@/server/vouchers/service";
import { addHistory, loadSnapshot, type Conn } from "@/server/vouchers/snapshot";
import { MAX_ATTACHMENT_BYTES, removeStored, resolveStored, sniffType, writeStored } from "./storage";

const ERR_SIZE = "파일은 10MB 이하여야 합니다.";
const ERR_TYPE = "JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.";
const ERR_FORBIDDEN = "이 전표를 수정할 권한이 없습니다.";
const ERR_VOUCHER = "전표를 찾을 수 없습니다.";
const ERR_NOT_FOUND = "첨부파일을 찾을 수 없습니다.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 200;

export type AttachmentRow = { id: string; fileName: string; mimeType: string; size: number; createdAt: Date };

/** Display name: last path segment, no control or bidi-override characters, bounded length. */
function displayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, MAX_NAME);
  return clean || "첨부파일";
}

/** Checks the voucher exists and the actor may modify it; `lock` takes the row lock (FOR UPDATE). */
async function checkVoucher(conn: Conn, actor: SessionUser, voucherId: string, lock: boolean): Promise<Result> {
  const q = conn.select({ createdBy: vouchers.createdBy }).from(vouchers).where(eq(vouchers.id, voucherId));
  const [v] = lock ? await q.for("update") : await q;
  if (!v) return fail(ERR_VOUCHER);
  return canModify(actor, v) ? ok() : fail(ERR_FORBIDDEN);
}

export async function addAttachment(
  db: Db,
  actor: SessionUser,
  voucherId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<Result<{ id: string }>> {
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) return fail(ERR_SIZE);
  const type = sniffType(file.bytes);
  if (!type) return fail(ERR_TYPE);
  if (!UUID_RE.test(voucherId)) return fail(ERR_VOUCHER);
  // Cheap pre-check so a refused upload never touches the disk; re-checked under the lock below.
  const pre = await checkVoucher(db, actor, voucherId, false);
  if (!pre.ok) return pre;

  const fileName = displayName(file.name);
  const storagePath = await writeStored(file.bytes, type);
  let result: Result<{ id: string }>;
  try {
    result = await db.transaction(async (tx) => {
      const allowed = await checkVoucher(tx, actor, voucherId, true);
      if (!allowed.ok) return allowed;
      const [{ id }] = await tx
        .insert(voucherAttachments)
        .values({
          voucherId,
          fileName,
          mimeType: type,
          size: file.bytes.length,
          storagePath,
          uploadedBy: actor.id,
        })
        .returning({ id: voucherAttachments.id });
      await addHistory(tx, voucherId, "attached", actor.id, (await loadSnapshot(tx, voucherId))!, fileName);
      return ok({ id });
    });
  } catch (e) {
    await removeStored(storagePath);
    throw e;
  }
  if (!result.ok) await removeStored(storagePath);
  return result;
}

export async function removeAttachment(db: Db, actor: SessionUser, attachmentId: string): Promise<Result> {
  if (!UUID_RE.test(attachmentId)) return fail(ERR_NOT_FOUND);
  const r = await db.transaction(async (tx): Promise<Result<string>> => {
    const [a] = await tx
      .select({ voucherId: voucherAttachments.voucherId })
      .from(voucherAttachments)
      .where(eq(voucherAttachments.id, attachmentId));
    if (!a) return fail(ERR_NOT_FOUND);
    const allowed = await checkVoucher(tx, actor, a.voucherId, true);
    if (!allowed.ok) return allowed;
    // Under the voucher lock: a concurrent remove/delete already took it if this returns nothing.
    const [gone] = await tx
      .delete(voucherAttachments)
      .where(eq(voucherAttachments.id, attachmentId))
      .returning({ fileName: voucherAttachments.fileName, storagePath: voucherAttachments.storagePath });
    if (!gone) return fail(ERR_NOT_FOUND);
    await addHistory(tx, a.voucherId, "detached", actor.id, (await loadSnapshot(tx, a.voucherId))!, gone.fileName);
    return ok(gone.storagePath);
  });
  if (!r.ok) return r;
  await removeStored(r.value);
  return ok();
}

export async function listAttachments(db: Conn, voucherId: string): Promise<AttachmentRow[]> {
  if (!UUID_RE.test(voucherId)) return [];
  return db
    .select({
      id: voucherAttachments.id,
      fileName: voucherAttachments.fileName,
      mimeType: voucherAttachments.mimeType,
      size: voucherAttachments.size,
      createdAt: voucherAttachments.createdAt,
    })
    .from(voucherAttachments)
    .where(eq(voucherAttachments.voucherId, voucherId))
    .orderBy(asc(voucherAttachments.createdAt), asc(voucherAttachments.id));
}

export async function getAttachmentFile(
  db: Db,
  id: string,
): Promise<{ fileName: string; mimeType: string; absolutePath: string } | null> {
  if (!UUID_RE.test(id)) return null;
  const [a] = await db
    .select({
      fileName: voucherAttachments.fileName,
      mimeType: voucherAttachments.mimeType,
      storagePath: voucherAttachments.storagePath,
    })
    .from(voucherAttachments)
    .where(eq(voucherAttachments.id, id));
  if (!a) return null;
  const absolutePath = resolveStored(a.storagePath);
  return absolutePath ? { fileName: a.fileName, mimeType: a.mimeType, absolutePath } : null;
}
