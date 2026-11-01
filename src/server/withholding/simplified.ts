import { and, asc, eq, gte, lte } from "drizzle-orm";
import { maskRrn, validateRrn } from "@/lib/payroll/rrn";
import { todayInSeoul } from "@/lib/vouchers/dates";
import { buildSimplifiedStatement, workPeriod, type SimplifiedResult } from "@/lib/withholding/simplified";
import type { SessionUserWithMfa } from "@/server/auth/service";
import { getCompany } from "@/server/company/service";
import { decryptSecret } from "@/server/crypto/secret";
import type { Db } from "@/server/db/client";
import type { SheetSpec } from "@/server/exports/xlsx";
import { employees, payrollAudit, payrollRunLines, payrollRuns } from "@/server/db/schema";
import { canManagePayroll, ERR_FORBIDDEN } from "@/server/payroll/items";

export type SimplifiedRow = {
  employeeId: number;
  name: string;
  rrnMasked: string;
  from: string;
  to: string;
  wages: number;
};

type RawRow = { employeeId: number; name: string; rrnEnc: string; hiredOn: string; leftOn: string | null; wages: number };

/** Parses the page / form params; anything invalid falls back to the previous half-year. */
export function parseSimplifiedParams(
  sp: { year?: string | string[]; half?: string | string[] },
  today = todayInSeoul(),
): { year: number; half: 1 | 2 } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const y = one(sp.year);
  const h = one(sp.half);
  const month = Number(today.slice(5, 7));
  const thisYear = Number(today.slice(0, 4));
  // Default: the half-year that just ended (filed in the following month).
  const defaults: { year: number; half: 1 | 2 } = month <= 6 ? { year: thisYear - 1, half: 2 } : { year: thisYear, half: 1 };
  return {
    year: y && /^\d{4}$/.test(y) && Number(y) >= 2000 ? Number(y) : defaults.year,
    half: h === "1" ? 1 : h === "2" ? 2 : defaults.half,
  };
}

/** Confirmed runs whose 귀속월 is in the half, summed per employee (wages = Σ result.taxable). */
async function loadRaw(db: Db, year: number, half: 1 | 2): Promise<RawRow[]> {
  const rows = await db
    .select({
      employeeId: payrollRunLines.employeeId,
      name: employees.name,
      rrnEnc: employees.rrnEnc,
      hiredOn: employees.hiredOn,
      leftOn: employees.leftOn,
      taxable: payrollRunLines.result,
    })
    .from(payrollRuns)
    .innerJoin(payrollRunLines, eq(payrollRunLines.runId, payrollRuns.id))
    .innerJoin(employees, eq(employees.id, payrollRunLines.employeeId))
    .where(
      and(
        eq(payrollRuns.status, "confirmed"),
        gte(payrollRuns.yearMonth, `${year}-${half === 1 ? "01" : "07"}`),
        lte(payrollRuns.yearMonth, `${year}-${half === 1 ? "06" : "12"}`),
      ),
    )
    .orderBy(asc(employees.name), asc(employees.id));
  const byEmployee = new Map<number, RawRow>();
  for (const r of rows) {
    const cur = byEmployee.get(r.employeeId);
    const wages = r.taxable.taxable;
    if (cur) cur.wages += wages;
    else byEmployee.set(r.employeeId, { employeeId: r.employeeId, name: r.name, rrnEnc: r.rrnEnc, hiredOn: r.hiredOn, leftOn: r.leftOn, wages });
  }
  return [...byEmployee.values()];
}

/** Preview rows (masked 주민등록번호 only). Throws MissingEncryptionKeyError when the key is not set. */
export async function loadSimplifiedRows(db: Db, year: number, half: 1 | 2): Promise<SimplifiedRow[]> {
  const raw = await loadRaw(db, year, half);
  return raw.map((r) => {
    const wp = workPeriod(year, half, r.hiredOn, r.leftOn);
    return {
      employeeId: r.employeeId,
      name: r.name,
      rrnMasked: maskRrn(decryptSecret(r.rrnEnc)),
      from: wp?.from ?? r.hiredOn,
      to: wp?.to ?? r.leftOn ?? "",
      wages: r.wages,
    };
  });
}

