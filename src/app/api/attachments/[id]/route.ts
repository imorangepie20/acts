import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { can, hidesPayroll } from "@/lib/permissions";
import { getAttachmentFile } from "@/server/attachments/service";
import { verifySession } from "@/server/auth/dal";
import { db } from "@/server/db";

/** Streams an evidence file to a logged-in user with `ledger:view` (a payroll voucher's only with `payroll:manage`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!can(user.role, "ledger:view")) return new Response(null, { status: 403 });
  const { id } = await params;
  const file = await getAttachmentFile(db, id, { hidePayroll: hidesPayroll(user.role) });
  if (!file) return new Response(null, { status: 404 });

  let size: number;
  try {
    const s = await stat(file.absolutePath);
    if (!s.isFile()) return new Response(null, { status: 404 });
    size = s.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const body = Readable.toWeb(createReadStream(file.absolutePath)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
