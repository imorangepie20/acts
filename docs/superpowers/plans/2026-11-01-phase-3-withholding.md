# Phase 3 원천세 신고 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 원천징수이행상황신고서 screen to copy into 홈택스, and a downloadable 근로소득 간이지급명세서 fixed-length file, both built from confirmed payroll runs.

**Architecture:** Pure builders in `src/lib/withholding/` (return figures, fixed-length records) fed by thin query functions in `src/server/withholding/`. Pages under `/payroll/withholding` and `/payroll/simplified-statement`; the file comes from a POST route that decrypts 주민등록번호 and writes audit rows.

**Tech Stack:** Next.js 16 App Router, Drizzle/Postgres, Vitest (real `acts_test` DB), Playwright, exceljs (`src/server/exports/xlsx.ts`), `iconv-lite` for EUC-KR.

**Spec:** `docs/superpowers/specs/2026-11-01-phase-3-withholding-design.md` — its appendix holds the A/B/C record tables; it is the authority for every field position.

## Global Constraints

- Both screens and the file route require `payroll:manage` (`requirePermission("payroll:manage")`); 2FA already applies.
- "홈택스 검증 전" appears on the 간이지급명세서 page and in its download dialog. Never word the file as verified.
- Rows acts cannot compute show the text `이 프로그램에서 계산하지 않음`.
- Every record is exactly 190 bytes in EUC-KR, followed by CRLF. X fields left-aligned, space-padded; 9 fields right-aligned, zero-padded, no sign.
- Hangul is truncated on a character boundary (never split a 2-byte character).
- File name: `SC` + 사업자등록번호 digits 1–7 + `.` + digits 8–10.
- `A8` = `9000`, `A2`/`B2`/`C2` = `77`, `A6` blank, `C8` blank, `C9` = `1`, `C10` = `1`, `C11` blank, `C15` = 0.
- Plain 주민등록번호 exists only inside the downloaded file; the preview shows `maskRrn` forms.
- A 대표자 주민등록번호 typed for an individual business is never stored or logged.
- Seed: `payroll_items.exclude_from_total_paid` = `true` for `car`, `false` for every other built-in item (law.go.kr, 시행령 제214조①2의3 → 시행령 제12조제3호).
- Korean UI copy; follow existing payroll pages' structure (thin `page.tsx`, components in `src/components/payroll/`).

## Review Focus

1. A 2-byte Hangul name longer than the field (C7 X(30) = 15 Hangul) → truncated to 15 characters, record still 190 bytes. Test in Task 5.
2. An employee hired or leaving mid-half → C12/C13 clamp to the employment dates, and a run whose line is for an employee with no overlap cannot happen with 귀속 basis but must be refused with a named error if it does. Test in Task 5.
3. A month with both a 정기 run and a 상여 run for an earlier 귀속월, paid the same month → two 귀속/지급 pairs on the 신고서, not one merged form. Test in Task 3.
4. ⑫ 전월미환급세액 larger than ⑥ → ⑨ = ⑥, ⑩ = 0, ⑳ = the rest. Test in Task 2.
5. Company fields missing (세무서코드, 홈택스 ID, 담당자, 법인등록번호 for a corporation) → download refused with a message naming the missing field and linking to the company settings. Test in Task 6.

---

### Task 1: Settings data — company filing fields, item flag, line field

**Files:**
- Modify: `src/server/db/schema.ts` (`company`, `payrollItems`, `payrollAuditField`)
- Create: migration via `pnpm drizzle-kit generate` (next number after 0017)
- Modify: `src/server/company/service.ts`, `src/app/(dashboard)/admin/company/actions.ts`, `src/components/admin/company-form.tsx`
- Modify: `src/server/payroll/items.ts`, `src/components/payroll/settings/pay-items-table.tsx`, `src/app/(dashboard)/payroll/settings/actions.ts`
- Modify: `scripts/seed.ts` (item seed rows), `src/lib/payroll/types.ts` (`ItemDef`, `LineResult`), `src/lib/payroll/calc.ts`
- Test: `src/server/company/service.test.ts` (create or extend), `src/lib/payroll/calc.test.ts`, `src/server/seed.test.ts`

