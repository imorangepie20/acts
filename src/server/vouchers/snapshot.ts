import { asc, eq, sql } from "drizzle-orm";
import type { VoucherAction, VoucherHeaderInput, VoucherSnapshot } from "@/lib/vouchers/types";
import type { Db } from "@/server/db/client";
import { voucherAttachments, voucherHistory, voucherLines, vouchers } from "@/server/db/schema";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

export const AUTO_APPROVE_NOTE = "전표 승인 기능 해제로 자동 승인";

export const header = (input: VoucherHeaderInput): VoucherHeaderInput => ({
  date: input.date,
  entryType: input.entryType,
  description: input.description,
  partnerId: input.partnerId,
  evidenceType: input.evidenceType,
  vatType: input.vatType,
  vatDeductible: input.vatDeductible,
  supplyAmount: input.supplyAmount,
  vatAmount: input.vatAmount,
});

export const lineColumns = {
  accountId: voucherLines.accountId,
  side: voucherLines.side,
  amount: voucherLines.amount,
  partnerId: voucherLines.partnerId,
  siteId: voucherLines.siteId,
  departmentId: voucherLines.departmentId,
  description: voucherLines.description,
};

/** The stored voucher as a history snapshot (null if it does not exist). */
export async function loadSnapshot(tx: Conn, id: string): Promise<VoucherSnapshot | null> {
  const [v] = await tx.select().from(vouchers).where(eq(vouchers.id, id));
  if (!v) return null;
  const lines = await tx
    .select(lineColumns)
    .from(voucherLines)
    .where(eq(voucherLines.voucherId, id))
    .orderBy(asc(voucherLines.lineNo));
  const files = await tx
    .select({ fileName: voucherAttachments.fileName })
    .from(voucherAttachments)
    .where(eq(voucherAttachments.voucherId, id))
    .orderBy(asc(voucherAttachments.createdAt), asc(voucherAttachments.id));
  return { ...header(v), no: v.no, status: v.status, attachments: files.map((f) => f.fileName), lines };
}

export async function addHistory(
  tx: Tx,
  voucherId: string,
  action: VoucherAction,
  userId: string,
  snapshot: VoucherSnapshot,
  note: string | null = null,
) {
  await tx.insert(voucherHistory).values({ voucherId, action, userId, snapshot, note });
}

/** Approves every pending voucher (approval switched off). Call inside the settings transaction. */
export async function approveAllPending(tx: Tx, actorId: string): Promise<void> {
  const rows = await tx
    .update(vouchers)
    .set({
      status: "approved",
      approvedBy: actorId,
      approvedAt: sql`now()`,
      version: sql`${vouchers.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(vouchers.status, "pending"))
    .returning({ id: vouchers.id });
  for (const { id } of rows) {
    await addHistory(tx, id, "approved", actorId, (await loadSnapshot(tx, id))!, AUTO_APPROVE_NOTE);
  }
}
