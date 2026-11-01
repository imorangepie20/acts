import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { seed } from "../../../scripts/seed";
import type { SessionUser } from "@/server/auth/service";
import { users } from "@/server/db/schema";
import { getTestDb, resetDb } from "../../../tests/helpers/db";
import { createPayrollVoucher } from "../../../tests/helpers/payroll";
import { buildReturnSheets } from "./return-sheet";
import { loadReturnView, parseReturnParams } from "./return-view";

const db = getTestDb();
let admin: SessionUser;

beforeEach(async () => {
  await resetDb(db);
  await seed(db, { email: "admin@acts.kr", password: "pw-12345678" });
  const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@acts.kr"));
  admin = { id: a.id, email: "admin@acts.kr", name: "관리자", role: "admin" };
});

it("parses params and falls back to defaults on bad input", () => {
  const d = { semiannual: false, payMonth: "2026-08" };
  expect(parseReturnParams({}, d)).toEqual({ mode: "monthly", pay: "2026-08", attr: null, refund: 0 });
  expect(parseReturnParams({ pay: "2026-13", attr: "x", refund: "-5" }, d)).toEqual({
    mode: "monthly",
    pay: "2026-08",
    attr: null,
    refund: 0,
  });
  expect(parseReturnParams({}, { ...d, semiannual: true })).toEqual({ mode: "semiannual", year: 2026, half: 2, refund: 0 });
  expect(parseReturnParams({ mode: "semiannual", year: "2025", half: "1", refund: "1000" }, d)).toEqual({
    mode: "semiannual",
    year: 2025,
    half: 1,
    refund: 1000,
  });
});

it("one form per 귀속월 paid in the 지급월; attr narrows; default is the latest confirmed month", async () => {
  await createPayrollVoucher(db, admin, { yearMonth: "2026-06", payDate: "2026-07-10" });
  const v = await loadReturnView(db, {});
  expect(v.selection).toMatchObject({ mode: "monthly", pay: "2026-07", attr: null });
  expect(v.forms.map((f) => [f.attributionMonth, f.paymentMonth])).toEqual([["2026-06", "2026-07"]]);
  expect(v.forms[0].a01.people).toBe(1);
  const other = await loadReturnView(db, { pay: "2026-07", attr: "2026-05" });
  expect(other.forms[0].a01).toEqual({ people: 0, totalPaid: 0, incomeTax: 0 });
  const empty = await loadReturnView(db, { pay: "2026-09" });
  expect(empty.forms).toEqual([]);
  expect(buildReturnSheets(empty)).toBeNull();
});

it("semiannual covers the half and the sheet has A01/A10/A99 and the refund block", async () => {
  await createPayrollVoucher(db, admin, { yearMonth: "2026-06", payDate: "2026-06-25" });
  const v = await loadReturnView(db, { mode: "semiannual", year: "2026", half: "1", refund: "100" });
  expect(v.forms[0].a01.people).toBe(1);
  expect(v.forms[0].refund.carriedIn).toBe(100);
  const { fileName, sheets } = buildReturnSheets(v)!;
  expect(fileName).toBe("원천징수이행상황신고서_2026_상반기");
  expect(sheets[0].rows.map((r) => r.code ?? r.label)).toEqual([
    "A01",
    "A10",
    "A99",
    "환급세액 조정",
    "⑫ 전월 미환급세액",
    "⑲ 당월조정 환급세액계",
    "⑳ 차월이월 환급세액",
    "지방소득세(위택스 신고용)",
  ]);
});
