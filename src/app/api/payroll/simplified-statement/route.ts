import { requirePermission } from "@/server/auth/dal";
import { encryptionKeyMessage } from "@/server/auth/mfa";
import { MissingEncryptionKeyError } from "@/server/crypto/secret";
import { db } from "@/server/db";
import { buildSimplifiedDownload, parseSimplifiedParams } from "@/server/withholding/simplified";

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });

/**
 * 간이지급명세서 file. POST so the typed 대표자 주민등록번호 (individual businesses) never appears in a URL;
 * it is used for this one response and not stored or logged.
 */
export async function POST(request: Request) {
  const user = await requirePermission("payroll:manage");
  const form = await request.formData();
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const { year, half } = parseSimplifiedParams({ year: field("year"), half: field("half") });
  const ownerRrn = field("ownerRrn")?.trim();

  try {
    const r = await buildSimplifiedDownload(db, user, { year, half, ownerRrn: ownerRrn || undefined });
    if (!r.ok) return text(r.error, 400);
    return new Response(new Uint8Array(r.body), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(r.body.length),
        "Content-Disposition": `attachment; filename="${r.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof MissingEncryptionKeyError) return text(encryptionKeyMessage(e), 500);
    throw e;
  }
}