/** `label` carries its particle (세무서코드를, 홈택스 ID를). */
const missing = (label: string) => `${label} 회사 설정에 입력하세요.`;
const blank = (s: string | null | undefined) => !s || s.trim() === "";

/**
 * Builds the 간이지급명세서 file. The plain 주민등록번호 of each employee (and the typed 대표자 주민등록번호
 * of an individual business) lives only in memory here and inside the returned file; one audit row per
 * included employee is written, and only when the file was produced.
 */
export async function buildSimplifiedDownload(
  db: Db,
  actor: SessionUserWithMfa,
  input: { year: number; half: 1 | 2; ownerRrn?: string },
): Promise<SimplifiedResult> {
  if (!canManagePayroll(actor)) return { ok: false, error: ERR_FORBIDDEN };
  const company = await getCompany(db);

  const checks: [string | null, string][] = [
    [company.name, "회사명(상호)을"],
    [company.businessNumber, "사업자등록번호를"],
    [company.representative, "대표자 성명을"],
    [company.taxOfficeCode, "세무서코드를"],
    [company.hometaxId, "홈택스 ID를"],
    [company.filingContactDept, "담당자 부서를"],
    [company.filingContactName, "담당자 성명을"],
    [company.filingContactPhone, "담당자 전화번호를"],
  ];
  for (const [value, label] of checks) {
    if (blank(value)) return { ok: false, error: missing(label) };
  }

  let registrationNumber: string;
  if (company.businessType === "corporation") {
    if (blank(company.corporateNumber)) return { ok: false, error: missing("법인등록번호를") };
    registrationNumber = company.corporateNumber!;
  } else {
    if (blank(input.ownerRrn)) return { ok: false, error: "대표자 주민등록번호를 입력하세요." };
    const r = validateRrn(input.ownerRrn!);
    if (!r.ok) return { ok: false, error: "대표자 주민등록번호가 올바르지 않습니다." };
    registrationNumber = r.digits;
  }

  const raw = await loadRaw(db, input.year, input.half);
  const result = buildSimplifiedStatement({
    year: input.year,
    half: input.half,
    submittedOn: todayInSeoul(),
    company: {
      name: company.name,
      representative: company.representative!,
      businessNumber: company.businessNumber!,
      taxOfficeCode: company.taxOfficeCode!,
      businessType: company.businessType,
      registrationNumber,
      hometaxId: company.hometaxId!,
      contactDept: company.filingContactDept!,
      contactName: company.filingContactName!,
      contactPhone: company.filingContactPhone!,
    },
    employees: raw.map((r) => ({
      name: r.name,
      rrn: decryptSecret(r.rrnEnc),
      hiredOn: r.hiredOn,
      leftOn: r.leftOn,
      wages: r.wages,
    })),
  });
  if (!result.ok) return result;

  await db.insert(payrollAudit).values(
    raw.map((r) => ({ userId: actor.id, employeeId: r.employeeId, field: "simplified_statement" as const })),
  );
  return result;
}

/** Excel of the preview rows (masked 주민등록번호 only); null when there is nothing to list. */
export function buildSimplifiedSheet(rows: SimplifiedRow[], companyName: string, year: number, half: 1 | 2): SheetSpec | null {
  if (rows.length === 0) return null;
  const label = half === 1 ? "상반기" : "하반기";
  return {
    fileName: `근로소득간이지급명세서_${year}_${label}`,
    title: `${year}년 ${label}`,
    meta: [
      "근로소득 간이지급명세서 (미리보기)",
      companyName,
      "홈택스 검증 전 — 국세청 2021년 상반기 전산매체 레이아웃으로 만든 파일을 위한 미리보기입니다.",
    ],
    columns: [
      { header: "성명", key: "name", width: 16 },
      { header: "주민등록번호", key: "rrn", width: 18 },
      { header: "근무 시작", key: "from", width: 12 },
      { header: "근무 종료", key: "to", width: 12 },
      { header: "지급액(과세)", key: "wages", width: 16, money: true },
    ],
    rows: [
      ...rows.map((r) => ({ name: r.name, rrn: r.rrnMasked, from: r.from, to: r.to, wages: r.wages })),
      { name: "합계", wages: rows.reduce((t, r) => t + r.wages, 0) },
    ],
    emphasis: [rows.length],
  };
}
