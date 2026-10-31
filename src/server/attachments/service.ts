import { and, asc, eq, ne } from "drizzle-orm";
import type { SessionUser } from "@/server/auth/service";
import { assertMonthsOpen, closedMonthMessage, isMonthClosed, monthOf } from "@/server/closing/periods";
import type { Db } from "@/server/db/client";
import { voucherAttachments, vouchers } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import { canModify, ERR_CONFLICT, ERR_PAYROLL_ONLY } from "@/server/vouchers/service";
import { addHistory, loadSnapshot, type Conn } from "@/server/vouchers/snapshot";
import { MAX_ATTACHMENT_BYTES, removeStored, resolveStored, sniffType, writeStored } from "./storage";
import { isUuid } from "@/lib/uuid";

const ERR_SIZE = "파일은 10MB 이하여야 합니다.";
const ERR_TYPE = "JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.";
const ERR_FORBIDDEN = "이 전표를 수정할 권한이 없습니다.";
const ERR_VOUCHER = "전표를 찾을 수 없습니다.";
const ERR_NOT_FOUND = "첨부파일을 찾을 수 없습니다.";

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

/**
 * Checks the voucher exists and the actor may modify it, returning its date; `lock` takes the row
 * lock (FOR UPDATE). Payroll vouchers are refused: they change only through their run.
 */
async function checkVoucher(
  conn: Conn,
  actor: SessionUser,
  voucherId: string,
  lock: boolean,
): Promise<Result<{ date: string }>> {
  const q = conn
    .select({ createdBy: vouchers.createdBy, date: vouchers.date, kind: vouchers.kind })
    .from(vouchers)
    .where(eq(vouchers.id, voucherId));
  const [v] = lock ? await q.for("update") : await q;
  if (!v) return fail(ERR_VOUCHER);
  if (v.kind === "payroll") return fail(ERR_PAYROLL_ONLY);
  return canModify(actor, v) ? ok({ date: v.date }) : fail(ERR_FORBIDDEN);
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
  if (!isUuid(voucherId)) return fail(ERR_VOUCHER);
  // Cheap pre-check so a refused upload never touches the disk; re-checked under the lock below.
  const pre = await checkVoucher(db, actor, voucherId, false);
  if (!pre.ok) return pre;
  const month = monthOf(pre.value.date);
  if (await isMonthClosed(db, month)) return fail(closedMonthMessage(month));

  const fileName = displayName(file.name);
  const storagePath = await writeStored(file.bytes, type);
  let result: Result<{ id: string }>;
  try {
    result = await db.transaction(async (tx) => {
      // Lock order: global period lock (PERIOD_LOCK, 0) first (assertMonthsOpen) → voucher row; then confirm the date held.
      const closed = await assertMonthsOpen(tx, [pre.value.date]);
      if (closed) return fail(closed);
      const allowed = await checkVoucher(tx, actor, voucherId, true);
      if (!allowed.ok) return allowed;
      if (allowed.value.date !== pre.value.date) return fail(ERR_CONFLICT);
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
  if (!isUuid(attachmentId)) return fail(ERR_NOT_FOUND);
  // Read before the transaction so the shared period lock can be its first statement.
  const [pre] = await db
    .select({ voucherId: voucherAttachments.voucherId, date: vouchers.date })
    .from(voucherAttachments)
    .innerJoin(vouchers, eq(vouchers.id, voucherAttachments.voucherId))
    .where(eq(voucherAttachments.id, attachmentId));
  if (!pre) return fail(ERR_NOT_FOUND);
  const r = await db.transaction(async (tx): Promise<Result<string>> => {
    const closed = await assertMonthsOpen(tx, [pre.date]);
    if (closed) return fail(closed);
    const allowed = await checkVoucher(tx, actor, pre.voucherId, true);
    if (!allowed.ok) return allowed;
    if (allowed.value.date !== pre.date) return fail(ERR_CONFLICT);
    // Under the voucher lock: a concurrent remove/delete already took it if this returns nothing.
    const [gone] = await tx
      .delete(voucherAttachments)
      .where(eq(voucherAttachments.id, attachmentId))
      .returning({ fileName: voucherAttachments.fileName, storagePath: voucherAttachments.storagePath });
    if (!gone) return fail(ERR_NOT_FOUND);
    await addHistory(tx, pre.voucherId, "detached", actor.id, (await loadSnapshot(tx, pre.voucherId))!, gone.fileName);
    return ok(gone.storagePath);
  });
  if (!r.ok) return r;
  await removeStored(r.value);
  return ok();
}

export async function listAttachments(db: Conn, voucherId: string): Promise<AttachmentRow[]> {
  if (!isUuid(voucherId)) return [];
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

/** `null` when unknown, outside the upload root, or a payroll voucher's file and `opts.hidePayroll`. */
export async function getAttachmentFile(
  db: Db,
  id: string,
  opts: { hidePayroll: boolean },
): Promise<{ fileName: string; mimeType: string; absolutePath: string } | null> {
  if (!isUuid(id)) return null;
  const [a] = await db
    .select({
      fileName: voucherAttachments.fileName,
      mimeType: voucherAttachments.mimeType,
      storagePath: voucherAttachments.storagePath,
    })
    .from(voucherAttachments)
    .innerJoin(vouchers, eq(vouchers.id, voucherAttachments.voucherId))
    .where(and(eq(voucherAttachments.id, id), opts.hidePayroll ? ne(vouchers.kind, "payroll") : undefined));
  if (!a) return null;
  const absolutePath = resolveStored(a.storagePath);
  return absolutePath ? { fileName: a.fileName, mimeType: a.mimeType, absolutePath } : null;
}
