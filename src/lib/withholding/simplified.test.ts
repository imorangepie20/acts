import iconv from "iconv-lite";
import { EMPTY_SEMIANNUAL_NOTICE } from "./notices";
import { describe, expect, it } from "vitest";
import { buildSimplifiedStatement, workPeriod, type SimplifiedInput } from "./simplified";

const base: SimplifiedInput = {
  year: 2026,
  half: 1,
  submittedOn: "2026-07-05",
  company: {
    name: "주식회사 에이씨티에스",
    representative: "홍길동",
    businessNumber: "123-45-67890",
    taxOfficeCode: "123",
    businessType: "corporation",
    registrationNumber: "110111-1234567",
    hometaxId: "actsco",
    contactDept: "경영지원",
    contactName: "김담당",
    contactPhone: "02-123-4567",
  },
  employees: [
    { name: "홍길동", rrn: "900101-1234568", hiredOn: "2020-01-01", leftOn: null, wages: 1000 },
    { name: "가나다", rrn: "850505-2345674", hiredOn: "2026-03-15", leftOn: null, wages: 2500 },
  ],
};

function records(body: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < body.length; i += 192) out.push(body.subarray(i, i + 192));
  return out;
}
const dec = (b: Buffer) => iconv.decode(b, "euc-kr");
const asc = (b: Buffer) => b.toString("ascii");

describe("buildSimplifiedStatement", () => {
  const r = buildSimplifiedStatement(base);
  if (!r.ok) throw new Error(r.error);
  const recs = records(r.body);
  const [a, b, c1, c2] = recs;

  it("builds A, B, C, C with CRLF after each", () => {
    expect(r.body.length).toBe(4 * 192);
    expect(recs.map((l) => String.fromCharCode(l[0]))).toEqual(["A", "B", "C", "C"]);
    for (const l of recs) expect(asc(l.subarray(190))).toBe("\r\n");
  });

  it("fills A fields at documented positions", () => {
    expect(asc(a.subarray(1, 3))).toBe("77");
    expect(asc(a.subarray(3, 6))).toBe("123"); // A3
    expect(asc(a.subarray(6, 14))).toBe("20260705"); // A4
    expect(asc(a.subarray(14, 15))).toBe("2"); // A5
    expect(asc(a.subarray(41, 45))).toBe("9000"); // A8
    expect(asc(a.subarray(45, 55))).toBe("1234567890"); // A9
    expect(dec(a.subarray(55, 85)).trim()).toBe("주식회사 에이씨티에스"); // A10
    expect(asc(a.subarray(145, 160)).trim()).toBe("021234567"); // A13
    expect(asc(a.subarray(160, 165))).toBe("00001"); // A14
  });

  it("fills B fields at documented positions", () => {
    expect(asc(b.subarray(3, 6))).toBe("123"); // B3
    expect(asc(b.subarray(6, 12))).toBe("000001"); // B4
    expect(asc(b.subarray(92, 105))).toBe("1101111234567"); // B8
    expect(asc(b.subarray(105, 109))).toBe("2026"); // B9, ends 109
    expect(asc(b.subarray(109, 110))).toBe("1"); // B10
    expect(asc(b.subarray(110, 120))).toBe("0000000002"); // B11
    expect(asc(b.subarray(120, 133))).toBe("0000000003500"); // B12, ends 133
    expect(asc(b.subarray(133, 146))).toBe("0000000000000"); // B13
  });

  it("sorts by name, numbers C from 1, and fills C fields at positions", () => {
    expect(asc(c1.subarray(6, 13))).toBe("0000001");
    expect(asc(c2.subarray(6, 13))).toBe("0000002");
    expect(dec(c1.subarray(36, 66)).trim()).toBe("가나다"); // C7
    expect(asc(c1.subarray(23, 36))).toBe("8505052345674"); // C6, bytes 24-36
    expect(asc(c1.subarray(13, 23))).toBe(asc(b.subarray(82, 92))); // C5 = B7
    expect(c1.subarray(3, 6)).toEqual(b.subarray(3, 6)); // C3 = B3
    expect(asc(c1.subarray(86, 88))).toBe("11"); // C9, C10
    expect(asc(c1.subarray(88, 90))).toBe("  "); // C11
    expect(asc(c1.subarray(90, 98))).toBe("20260315"); // C12
    expect(asc(c1.subarray(98, 106))).toBe("20260630"); // C13
    expect(asc(c1.subarray(106, 119))).toBe("0000000002500"); // C14, bytes 107-119
    expect(asc(c1.subarray(119, 132))).toBe("0000000000000"); // C15
  });

  it("names the file from the business number", () => {
    expect(r.fileName).toBe("SC1234567.890");
  });

  it("uses 3 for an individual business", () => {
    const i = buildSimplifiedStatement({
      ...base,
      company: { ...base.company, businessType: "individual", registrationNumber: "7001011234561" },
    });
    if (!i.ok) throw new Error(i.error);
    expect(asc(i.body.subarray(14, 15))).toBe("3");
  });
});

describe("workPeriod", () => {
  it("clips to the half", () => {
    expect(workPeriod(2026, 1, "2026-03-15", null)).toEqual({ from: "2026-03-15", to: "2026-06-30" });
    expect(workPeriod(2026, 2, "2020-01-01", "2026-09-10")).toEqual({
      from: "2026-07-01",
      to: "2026-09-10",
    });
  });
  it("is null without overlap", () => {
    expect(workPeriod(2026, 1, "2026-07-01", null)).toBeNull();
    expect(workPeriod(2026, 2, "2020-01-01", "2026-06-30")).toBeNull();
  });
});

describe("errors", () => {
  const err = (i: SimplifiedInput) => {
    const res = buildSimplifiedStatement(i);
    if (res.ok) throw new Error("expected error");
    return res.error;
  };
  it("rejects an employee outside the half", () => {
    expect(err({ ...base, employees: [{ ...base.employees[0], hiredOn: "2026-08-01" }] })).toBe(
      "홍길동: 근무기간이 해당 반기에 없습니다.",
    );
  });
  it("rejects an invalid RRN naming the employee", () => {
    expect(err({ ...base, employees: [{ ...base.employees[0], rrn: "123" }] })).toMatch(/^홍길동:/);
  });
  it("rejects an empty list", () => {
    expect(err({ ...base, employees: [] })).toBe(EMPTY_SEMIANNUAL_NOTICE);
  });
  it("returns, not throws, for unencodable characters", () => {
    expect(err({ ...base, employees: [{ ...base.employees[0], name: "홍\u{1F600}" }] })).toMatch(/^홍.*:/);
    expect(err({ ...base, company: { ...base.company, name: "A\u{1F600}" } })).toMatch(/^회사:/);
  });
  it("rejects a blank employee name", () => {
    expect(err({ ...base, employees: [{ ...base.employees[0], name: "  " }] })).toBe(
      "성명이 비어 있는 사원이 있습니다.",
    );
  });
  it("rejects blank required company fields", () => {
    expect(err({ ...base, company: { ...base.company, hometaxId: " " } })).toBe("홈택스 ID를 입력하세요.");
    expect(err({ ...base, company: { ...base.company, contactPhone: "" } })).toMatch(/전화번호/);
  });
  it("validates company numbers", () => {
    expect(err({ ...base, company: { ...base.company, businessNumber: "123" } })).toMatch(/사업자등록번호/);
    expect(err({ ...base, company: { ...base.company, registrationNumber: "1" } })).toMatch(/법인등록번호/);
  });
});
