import { can } from "@/lib/permissions";
import { verifySession } from "@/server/auth/dal";
import { db } from "@/server/db";
import { buildSheetSpec, REPORT_KEYS, type ReportKey } from "@/server/exports/specs";
import { renderXlsx } from "@/server/exports/xlsx";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Excel download of one report, built from the same filters as its page. Needs `ledger:view`. */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await verifySession();
  if (!can(user.role, "ledger:view")) return new Response(null, { status: 403 });
  const { report } = await params;
  if (!(REPORT_KEYS as readonly string[]).includes(report)) return new Response(null, { status: 404 });

  const sp: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) if (!(k in sp)) sp[k] = v;
  const spec = await buildSheetSpec(db, report as ReportKey, sp);
  if (!spec) return new Response(null, { status: 404 });

  const body = await renderXlsx(spec);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(spec.fileName)}.xlsx`,
      "Cache-Control": "private, no-store",
    },
  });
}
