import { can, hidesPayroll } from "@/lib/permissions";
import { isIsoDate } from "@/lib/vouchers/dates";
import { verifySession } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  buildSheetSpec,
  buildTaxListSpecs,
  exportPermission,
  PAYROLL_RUN_KEY,
  REPORT_KEYS,
  TAX_LIST_KEYS,
  type ReportKey,
  type TaxListKey,
} from "@/server/exports/specs";
import { renderWorkbook } from "@/server/exports/xlsx";
import { getCompany } from "@/server/company/service";
import { buildPayrollLedgerSheet } from "@/server/payroll/ledger-sheet";
import { getRun } from "@/server/payroll/runs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xlsxResponse(body: Buffer, fileName: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.xlsx`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Excel download of one report, built from the same filters as its page. The 1C reports need `ledger:view`;
 * the tax lists (`tax-invoices`, `card-purchases`) need `export:tax` and take `from`/`to` only;
 * `payroll-run` (the 급여 대장, masked 주민등록번호 only) needs `payroll:manage` and takes `run`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await verifySession();
  const { report } = await params;
  if (!can(user.role, exportPermission(report))) return new Response(null, { status: 403 });
  const sp: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) if (!(k in sp)) sp[k] = v;

  if (report === PAYROLL_RUN_KEY) {
    const run = sp.run ? await getRun(db, sp.run) : null;
    if (!run) return new Response(null, { status: 404 });
    const spec = buildPayrollLedgerSheet(run, (await getCompany(db)).name);
    return xlsxResponse(await renderWorkbook([spec]), spec.fileName);
  }

  const isTax = (TAX_LIST_KEYS as readonly string[]).includes(report);
  if (!isTax && !(REPORT_KEYS as readonly string[]).includes(report)) return new Response(null, { status: 404 });

  if (isTax) {
    const { from, to } = sp;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new Response(null, { status: 400 });
    const specs = await buildTaxListSpecs(db, report as TaxListKey, from, to);
    return xlsxResponse(await renderWorkbook(specs), specs[0].fileName);
  }

  const spec = await buildSheetSpec(db, report as ReportKey, sp, { hidePayroll: hidesPayroll(user.role) });
  if (!spec) return new Response(null, { status: 404 });
  return xlsxResponse(await renderWorkbook([spec]), spec.fileName);
}
