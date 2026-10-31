import fs from "node:fs/promises";
import type { Readable } from "node:stream";
import archiver from "archiver";
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import { POSTED_STATUSES, formatVoucherNo } from "@/lib/vouchers/types";
import { resolveStored } from "@/server/attachments/storage";
import type { Db } from "@/server/db/client";
import { voucherAttachments, vouchers } from "@/server/db/schema";
import { buildSheetSpec, buildTaxListSpecs } from "./specs";
import { listCardPurchases, listTaxInvoices } from "./tax-lists";
import { renderWorkbook } from "./xlsx";

export type PackageSummary = {
  invoicesSale: { count: number; total: number };
  invoicesPurchase: { count: number; total: number };
  cards: { count: number; total: number };
  attachments: { count: number; bytes: number };
  pending: number;
};

export async function getPackageSummary(db: Db, from: string, to: string): Promise<PackageSummary> {
  const [invoices, cards, [att], [pend]] = await Promise.all([
    listTaxInvoices(db, from, to),
    listCardPurchases(db, from, to),
    db
      .select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${voucherAttachments.size}), 0)::float8` })
      .from(voucherAttachments)
      .innerJoin(vouchers, eq(vouchers.id, voucherAttachments.voucherId))
      .where(and(between(vouchers.date, from, to), inArray(vouchers.status, [...POSTED_STATUSES]))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(vouchers)
      .where(and(between(vouchers.date, from, to), eq(vouchers.status, "pending"))),
  ]);
  const sum = (rows: { total: number }[]) => ({ count: rows.length, total: rows.reduce((a, r) => a + r.total, 0) });
  return {
    invoicesSale: sum(invoices.filter((r) => r.direction === "매출")),
    invoicesPurchase: sum(invoices.filter((r) => r.direction === "매입")),
    cards: { count: cards.length, total: cards.reduce((a, r) => a + r.supplyAmount + r.vatAmount, 0) },
    attachments: { count: att.count, bytes: att.bytes },
    pending: pend.n,
  };
}

/**
 * A file name safe as one zip entry segment: path separators, Windows-reserved and control characters
 * become `_`. A leftover `..` is harmless because every entry name is `<no>_<n>_<safeName>`, never a bare segment.
 */
export function safeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "_").slice(0, 100);
}

/** Zip of the period's workbooks and the posted vouchers' evidence files, streamed as it is built. */
export async function buildTaxPackage(db: Db, from: string, to: string): Promise<Readable> {
  const zip = archiver("zip", { zlib: { level: 1 } });
  void fill(zip, db, from, to).catch((e) => zip.destroy(e instanceof Error ? e : new Error(String(e))));
  return zip;
}

/** Appends and waits until archiver has written the entry, so the queue never holds more than one file. */
function appendEntry(zip: archiver.Archiver, data: Buffer, entry: archiver.ZipEntryData): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      zip.off("entry", done);
      zip.off("close", done);
      zip.off("error", done);
      resolve();
    };
    zip.on("entry", done);
    zip.on("close", done);
    zip.on("error", done);
    zip.append(data, entry);
  });
}

async function fill(zip: archiver.Archiver, db: Db, from: string, to: string): Promise<void> {
  // The 세무사's journal never lists payroll vouchers (their lines name the pay); the trial balance keeps the totals.
  const journal = await buildSheetSpec(db, "journal", { from, to }, { hidePayroll: true });
  const tb = await buildSheetSpec(db, "trial-balance", { from, to }, { hidePayroll: false });
  if (!journal || !tb) throw new Error("report spec missing");
  zip.append(await renderWorkbook([journal]), { name: "분개장.xlsx" });
  zip.append(await renderWorkbook([tb]), { name: "합계잔액시산표.xlsx" });
  zip.append(await renderWorkbook(await buildTaxListSpecs(db, "tax-invoices", from, to)), { name: "세금계산서.xlsx" });
  zip.append(await renderWorkbook(await buildTaxListSpecs(db, "card-purchases", from, to)), {
    name: "카드·현금영수증 매입.xlsx",
  });

  const rows = await db
    .select({
      date: vouchers.date,
      no: vouchers.no,
      fileName: voucherAttachments.fileName,
      storagePath: voucherAttachments.storagePath,
    })
    .from(voucherAttachments)
    .innerJoin(vouchers, eq(vouchers.id, voucherAttachments.voucherId))
    .where(and(between(vouchers.date, from, to), inArray(vouchers.status, [...POSTED_STATUSES])))
    .orderBy(asc(vouchers.date), asc(vouchers.no), asc(voucherAttachments.createdAt), asc(voucherAttachments.id));

  const missing: string[] = [];
  const seq = new Map<string, number>();
  for (const r of rows) {
    if (zip.destroyed) return; // the client went away
    const no = formatVoucherNo(r.date, r.no);
    const n = (seq.get(no) ?? 0) + 1;
    seq.set(no, n);
    const abs = resolveStored(r.storagePath);
    // One file at a time (<= 10MB each): no open descriptors or read streams pile up, and a read
    // failure of any kind (missing, unreadable, a directory) lands in the missing list.
    const bytes = abs ? await fs.readFile(abs).catch(() => null) : null;
    if (!bytes) {
      missing.push(`${no} ${r.fileName}`);
      continue;
    }
    // Images and PDFs are already compressed: store them as they are.
    await appendEntry(zip, bytes, { name: `증빙/${no}_${n}_${safeFileName(r.fileName)}`, store: true });
  }
  if (missing.length > 0) zip.append(missing.join("\n") + "\n", { name: "누락된 증빙.txt" });
  await zip.finalize();
}