**Interfaces:**
- Produces: `company` columns `taxOfficeCode text`, `businessType text check in ('corporation','individual') default 'corporation'`, `corporateNumber text`, `withholdingSemiannual boolean default false`, `hometaxId text`, `filingContactDept text`, `filingContactName text`, `filingContactPhone text` (all nullable except the two with defaults). `Company` type gains the same camelCase fields.
- Produces: `payroll_items.exclude_from_total_paid boolean not null default false`; `ItemDef.excludeFromTotalPaid: boolean`; `PayItemRow.excludeFromTotalPaid`.
- Produces: `payrollAuditField` enum gains `"simplified_statement"`.
- Produces: `splitTaxable(...)` also returns `excludedNontaxable: number`; `LineResult.excludedNontaxable?: number` (optional — lines computed before this phase lack it), set by `computeLine`.

- [ ] **Step 1: Failing tests**
  - `calc.test.ts` › `splitTaxable reports excluded 비과세`: items meal (taxable false, limit 200,000, exclude false) and car (taxable false, limit 200,000, exclude true), amounts meal 250,000, car 300,000 → `nontaxable` 400,000, `excludedNontaxable` 200,000, `taxable` 150,000.
  - `calc.test.ts` › `computeLine carries excludedNontaxable` into `LineResult`.
  - `service.test.ts` › filing fields are optional and checked for format only when non-empty (presence is checked at download time, Task 6): `taxOfficeCode` `"12"` or `"12a"` → `세무서코드는 숫자 3자리입니다.`; `corporateNumber` `"123"` → `법인등록번호는 숫자 13자리입니다.`; all empty → ok.
  - `seed.test.ts` › `seeds car as excluded from 총지급액, meal not`.
