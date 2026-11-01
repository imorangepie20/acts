import { EMPTY_SEMIANNUAL_NOTICE } from "./notices";
import { validateRrn } from "@/lib/payroll/rrn";
import { n, record, x } from "./fixed";

export type SimplifiedInput = {
  year: number;
  half: 1 | 2;
  submittedOn: string; // YYYY-MM-DD
  company: {
    name: string;
    representative: string;
    businessNumber: string;
    taxOfficeCode: string;
    businessType: "corporation" | "individual";
    registrationNumber: string; // 법인등록번호 or 대표자 주민번호
    hometaxId: string;
    contactDept: string;
    contactName: string;
    contactPhone: string;
  };
  employees: { name: string; rrn: string; hiredOn: string; leftOn: string | null; wages: number }[];
};

export type SimplifiedResult =
  | { ok: true; fileName: string; body: Buffer }
  | { ok: false; error: string };

const CRLF = Buffer.from("\r\n", "ascii");
const stripDash = (s: string) => s.replace(/-/g, "").trim();
const compact = (iso: string) => iso.replace(/-/g, "");
const fail = (error: string): SimplifiedResult => ({ ok: false, error });

/** Work period inside the half (ISO dates); null when the employee did not work in it. */
export function workPeriod(
  year: number,
  half: 1 | 2,
  hiredOn: string,
  leftOn: string | null,
): { from: string; to: string } | null {
  const start = half === 1 ? `${year}-01-01` : `${year}-07-01`;
  const end = half === 1 ? `${year}-06-30` : `${year}-12-31`;
  const from = hiredOn > start ? hiredOn : start;
  const to = leftOn !== null && leftOn < end ? leftOn : end;
  return from > to ? null : { from, to };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function buildSimplifiedStatement(input: SimplifiedInput): SimplifiedResult {
  const { year, half, company } = input;
  if (input.employees.length === 0) return fail(EMPTY_SEMIANNUAL_NOTICE);

  const required: [string, string][] = [
    [company.name, "회사명(상호)을"],
    [company.representative, "대표자 성명을"],
    [company.hometaxId, "홈택스 ID를"],
    [company.contactDept, "담당자 부서를"],
    [company.contactName, "담당자 성명을"],
    [company.contactPhone, "담당자 전화번호를"],
  ];
  for (const [value, label] of required) {
    if (value.trim() === "") return fail(`${label} 입력하세요.`);
  }
  if (input.employees.some((e) => e.name.trim() === "")) {
    return fail("성명이 비어 있는 사원이 있습니다.");
  }

  const bizNo = stripDash(company.businessNumber);
  if (!/^\d{10}$/.test(bizNo)) return fail("회사: 사업자등록번호는 10자리 숫자여야 합니다.");
  const regNo = stripDash(company.registrationNumber);
  if (!/^\d{13}$/.test(regNo)) {
    const label = company.businessType === "corporation" ? "법인등록번호" : "대표자 주민등록번호";
    return fail(`회사: ${label}는 13자리 숫자여야 합니다.`);
  }
  const tax = company.taxOfficeCode;
  if (!/^\d{3}$/.test(tax)) return fail("회사: 세무서코드는 3자리 숫자여야 합니다.");

  const people: { name: string; digits: string; from: string; to: string; wages: number }[] = [];
  for (const e of input.employees) {
    const r = validateRrn(e.rrn);
    if (!r.ok) return fail(`${e.name}: 주민등록번호가 올바르지 않습니다.`);
    const wp = workPeriod(year, half, e.hiredOn, e.leftOn);
    if (!wp) return fail(`${e.name}: 근무기간이 해당 반기에 없습니다.`);
    people.push({ name: e.name, digits: r.digits, from: wp.from, to: wp.to, wages: e.wages });
  }
  people.sort((p, q) =>
    p.name !== q.name ? (p.name < q.name ? -1 : 1) : p.digits < q.digits ? -1 : p.digits > q.digits ? 1 : 0,
  );

  const cRecords: Buffer[] = [];
  for (const [i, p] of people.entries()) {
    try {
      cRecords.push(
        record([
          x("C", 1),
          n(77, 2),
          x(tax, 3),
          n(i + 1, 7),
          x(bizNo, 10),
          x(p.digits, 13),
          x(p.name, 30),
          x("", 20), // C8 전화번호: blank
          x("1", 1), // C9 내국인
          x("1", 1), // C10 거주자
          x("", 2), // C11 거주지국코드: blank
          x(compact(p.from), 8),
          x(compact(p.to), 8),
          n(p.wages, 13), // C14
          n(0, 13), // C15 인정상여
          x("", 58),
        ]),
      );
    } catch (e) {
      return fail(`${p.name}: ${message(e)}`);
    }
  }

  const total = people.reduce((s, p) => s + p.wages, 0);
  let a: Buffer;
  let b: Buffer;
  try {
    a = record([
      x("A", 1),
      n(77, 2),
      x(tax, 3),
      n(Number(compact(input.submittedOn)), 8),
      n(company.businessType === "corporation" ? 2 : 3, 1),
      x("", 6),
      x(company.hometaxId, 20),
      x("9000", 4),
      x(bizNo, 10),
      x(company.name, 30),
      x(company.contactDept, 30),
      x(company.contactName, 30),
      x(stripDash(company.contactPhone), 15),
      n(1, 5), // A14 B 레코드 수
      x("", 25),
    ]);
    b = record([
      x("B", 1),
      n(77, 2),
      x(tax, 3),
      n(1, 6),
      x(company.name, 40),
      x(company.representative, 30),
      x(bizNo, 10),
      x(regNo, 13),
      n(year, 4),
      n(half, 1),
      n(people.length, 10),
      n(total, 13), // B12 = ΣC14
      n(0, 13), // B13 = ΣC15
      x("", 44),
    ]);
  } catch (e) {
    return fail(`회사: ${message(e)}`);
  }

  const body = Buffer.concat([a, b, ...cRecords].flatMap((r) => [r, CRLF]));
  return { ok: true, fileName: `SC${bizNo.slice(0, 7)}.${bizNo.slice(7)}`, body };
}
