import { Readable } from "node:stream";
import { can } from "@/lib/permissions";
import { isIsoDate } from "@/lib/vouchers/dates";
import { verifySession } from "@/server/auth/dal";
import { db } from "@/server/db";
import { buildTaxPackage } from "@/server/exports/package";

/** 세무사 package: a zip of the period's workbooks and evidence files, streamed. */
export async function GET(request: Request) {
  const user = await verifySession();
  if (!can(user.role, "export:tax")) return new Response(null, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new Response(null, { status: 400 });

  const zip = await buildTaxPackage(db, from, to);
  return new Response(Readable.toWeb(zip) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`세무사자료_${from}_${to}.zip`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