- [ ] **Step 2:** `pnpm test src/lib/payroll/calc.test.ts src/server/company src/server/seed.test.ts` → FAIL.
- [ ] **Step 3:** Implement schema + migration, `splitTaxable`/`computeLine`, company service validation (digits only after stripping `-`), seed (`excludeFromTotalPaid: true` for `car` in the seed rows, for new databases) and, in the migration, a one-off `update payroll_items set exclude_from_total_paid = true where code = 'car'` for existing databases (the seed must not overwrite a user's later edit).
- [ ] **Step 4:** UI — company form gets a "원천세 신고 정보" section (세무서코드, 사업자 유형 select 법인/개인, 법인등록번호, 반기별 납부 switch, 홈택스 ID, 담당자 부서/성명/전화번호); pay-items table gets a "총지급액 제외" switch column with help text `지급명세서 제출 면제 비과세(소득세법 시행령 제214조)`. The item loaders that build `ItemDef` in `src/server/payroll/runs.ts` select the new column.
- [ ] **Step 5:** `pnpm test` (all) → PASS; `pnpm lint` → 0 errors.
- [ ] **Step 6:** Commit `feat(withholding): company filing fields, 총지급액 exclusion flag on pay items`.

### Task 2: Pure 신고서 builder

**Files:**
- Create: `src/lib/withholding/return.ts`, `src/lib/withholding/return.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReturnRunInput = {
    yearMonth: string;            // 귀속 YYYY-MM
    payDate: string;              // YYYY-MM-DD
    lines: { employeeId: number; gross: number; excludedNontaxable: number; incomeTax: number; localTax: number }[];
  };
  export type ReturnPeriod =
    | { mode: "monthly"; attributionMonth: string; paymentMonth: string }
    | { mode: "semiannual"; year: number; half: 1 | 2 };
  export type ReturnFigures = {
    attributionMonth: string;     // ② 귀속연월
    paymentMonth: string;         // ③ 지급연월
    a01: { people: number; totalPaid: number; incomeTax: number };
    a10: { people: number; totalPaid: number; incomeTax: number };
    a99: { people: number; totalPaid: number; incomeTax: number };
    refund: { carriedIn: number; adjusted: number; payable: number; carriedOut: number }; // ⑫, ⑨(=⑲), ⑩, ⑳
    localTax: number;
  };
  export function buildReturn(period: ReturnPeriod, runs: ReturnRunInput[], carriedInRefund: number): ReturnFigures;
  export function returnPairs(runs: Pick<ReturnRunInput, "yearMonth" | "payDate">[]): { attributionMonth: string; paymentMonth: string }[];
  ```
- Rules (from the spec): monthly filters runs with `yearMonth === attributionMonth` and pay month `=== paymentMonth`. Semiannual takes runs paid in the half; ② = half's first month, ③ = last month; A01 people = distinct employees in runs **paid in the half's last month** (0 if none). Monthly people = distinct employees across the filtered runs. totalPaid = Σ(gross − excludedNontaxable). A10 = A99 = A01. Refund: `adjusted = min(carriedIn, incomeTax)`, `payable = incomeTax − adjusted`, `carriedOut = carriedIn − adjusted`. `returnPairs` returns distinct pairs sorted by paymentMonth then attributionMonth.

- [ ] **Step 1: Failing tests** — one per rule: monthly filter; two pairs in one 지급월 (Review Focus 3: 정기 2026-03 paid 2026-03-25 and 상여 귀속 2026-02 paid 2026-03-25 → `returnPairs` gives `[{2026-02,2026-03},{2026-03,2026-03}]`); semiannual headcount uses June; totalPaid excludes `excludedNontaxable`; refund larger than tax (Review Focus 4: carriedIn 500,000, tax 300,000 → adjusted 300,000, payable 0, carriedOut 200,000); negative or non-integer `carriedInRefund` throws.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(withholding): 원천징수이행상황신고서 figures builder`.

### Task 3: 신고서 queries, page, print, Excel

**Files:**
- Create: `src/server/withholding/return.ts`, `src/server/withholding/return.test.ts`
- Create: `src/app/(dashboard)/payroll/withholding/page.tsx`, `src/components/payroll/withholding/return-form.tsx` (the form layout), `src/components/payroll/withholding/period-picker.tsx`
- Modify: `src/lib/nav.ts` (+ `src/lib/nav.test.ts`), `src/app/api/exports/[report]/route.ts` + `src/server/exports/specs.ts` (new key `withholding-return`, `payroll:manage`)

**Interfaces:**
- Consumes: `buildReturn`, `returnPairs` (Task 2); `LineResult.excludedNontaxable`, `ItemDef.excludeFromTotalPaid` (Task 1).
- Produces: `loadReturnRuns(db, range: { payFrom: string; payTo: string }): Promise<ReturnRunInput[]>` — confirmed runs only; for a line without `excludedNontaxable`, recompute it with `splitTaxable(currentItems, line.amounts).excludedNontaxable`.
- URL params: `mode=monthly&attr=YYYY-MM&pay=YYYY-MM` or `mode=semiannual&year=YYYY&half=1|2`, plus `refund=<원>` for ⑫. Default mode from `company.withholdingSemiannual`; default period = the last month with a confirmed run.

- [ ] **Step 1: Failing tests** (`return.test.ts`, real DB via `tests/helpers/payroll.ts`): draft runs are ignored; confirmed run line without `excludedNontaxable` gets it recomputed from current items; `loadReturnRuns` range is inclusive on pay dates.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Page: period picker; for monthly, a list of the pairs in the chosen 지급월 (Review Focus 3) each rendered as a form; the form shows the A01/A02/A03/A04/A05/A06/A10 rows of 근로소득, A20-group, A25-group, A40-group, A50/A60/A69/A70/A80/A90 rows and A99, with codes as in 별지 제21호서식 page 1; uncomputed rows show `이 프로그램에서 계산하지 않음`; ⑫ input (number); 지방소득세 total under the form labelled `지방소득세(위택스 신고용)`. A print button using the existing `PrintButton`. Excel: one sheet with the computed rows (A01, A10, A99) and the refund block.
- [ ] **Step 6:** Nav item `{ title: "원천세 신고", href: "/payroll/withholding", permission: "payroll:manage" }` under 급여; update `nav.test.ts`.
- [ ] **Step 7:** `pnpm test`, `pnpm lint` → pass. Commit `feat(withholding): 원천징수이행상황신고서 screen, print and Excel`.

### Task 4: Fixed-length record encoder

**Files:**
- Create: `src/lib/withholding/fixed.ts`, `src/lib/withholding/fixed.test.ts`
- Modify: `package.json` (add `iconv-lite` `^0.7.2` as a direct dependency — already in the lockfile transitively)

**Interfaces:**
- Produces: `x(value: string, len: number): Buffer` (EUC-KR, left, space-pad, truncate on char boundary), `n(value: number, len: number): Buffer` (throws on negative, non-integer, or overflow), `record(parts: Buffer[]): Buffer` (throws unless total is 190 bytes).

- [ ] **Step 1: Failing tests:** `x("홍길동", 30)` is 30 bytes starting `0xC8 0xAB`; a 16-Hangul name in X(30) keeps 15 characters and pads 0 bytes (Review Focus 1); `"A" + "가"×15` in X(30) keeps `"A"` + 14 Hangul and one trailing space (29 + 1 bytes, the 15th Hangul would not fit); `n(123456, 13)` = `"0000000123456"`; `n(-1, 13)` throws; `n(10**13, 13)` throws; `record` with 189 bytes throws.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(withholding): EUC-KR fixed-length field encoder`.

### Task 5: 간이지급명세서 builder

**Files:**
- Create: `src/lib/withholding/simplified.ts`, `src/lib/withholding/simplified.test.ts`

**Interfaces:**
- Consumes: `x`, `n`, `record` (Task 4).
- Produces:
  ```ts
  export type SimplifiedInput = {
    year: number; half: 1 | 2; submittedOn: string; // YYYY-MM-DD
    company: { name: string; representative: string; businessNumber: string; taxOfficeCode: string;
               businessType: "corporation" | "individual"; registrationNumber: string; // 법인등록번호 or 대표자 주민번호
               hometaxId: string; contactDept: string; contactName: string; contactPhone: string };
    employees: { name: string; rrn: string; hiredOn: string; leftOn: string | null; wages: number }[];
  };
  export type SimplifiedResult = { ok: true; fileName: string; body: Buffer } | { ok: false; error: string };
  export function buildSimplifiedStatement(input: SimplifiedInput): SimplifiedResult;
  export function workPeriod(year: number, half: 1 | 2, hiredOn: string, leftOn: string | null): { from: string; to: string } | null;
  ```
- Field values exactly per the spec appendix. Employees sorted by name then RRN; C4 numbering from 1. `wages` = C14.

- [ ] **Step 1: Failing tests:**
  - full file for 2 employees: length = 4 × 192, records start `A`,`B`,`C`,`C`, each ends `\r\n`; A14 = `00001`; B11 = 2; B12 = sum; B9 = year; B10 = half; C3 = B3; C5 = B7; A8 = `9000`; A5 = `2` for corporation, `3` for individual.
  - `fileName` for `1234567890` → `SC1234567.890`.
  - `workPeriod(2026, 1, "2026-03-15", null)` → `2026-03-15..2026-06-30`; `(2026, 2, "2020-01-01", "2026-09-10")` → `2026-07-01..2026-09-10`; no overlap → `null` (Review Focus 2).
  - an employee whose `workPeriod` is `null` → `{ ok: false, error: "<이름>: 근무기간이 해당 반기에 없습니다." }`.
  - invalid RRN (`validateRrn` fails) → error names the employee; empty employee list → `해당 반기에 확정된 급여가 없습니다.`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(withholding): 근로소득 간이지급명세서 file builder`.

### Task 6: 간이지급명세서 page and download route

**Files:**
- Create: `src/server/withholding/simplified.ts`, `src/server/withholding/simplified.test.ts`
- Create: `src/app/(dashboard)/payroll/simplified-statement/page.tsx`, `src/components/payroll/withholding/simplified-preview.tsx`, `src/components/payroll/withholding/download-dialog.tsx`
- Create: `src/app/api/payroll/simplified-statement/route.ts` (POST)
- Modify: `src/lib/nav.ts`, `src/lib/nav.test.ts`, `src/app/api/exports/[report]/route.ts` + `specs.ts` (key `simplified-statement`, masked RRN Excel)

**Interfaces:**
- Consumes: `buildSimplifiedStatement`, `workPeriod` (Task 5); `getCompany`; `decryptSecret`; `maskRrn`.
- Produces: `loadSimplifiedRows(db, year, half): Promise<{ employeeId: number; name: string; rrnMasked: string; from: string; to: string; wages: number }[]>` (confirmed runs whose `yearMonth` is in the half; wages = Σ `result.taxable`); `buildSimplifiedDownload(db, actor, { year, half, ownerRrn? }): Promise<SimplifiedResult>` which checks company fields, decrypts RRNs, builds the file and inserts one `payroll_audit` row (`field = 'simplified_statement'`) per included employee in the same call.
- Route: POST form body `year`, `half`, `ownerRrn` (individual only); `requirePermission("payroll:manage")`; returns `application/octet-stream` with `Content-Disposition: attachment; filename="SC1234567.890"`, `Cache-Control: private, no-store`; on `{ ok: false }` returns 400 with the Korean error as text.

- [ ] **Step 1: Failing tests** (`simplified.test.ts`): missing 세무서코드 → `세무서코드를 회사 설정에 입력하세요.`; missing 홈택스 ID / 담당자 → same pattern naming the field (Review Focus 5); corporation without 법인등록번호 → `법인등록번호를 회사 설정에 입력하세요.`; individual without `ownerRrn` → `대표자 주민등록번호를 입력하세요.`; success writes N audit rows and never stores `ownerRrn`; key missing → the existing `MissingEncryptionKeyError` message.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Page: year + 상/하반기 picker; banner `홈택스 검증 전 — 국세청 2021년 상반기 전산매체 레이아웃으로 만든 파일입니다. 홈택스 변환신고에서 오류가 나면 알려 주세요.`; preview table (성명, 주민등록번호 masked, 근무기간, 급여 등) with totals; buttons 파일 내려받기 (opens dialog; dialog repeats the banner and asks 대표자 주민등록번호 only for individual businesses; submits a real form POST so the browser saves the file) and Excel.
- [ ] **Step 6:** Nav item `간이지급명세서` → `/payroll/simplified-statement`; update `nav.test.ts`.
- [ ] **Step 7:** `pnpm test`, `pnpm lint` → pass. Commit `feat(withholding): 간이지급명세서 page and file download`.

### Task 7: E2E and docs

**Files:**
- Create: `e2e/withholding.spec.ts` (runs in the `settings-serial-payroll` project — add it to that project's `testMatch` in `playwright.config.ts`)
- Modify: `CLAUDE.md` (Phase 3 line and an architecture bullet), `docs/deploy.md` only if a new env var appeared (none expected)

- [ ] **Step 1:** Spec: as admin, fill company filing fields; create an employee (unique per run, 2021-born RRN as in `payroll.spec.ts`), a 정기 run for 2026-02 paid 2026-02-25, confirm; open `/payroll/withholding?mode=monthly&attr=2026-02&pay=2026-02` → A01 shows 인원 ≥ 1 and the computed 소득세; set ⑫ and see ⑩ change; open `/payroll/simplified-statement` for 2026 상반기 → banner visible; download → file name matches `/^SC\d{7}\.\d{3}$/`, byte length % 192 === 0, first byte `A`; cleanup: cancel and delete the run like `payroll.spec.ts`.
- [ ] **Step 2:** `pnpm exec playwright test e2e/withholding.spec.ts --project=settings-serial-payroll` → PASS; `pnpm build` → OK; smoke spec passes for the two new routes.
- [ ] **Step 3:** Commit `test(withholding): e2e for 신고서 screen and 간이지급명세서 download; docs`.
