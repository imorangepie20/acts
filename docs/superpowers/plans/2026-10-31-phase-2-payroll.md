# Phase 2 — 급여 · 원천징수 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small Korean company runs its monthly payroll here.
- Employees, pay items and dated rates.
- Monthly and 상여 payroll runs with automatic 4대보험 and 간이세액표 withholding.
- One auto-generated payroll voucher per confirmed run.
- Payslips and a 급여 대장 Excel file.
- Encrypted 주민등록번호 and accounts, plus TOTP 2단계 인증.

**Architecture:**
- **Pure calculation:** everything that turns amounts into deductions lives in `src/lib/payroll/` and is tested without a DB: insurance, income tax lookup, the 상여 지급대상기간 method, and the voucher builder.
- **Server services:** `src/server/payroll/` loads rates, tables and employees, and writes runs. Confirming a run writes the payroll voucher in the same transaction, through a new `writePayrollVoucher` in the voucher service. That keeps validation, numbering, history, period lock and approval status unchanged.
- **Visibility:** payroll vouchers (`kind = 'payroll'`) are hidden from users without `payroll:manage`. The filter is applied in the server query layer: voucher list and detail, journal, account and partner ledgers, their Excel files and the 세무사 package. Statements and the dashboard keep them in their totals.
- **Security:** 주민등록번호 and account numbers are encrypted with AES-256-GCM (`src/server/crypto/`), with an HMAC column for uniqueness. TOTP adds a second login step tracked on the session row.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM 0.45 · exceljs 4.4 (read the 간이세액표 workbook, write the 대장) · `qrcode` (new, renders the TOTP enrolment QR as an SVG/data URL) · Node `crypto` (AES-GCM, HMAC, TOTP — no TOTP library) · Vitest · Playwright.

**Spec:** [docs/superpowers/specs/2026-10-31-phase-2-payroll-design.md](../specs/2026-10-31-phase-2-payroll-design.md)

## Global Constraints

- Everything in the 1A–1E Global Constraints still applies:
  - Korean UI copy, integer won, `YYYY-MM-DD` strings, Asia/Seoul today (`todayInSeoul`).
  - Posted means `POSTED_STATUSES`.
  - Lock order for every voucher write: period lock `(PERIOD_LOCK, 0)` shared → company FOR SHARE → voucher row → numbering.
  - The month-close watermark and the opening cut-off.
- **No rate or table in code.** 요율, 상한·하한 and the 간이세액표 live in `payroll_rates` / `withholding_tables`, loaded by the seed from data files. The calculation functions take them as arguments.
- **Every seeded rate carries its source URL** in a comment in the seed data file. A value not confirmed against an official page (국민연금공단, 국민건강보험공단, 근로복지공단, 국세청, law.go.kr) is marked `// UNVERIFIED` in that file, and the final report lists every such value.
- **Rate lookup date:**
  - 4대보험 rates and caps use the 귀속월 1일.
  - The 간이세액표 uses the run's 지급일.
  - In both cases, take the row of that kind with the latest `effective_from <= date`.
- **Rounding:** every insurance amount and 지방소득세 is floored to 10원 (`floor10`). The 간이세액표 amount is used as-is. 80%/120% is applied to the table amount, then floored to 10원.
- **Plain text never leaves the crypto boundary.**
  - The 주민등록번호 and account number are never logged, never put in `voucher_history`, error messages or Excel files.
  - They are never returned to the client unless the user presses 보기. 보기 calls `revealEmployeeSecret`, which writes an audit row.
  - Lists, the 대장 and Excel files show the masked forms only: `900101-1******` and `***-****-1234`, the last 4 digits.
- **`PAYROLL_ENCRYPTION_KEY`** is a 32-byte key in base64. It is required at runtime only by code that encrypts or decrypts. Its absence throws `PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.` and does not crash unrelated pages. Add it to `.env.example` (empty) and `docs/deploy.md`. Tests set a fixed key in `tests/helpers/db.ts`' environment setup.
- **Permissions:**
  - `payroll:manage` is new and granted to `["manager", "admin"]`.
  - It covers employees, items, settings, runs, payslips and the 대장 Excel.
  - Approving or rejecting a payroll voucher needs `voucher:approve` **and** `payroll:manage`.
- **2FA is mandatory** for every user whose role has `payroll:manage` or `settings:manage`, i.e. manager and admin. Others may enrol voluntarily from the profile page.
- **Exact messages:**
  - Payroll voucher edited from the voucher screens: `급여 전표는 급여 대장에서 확정을 취소해야 고칠 수 있습니다.`
  - Ledger notice: `급여 전표 <N>건은 권한이 있어야 볼 수 있습니다. 이 때문에 잔액이 합계잔액시산표와 다를 수 있습니다.`
  - Hidden voucher list row description: `급여 전표`
  - Duplicate 정기 run: `<YYYY>년 <M>월 정기 급여 대장이 이미 있습니다.`
  - Missing mapped account at confirm: `급여 설정의 <항목> 계정을 사용할 수 없습니다. 급여 설정에서 계정을 다시 고르세요.`
  - Missing required partner at confirm: `<코드> <이름> 계정은 거래처가 필요합니다. 급여 설정에서 기관 거래처를 지정하세요.`
  - Duplicate 주민등록번호: `같은 주민등록번호의 사원이 이미 있습니다.`
  - Invalid 주민등록번호 (format or check digit): `주민등록번호가 올바르지 않습니다.`
  - Wrong TOTP code: `인증 코드가 올바르지 않습니다.`
  - Rejected run banner: `전표가 반려되었습니다: <사유>. 확정을 취소한 뒤 고쳐서 다시 확정하세요.`

## Review Focus

1. **Mid-year rate change inside one run.** A 7월 귀속 run must use the 2026-07-01 국민연금 cap, while a 6월 run paid in 7월 uses the 6월 cap. Pinned in Task 5 (`calc.test.ts: uses the cap effective on the 귀속월 1일`).
2. **비과세 over its limit.** 식대 of 250,000 must split into 200,000 비과세 and 50,000 과세. The 과세 part feeds the 간이세액표, 고용보험 and the 과세 total. Pinned in Task 5 (`splits 비과세 above the monthly limit`).
3. **Employee who left before the 귀속월, or joins after it.** Such an employee must not be pre-filled into a new run. Pinned in Task 8 (`createRun skips employees not employed in the 귀속월`).
4. **Confirm after a rate or employee edit.** Confirm recomputes from the stored line inputs and current rates, except for overridden cells. The voucher must match the 대장 total the user saw, so confirm refuses when the recomputed totals differ from the version the client confirmed (version check). Pinned in Task 8 (`confirm fails with ERR_CONFLICT after a concurrent line edit`).
5. **Month closed after confirm.** Cancelling a run whose voucher date is in a closed month must fail with `closedMonthMessage` and leave both the run and the voucher untouched. Pinned in Task 8 (`cancelConfirm refuses in a closed month`).

---

## File Map

```
src/lib/permissions.ts                       + payroll:manage
src/lib/payroll/
  rrn.ts                                     주민등록번호 validate/mask (pure)
  types.ts                                   Rates, WithholdingTable, ItemDef, LineInput, LineResult
  calc.ts                                    insurance + income tax + line totals (pure)
  bonus.ts                                   지급대상기간 method (pure)
  voucher.ts                                 run totals → StoredVoucherInput (pure)
src/server/crypto/secret.ts                  AES-GCM encrypt/decrypt, HMAC, key loading
src/server/auth/totp.ts                      RFC 6238 generate/verify, recovery codes
src/server/auth/mfa.ts                       enrol/confirm/verify/disable services
src/server/payroll/
  rates.ts                                   load rates + table for a date
  employees.ts                               CRUD, reveal + audit
  items.ts / settings.ts                     pay items, account + partner mapping
  runs.ts                                    create, edit lines, confirm, cancel, list
  ledger-sheet.ts                            급여 대장 SheetSpec
  seed-data/rates.ts                         dated rates with source comments
  seed-data/withholding-<YYYY-MM-DD>.json    generated by the converter script
scripts/convert-withholding-table.ts         official xlsx → JSON
src/app/(auth)/2fa/{setup,verify}/           enrolment + second step
src/app/(dashboard)/payroll/...              employees, items, settings, runs, payslip
src/components/payroll/                      feature components
```

---

### Task 1: Permission, 주민등록번호 rules and the crypto boundary

**Files:**
- Modify: `src/lib/permissions.ts`, `src/lib/permissions.test.ts`
- Create: `src/lib/payroll/rrn.ts`, `src/lib/payroll/rrn.test.ts`, `src/server/crypto/secret.ts`, `src/server/crypto/secret.test.ts`
- Modify: `.env.example`, `tests/helpers/db.ts` (or the vitest setup file it uses) to set `PAYROLL_ENCRYPTION_KEY` to a fixed test key

**Interfaces:**
- Produces:
  - `Permission` gains `"payroll:manage"`
  - `validateRrn(s: string): { ok: true; digits: string } | { ok: false }` — accepts `######-#######` or 13 digits. Checks the date and the gender digit 1–8. Runs the classic check digit only for 2020-10 and earlier birth dates, because RRNs issued after 2020-10 have a random last digit.
  - `maskRrn(digits: string): string` → `900101-1******`
  - `maskAccount(s: string): string` → `***-****-1234`
  - `encryptSecret(plain: string): string` → `v1:<iv b64>:<tag b64>:<ct b64>`
  - `decryptSecret(stored: string): string`
  - `hmacSecret(plain: string): string` (hex, HMAC-SHA256 with a key derived from the same env key using the `"rrn-index"` label)

- [ ] **Step 1: Write the failing tests**
  - `permissions.test.ts`:
    - `can("manager","payroll:manage")` and `can("admin","payroll:manage")` are true
    - `staff` and `executive` are false
  - `rrn.test.ts`:
    - `validateRrn("900101-1234568")` ok with a valid check digit (compute one in the test)
    - an invalid date `901301-1…` fails
    - gender digit `9` fails
    - a 2021 birth date `210315-3xxxxxx` with any last digit is ok
    - `maskRrn("9001011234568") === "900101-1******"`
    - `maskAccount("110-123-456789") === "***-****-6789"`
  - `secret.test.ts`:
    - the round trip returns the input
    - two encryptions of the same input differ
    - a tampered ciphertext throws
    - `hmacSecret` is deterministic and differs from `hmacSecret` of another input
    - with the env key unset, `encryptSecret` throws `PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.`

- [ ] **Step 2: Run** `pnpm test src/lib/permissions.test.ts src/lib/payroll/rrn.test.ts src/server/crypto/secret.test.ts` — FAIL (missing modules).

- [ ] **Step 3: Implement.**
  - `secret.ts` imports `server-only`.
  - It reads the key lazily on each call, so a missing key fails only the caller.
  - It uses `aes-256-gcm` with a 12-byte random IV.

- [ ] **Step 4: Run the same command** — PASS. Run `pnpm lint`.

- [ ] **Step 5: Commit** `feat(payroll): payroll permission, 주민등록번호 rules and secret encryption`

---

### Task 2: TOTP 2단계 인증

**Files:**
- Modify: `src/server/db/schema.ts`
  - new table `user_totp` (`user_id` PK/FK cascade, `secret` encrypted text, `enabled_at` timestamptz null, `recovery_codes` text[] of sha256 hex, `created_at`)
  - `sessions` gains `mfa_verified boolean not null default false`
- Create: `src/server/auth/totp.ts`, `src/server/auth/totp.test.ts`, `src/server/auth/mfa.ts`, `src/server/auth/mfa.test.ts`
- Modify: `src/server/auth/service.ts`, `src/server/auth/dal.ts`, `src/app/(auth)/login/actions.ts`
- Create: `src/app/(auth)/2fa/setup/page.tsx`, `src/app/(auth)/2fa/verify/page.tsx` + actions, components under `src/components/auth/`
- Modify: `scripts/reset-admin-password.ts` (+ test): `--reset-2fa` flag deletes the `user_totp` row
- Modify: `e2e/auth.setup.ts`, `e2e/auth.spec.ts`, `e2e/admin.spec.ts`, `e2e/pages-auth.spec.ts` via a new `e2e/helpers/login.ts`
- Migration: `pnpm db:generate` → `drizzle/0014_*.sql`

**Interfaces:**
- Produces:
  - `generateTotpSecret(): string` (base32, 20 bytes)
  - `totpCode(secret: string, at: Date): string`
  - `verifyTotp(secret: string, code: string, at: Date): boolean` (accepts ±1 step)
  - `otpauthUrl(secret: string, email: string): string` (issuer `acts`)
  - `mfaRequired(role: Role): boolean` = `can(role,"payroll:manage") || can(role,"settings:manage")`
  - `startEnrolment(db, userId): Promise<{ secret: string; otpauth: string }>` (replaces a not-yet-enabled row)
  - `confirmEnrolment(db, userId, code, now?): Promise<Result<{ recoveryCodes: string[] }>>` (10 codes, format `xxxx-xxxx`, shown once)
  - `verifySecondFactor(db, sessionToken, code, now?): Promise<Result>` accepts a TOTP code or an unused recovery code (consumes it). On failure it applies the same `failedLoginCount` / lock rule as `authenticate`. On success it sets `sessions.mfa_verified = true`.
  - `getSessionUser` returns `SessionUser & { mfa: "verified" | "pending" | "unenrolled" }`:
    - `pending`: enrolled, but this session is not verified
    - `unenrolled`: required but not enrolled
    - `verified`: verified, or not required and not enrolled
  - `verifySession()` redirects `pending` → `/2fa/verify` and `unenrolled` → `/2fa/setup`. A new `verifyPartialSession()` is used only by the two 2FA pages.
  - `e2e/helpers/login.ts`: `login(page, email, password)` handles both 2FA screens. It stores each user's secret in `e2e/.auth/totp-<email>.txt`, git-ignored. On `/2fa/setup` it reads the secret from the page's manual-entry text (`data-testid="totp-secret"`), enters the code and saves the secret. On `/2fa/verify` it uses the saved secret. If the file is missing on `/2fa/verify`, it throws `TOTP secret for <email> missing; run NEW_PASSWORD=... pnpm admin:reset-password <email> --reset-2fa`.

- [ ] **Step 1: Write the failing tests**
  - `totp.test.ts`: RFC 6238 Appendix B SHA-1 vectors. Secret `12345678901234567890` in ASCII, base32-encoded. At T=59 s the 8-digit code is `94287082`, so the 6-digit code is `287082`. At 1111111109 s it is `081804`.
  - `verifyTotp` accepts the previous step and rejects two steps back.
  - `mfa.test.ts` (DB):
    - a confirmed enrolment then a verify with the current code sets `mfa_verified`
    - a recovery code works once, then fails
    - 5 wrong codes lock the user (`lockedUntil` set)
    - `getSessionUser` returns `unenrolled` for an admin without a row, `verified` for a staff user without a row, and `pending` for an enrolled admin's fresh session

- [ ] **Step 2: Run** `pnpm test src/server/auth` — FAIL.

- [ ] **Step 3: Implement.**
  - TOTP: HMAC-SHA1, 30 s, 6 digits, base32 decode, dynamic truncation.
  - The setup page renders the QR with `qrcode`'s `toDataURL`, plus the manual key with `data-testid="totp-secret"`. After confirm it shows the recovery codes once, with a 다음 button to the role home.
  - The login action creates the session as today. `verifySession`'s redirect then routes to the right 2FA page. `homePathFor` is unchanged.
  - `proxy.ts` keeps its cookie-only check. Add `/2fa` to its public prefixes only if it currently redirects them; read it first.

- [ ] **Step 4: Run** `pnpm test src/server/auth scripts`. Then `pnpm exec playwright test e2e/auth.spec.ts e2e/admin.spec.ts`. Delete `e2e/.auth/` first so setup enrols fresh. Both must pass. Also add one e2e test, `2단계 인증 코드가 틀리면 오류를 보여 준다`, to `auth.spec.ts`.

- [ ] **Step 5: Commit** `feat(auth): TOTP 2단계 인증, mandatory for managers and admins`

---

### Task 3: Payroll schema and the payroll voucher kind

**Files:**
- Modify: `src/server/db/schema.ts`, `src/lib/vouchers/types.ts` (`VoucherKind` + `VOUCHER_KIND_LABELS.payroll = "급여"`), `src/server/db/schema.test.ts`
- Migration: `drizzle/0015_*.sql` (`ALTER TYPE voucher_kind ADD VALUE 'payroll'` must be its own statement; check drizzle-kit's output)

**Tables** (Drizzle names camelCase, SQL snake_case, as the existing tables do):
- `employees`:
  - `id` serial; `employee_no` text unique; `name`
  - `rrn_enc` text; `rrn_hmac` text unique
  - `hired_on` date; `left_on` date null
  - `site_id` FK not null; `department_id` FK null
  - `is_executive` bool
  - `dependents` int ≥ 1, the 공제대상가족 count including the employee
  - `children` int ≥ 0, children aged 8 to 20
  - `withholding_rate` smallint in (80,100,120)
  - `bank` text null; `account_enc` text null; `account_last4` text null
  - `ins_pension`, `ins_health`, `ins_employment` bool (장기요양 follows health)
  - `pension_base` bigint, the 기준소득월액; `health_base` bigint, the 보수월액
  - `default_amounts` jsonb `Record<itemCode, number>`
  - `created_at`, `updated_at`
- `payroll_items`:
  - `code` text PK (`basic`, `bonus`, `meal`, `car`, `position`, `overtime` seeded); `name`
  - `kind` enum `earning` (deductions are computed, not items)
  - `taxable` bool; `nontax_limit` bigint null (meal/car 200000)
  - `in_employment_base` bool
  - `debit_account_code` text null (null = 801/802 by 임원 여부, the default for basic/position/overtime/meal/car); bonus → `803`
  - `sort` int; `is_active` bool
- `payroll_settings`: single row `id=1`. Account codes are text and resolved at confirm:
  - `pension_company_code` (817), `insurance_company_code` (811), `withholding_code` (254), `company_payable_code` (262), `net_pay_code` (103), `executive_code` (801), `staff_code` (802)
  - partner FKs, all null: `pension_partner_id`, `health_partner_id`, `employment_partner_id`, `tax_partner_id`, `local_tax_partner_id`
- `payroll_rates`: `id`, `kind` enum (`pension_employee`, `pension_company`, `pension_cap`, `pension_floor`, `health_employee`, `health_company`, `ltc_employee`, `ltc_company`, `employment_employee`, `employment_company`), `effective_from` date, `value` numeric(12,6). Percent rates are stored as percent, e.g. `4.75`; caps are stored in won. Unique (`kind`, `effective_from`).
- `withholding_tables`: `effective_from` date PK, `data` jsonb `WithholdingTable` (see Task 4). One row per revision; the table is too wide for rows.
- `payroll_runs`:
  - `id` uuid; `type` enum (`regular`, `bonus`); `year_month` text `YYYY-MM`; `pay_date` date
  - `bonus_from` / `bonus_to` text `YYYY-MM`, null
  - `status` enum (`draft`, `confirmed`); `voucher_id` FK null (ON DELETE SET NULL)
  - `version` int; `created_by`, `confirmed_by`, `confirmed_at`, timestamps
  - partial unique index on `year_month` where `type='regular'`
- `payroll_run_lines`:
  - `run_id` FK cascade + `employee_id` FK, composite PK
  - `amounts` jsonb `Record<itemCode, number>`
  - `overrides` jsonb `Partial<Record<DeductionKey, number>>`
  - `result` jsonb `LineResult`, the last computed values with overrides applied
  - `snapshot` jsonb: the employee's name, employee_no, dependents, children, rate, bases and site/department at compute time, so payslips stay stable after employee edits
- `payroll_audit`: `id`, `user_id`, `employee_id`, `field` (`rrn` | `account`), `at`.

- [ ] **Step 1: Write the failing test** — `schema.test.ts` asserts the new tables exist in `acts_test` after migrate and that inserting two `regular` runs for one `year_month` raises a unique violation, while two `bonus` runs do not.
- [ ] **Step 2: Run** `pnpm test src/server/db/schema.test.ts` — FAIL.
- [ ] **Step 3: Implement** the schema; `pnpm db:generate`; inspect the SQL; `pnpm db:migrate`.
- [ ] **Step 4: Run** `pnpm test src/server/db` and `pnpm build` — PASS. Every `Record<VoucherKind, …>` and kind `switch` must compile.
- [ ] **Step 5: Commit** `feat(payroll): payroll tables and the 급여 voucher kind`

---

### Task 4: Rates and 간이세액표 data

**Stop condition:** the official 근로소득 간이세액표 workbook comes from 홈택스. The path is 세금신고 → 원천세 신고 → 근로소득 간이세액표(조견표), Excel. The legal text is 소득세법 시행령 [별표 2] on law.go.kr; the current revision found is the one of 2024-02-29, in force from 2024-03-01. If the workbook cannot be downloaded from this machine, stop and ask the user to download it and give its path. Never generate the table from a formula or from a third-party site.

**Files:**
- Create: `scripts/convert-withholding-table.ts`, `scripts/convert-withholding-table.test.ts` (a small fixture workbook built in the test with exceljs), `src/server/payroll/seed-data/withholding-<effective>.json`, `src/server/payroll/seed-data/rates.ts`, `src/server/payroll/rates.ts`, `src/server/payroll/rates.test.ts`
- Modify: `scripts/seed.ts` (+ `src/server/seed.test.ts`): upsert rates, tables, the six default items and the settings row, all idempotent
- Modify: `src/lib/payroll/types.ts`

**Interfaces:**
- Produces:
  - `type WithholdingTable`:
    - `rows: { from: number; to: number; tax: number[] }[]` — won, `from` inclusive, `to` exclusive; `tax[i]` is the amount for `i+1` 공제대상가족, i = 0..10
    - `over10m`: the [별표 2] rules for 월급여 above 10,000천원, as data: an ordered list of `{ above: number; base: "table10m" | "prev"; plusRate: number; plusPercentOfExcess: number; addFixed: number }`. The converter does not read this. It is hand-entered from the [별표 2] text in a typed constant next to the JSON, each line commented with the text it encodes.
    - `childCredit: { one: number; two: number; perExtra: number }` (from [별표 2]'s 자녀 note; verify the amounts in the text)
    - `familyOver11`: the rule for more than 11 family members, from the [별표 2] text, hand-entered and commented
  - `type Rates = { pensionEmployee: number; pensionCompany: number; pensionCap: number; pensionFloor: number; healthEmployee: number; healthCompany: number; ltcEmployee: number; ltcCompany: number; employmentEmployee: number; employmentCompany: number }` (percent values as stored)
  - `loadRates(db, date: string): Promise<Rates>` throws `<date> 기준 <kind> 요율이 없습니다.` when a kind has no row
  - `loadWithholdingTable(db, date: string): Promise<WithholdingTable>`
- Seed `rates.ts` values, every line with its source URL, `// UNVERIFIED` until checked against an official page:
  - `pension_employee` / `pension_company` 4.75 from 2026-01-01
  - `pension_cap` 6,370,000 and `pension_floor` 400,000 from 2025-07-01
  - `pension_cap` 6,590,000 and `pension_floor` 410,000 from 2026-07-01
  - `health_employee` / `health_company` 3.595 from 2026-01-01
  - `ltc_employee` / `ltc_company` 0.4724 from 2026-01-01. This is percent of 보수월액, the 2026 income-based expression (0.9448% total). The spec's "건강보험료 대비 13.14%" is the same rate shown differently. Check NHIS's published 계산 방법 and use whichever base NHIS uses. If it is premium-based, change `calc.ts`'s 장기요양 formula and this value together, and note it in the commit.
  - `employment_employee` / `employment_company` 0.9 from 2026-01-01
  - Add the 2025 values too (9.0% pension, 7.09% health, 12.95%-of-premium equivalent for 장기요양), so runs for 2025 귀속월 work. Mark them `// UNVERIFIED` as well unless confirmed.

- [ ] **Step 1: Write the failing tests**
  - Converter: a fixture sheet with title rows, a header row (`월급여액(천원)`, `이상`, `미만`, `1`…`11`) and three data rows converts to `rows` in won (×1000 for the bands). The tax values are taken as-is; check the header note for the unit.
  - `rates.test.ts`: after seeding, `loadRates(db,"2026-06-01").pensionCap === 6370000` and `loadRates(db,"2026-07-01").pensionCap === 6590000`; `loadRates(db,"1999-01-01")` throws.
  - `seed.test.ts`: running the seed twice leaves one row per (kind, effective_from) and six items.
- [ ] **Step 2: Run** `pnpm test scripts/convert-withholding-table.test.ts src/server/payroll/rates.test.ts src/server/seed.test.ts` — FAIL.
- [ ] **Step 3: Implement**:
  - Get the official workbook and run `pnpm tsx scripts/convert-withholding-table.ts <xlsx> <effective-from>`.
  - Commit the JSON.
  - Hand-enter `over10m`, `childCredit` and `familyOver11` from the [별표 2] text.
  - Spot-check five rows of the JSON against the PDF/HWP of [별표 2]. The checks are 1,500천원 with 1 family member, 3,000천원 with 2, 5,000천원 with 4, 7,000천원 with 3 and 10,000천원 with 1. Record them in a test, `withholding table spot checks`.
- [ ] **Step 4: Run** the same tests — PASS.
- [ ] **Step 5: Commit** `feat(payroll): dated 4대보험 rates and the 근로소득 간이세액표 data`

---

### Task 5: Line calculation (pure)

**Files:**
- Create: `src/lib/payroll/calc.ts`, `src/lib/payroll/calc.test.ts`
- Modify: `src/lib/payroll/types.ts`

**Interfaces:**
- Consumes: `Rates`, `WithholdingTable` (Task 4)
- Produces:
  - `type ItemDef = { code: string; name: string; taxable: boolean; nontaxLimit: number | null; inEmploymentBase: boolean }`
  - `type EmployeeCalcInput = { dependents: number; children: number; withholdingRate: 80 | 100 | 120; insPension: boolean; insHealth: boolean; insEmployment: boolean; pensionBase: number; healthBase: number }`
  - `type DeductionKey = "pension" | "health" | "ltc" | "employment" | "incomeTax" | "localTax"`
  - `type LineResult = { gross: number; taxable: number; nontaxable: number; employmentBase: number; deductions: Record<DeductionKey, number>; company: { pension: number; health: number; ltc: number; employment: number }; totalDeductions: number; netPay: number }`
  - `floor10(n: number): number`
  - `splitTaxable(items: ItemDef[], amounts: Record<string, number>): { gross; taxable; nontaxable; employmentBase }` — per item, `nontax = taxable ? 0 : min(amount, nontaxLimit ?? amount)` and the rest is taxable. `employmentBase` is the taxable part of items with `inEmploymentBase`.
  - `monthlyIncomeTax(table: WithholdingTable, monthlyTaxable: number, dependents: number, children: number): number` — at 100%, after the 자녀 credit, never below 0
  - `computeLine(input: { items: ItemDef[]; amounts: Record<string, number>; employee: EmployeeCalcInput; rates: Rates; table: WithholdingTable; type: "regular" | "bonus"; bonusTax?: number; overrides?: Partial<Record<DeductionKey, number>> }): LineResult`
- Rules, from the spec:
  - 국민연금: `floor10(clamp(floor1000(pensionBase), floor, cap) × rate%)`. 건강보험: `floor10(healthBase × rate%)`. 장기요양: `floor10(healthBase × ltc%)`, or the premium-based formula if Task 4 found that. 고용보험: `floor10(employmentBase × rate%)`.
  - The company amounts use the company rates on the same bases.
  - `type: "bonus"` sets 국민연금, 건강보험 and 장기요양 to 0 for both employee and company. 고용보험 still applies.
  - 소득세 for `regular` is `floor10(monthlyIncomeTax(...) × rate/100)`; for 100% it is the table amount itself. For `bonus` it is `bonusTax`, computed by Task 6.
  - 지방소득세 is `floor10(incomeTax × 0.1)`.
  - Overrides replace the computed value of that deduction. `totalDeductions` and `netPay` use the overridden values. `localTax` is recomputed from an overridden `incomeTax` unless `localTax` is also overridden.

- [ ] **Step 1: Write the failing tests** (`calc.test.ts`). Use a tiny hand-made `WithholdingTable` and fixed `Rates` objects; no seed data:
  - `splits 비과세 above the monthly limit`: meal 250,000 with limit 200,000 → nontaxable 200,000, taxable includes 50,000.
  - `clamps the pension base to the cap and floor`: base 7,000,000 with cap 6,590,000 at 4.75% → 313,020 (6,590,000 × 0.0475 = 313,025, floored to 313,020). Base 300,000 with floor 410,000 → 19,470.
  - `uses the cap effective on the 귀속월 1일`: two `Rates` objects in, two different pension amounts out. This pins only the function. The date choice is pinned in Task 8.
  - `floors every insurance to 10원`.
  - `applies 80% and 120% to the table amount`: table 100,000 → 80,000 and 120,000. An odd table amount 12,345 at 80% → 9,870.
  - `subtracts the 자녀 credit and never goes negative`.
  - `bonus run has no pension, health or ltc`.
  - `override of incomeTax recomputes localTax`.
  - `employee not enrolled in an insurance pays 0 for it, company too`.
  - Two `monthlyIncomeTax` cases above 10,000천원 using the hand-entered `over10m` constant from Task 4. Import the real constant here; it is data, not seed. The expected values are worked out by hand from the [별표 2] text in a comment.
- [ ] **Step 2: Run** `pnpm test src/lib/payroll/calc.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Do the money math in integers where possible: `Math.floor(base * rateBasisPoints / 1_000_000)` with rates converted once, so float drift never changes a 10원 boundary. Add a test at an exact 10원 boundary.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(payroll): 4대보험 and 간이세액표 line calculation`

---

### Task 6: 상여 소득세 (지급대상기간)

**Files:**
- Create: `src/lib/payroll/bonus.ts`, `src/lib/payroll/bonus.test.ts`

**Interfaces:**
- Consumes: `monthlyIncomeTax` (Task 5)
- Produces:
  - `bonusPeriod(payDate: string, from: string | null, to: string | null): { from: string; to: string; months: number }`. With no period entered, the period runs from January of the pay year to the pay month. A period longer than 12 months is capped to the 12 months ending at `to`. Verify both rules against 소득세법 시행령 제194조 and quote the article in the test file header.
  - `bonusIncomeTax(input: { table; bonusTaxable: number; periodRegularTaxable: number; periodWithheld: number; months: number; dependents; children; withholdingRate }): number`. It computes `max(0, floor10(monthlyIncomeTax(table, floor((bonusTaxable + periodRegularTaxable) / months), …) × months × rate/100) − periodWithheld)`. Confirm the order of the rate multiplication against the article and NTS guidance, and keep the test consistent with what you find.

- [ ] **Step 1: Write the failing tests**:
  - `bonusPeriod("2026-07-25", null, null)` gives months 7.
  - A 2025-01 to 2026-06 period is capped to 12 months.
  - A worked example with the hand table: 3 months of 2,000,000 regular taxable already withheld at 20,000 each, plus a bonus of 3,000,000. The average is 3,000,000, so the test expects `tableTax(3,000,000)×3 − 60,000`.
  - The result is never negative.
- [ ] **Step 2: Run** `pnpm test src/lib/payroll/bonus.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(payroll): 상여 withholding by 지급대상기간`

---

### Task 7: Employees, items and settings

**Files:**
- Create: `src/server/payroll/employees.ts`, `employees.test.ts`, `items.ts`, `settings.ts`, `settings.test.ts`
- Create pages: `src/app/(dashboard)/payroll/employees/page.tsx`, `…/employees/new/page.tsx`, `…/employees/[id]/page.tsx`, `…/payroll/settings/page.tsx` (items + accounts + partners), with actions; components in `src/components/payroll/employees/` and `src/components/payroll/settings/`
- Modify: `src/lib/nav.ts` + `nav.test.ts`. Add a 급여 group with 급여 대장 `/payroll/runs` (Task 9 adds the page; add the nav item there), 사원 `/payroll/employees` and 급여 설정 `/payroll/settings`, all `payroll:manage`.

**Interfaces:**
- Produces:
  - `type EmployeeInput = { employeeNo; name; rrn: string; hiredOn; leftOn: string | null; siteId; departmentId: number | null; isExecutive; dependents; children; withholdingRate; bank: string | null; account: string | null; insPension; insHealth; insEmployment; pensionBase; healthBase; defaultAmounts: Record<string, number> }`
  - `createEmployee(db, actor, input): Promise<Result<{ id: number }>>`
  - `updateEmployee(db, actor, id, input: Omit<EmployeeInput,"rrn"|"account"> & { rrn?: string; account?: string | null }): Promise<Result>`. An omitted `rrn` or `account` keeps the stored value, so the form never round-trips plain text.
  - `listEmployees(db, { includeLeft: boolean }): Promise<EmployeeRow[]>` (masked fields only)
  - `getEmployee(db, id): Promise<EmployeeDetail | null>` (masked)
  - `revealEmployeeSecret(db, actor, id, field: "rrn" | "account"): Promise<Result<string>>`. It requires `payroll:manage` and a `mfa: "verified"` session; the action passes the session user. It writes a `payroll_audit` row in the same transaction.
  - `listItems(db)`, `saveItem(db, actor, item)`. The six seeded codes cannot be deleted, only deactivated. New codes match `^[a-z][a-z0-9_]{1,30}$`.
  - `getPayrollSettings(db)`, `savePayrollSettings(db, actor, s)`. Codes are validated to exist and be active at save time; confirm re-checks them in Task 8.
- Every service checks `can(actor.role, "payroll:manage")` and returns `fail(ERR_FORBIDDEN)` otherwise. Every page uses `requirePermission("payroll:manage")`.

- [ ] **Step 1: Write the failing tests**:
  - Create, then read: `getEmployee` returns `rrnMasked: "900101-1******"` and no plain field.
  - The DB row's `rrn_enc` does not contain `9001011`.
  - A duplicate RRN gives `같은 주민등록번호의 사원이 이미 있습니다.`
  - An invalid RRN gives `주민등록번호가 올바르지 않습니다.`
  - `revealEmployeeSecret` returns the plain RRN and adds one audit row. With a `staff` actor it fails.
  - `updateEmployee` without `rrn` keeps the old hmac.
  - Settings: saving an unknown code fails; saving 817/811/254/262/103/801/802 succeeds.
- [ ] **Step 2: Run** `pnpm test src/server/payroll` — FAIL.
- [ ] **Step 3: Implement** services and screens.
  - The RRN input is `type="password"`-like with a show toggle on entry only.
  - The detail page shows masked values with a 보기 button that calls the reveal action. The revealed value is shown inline and never stored in client state beyond the component.
  - Partner pickers reuse the voucher partner picker.
- [ ] **Step 4: Run** `pnpm test src/server/payroll src/lib/nav.test.ts` and `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(payroll): employees with encrypted 주민등록번호, pay items and payroll settings`

---

### Task 8: Runs — create, edit, confirm, cancel

**Files:**
- Create: `src/lib/payroll/voucher.ts`, `voucher.test.ts`, `src/server/payroll/runs.ts`, `runs.test.ts`
- Modify: `src/server/vouchers/service.ts` (+ `service.test.ts`)

**Interfaces:**
- Consumes: Tasks 4–7
- Produces in `src/lib/payroll/voucher.ts`:
  - `buildPayrollVoucher(input: { payDate: string; description: string; lines: { employee: { isExecutive: boolean; siteId: number; departmentId: number | null }; amounts: Record<string, number>; result: LineResult }[]; items: { code: string; accountId: number | null }[]; accounts: { executive: number; staff: number; pensionCompany: number; insuranceCompany: number; withholding: number; companyPayable: number; netPay: number }; partners: { pension: number | null; health: number | null; employment: number | null; tax: number | null; localTax: number | null } }): StoredVoucherInput & { kind: "payroll" }`
  - Debit lines: per (site, department, account), the sum of item amounts. Items with `accountId = null` go to executive or staff by `isExecutive`. Company 국민연금 goes to `pensionCompany`; company health + ltc + employment go to `insuranceCompany`.
  - Credit lines: per (site, department), 예수금 split by partner. 국민연금 employee + company → pension partner; health+ltc employee+company → health partner; employment → employment partner; 소득세 → tax partner; 지방소득세 → local tax partner. Employee parts credit `withholding`, company parts credit `companyPayable`; net pay credits `netPay`.
  - Zero-amount lines are dropped. `entryType: "general"`, `evidenceType: "none"`. Description `<YYYY>년 <M>월 급여` or `<YYYY>년 <M>월 상여`.
- Produces in `src/server/vouchers/service.ts`:
  - `writePayrollVoucher(tx: Tx, actor: SessionUser, vat: VatAccounts, input: StoredVoucherInput & { kind: "payroll" }): Promise<Result<{ id: string }>>`. Same validation and numbering as `createVoucher`; status from `readApproval(tx)` + `statusFields`. The caller holds the period lock.
  - `deletePayrollVoucher(tx: Tx, actor: SessionUser, id: string): Promise<Result>`. It locks the row, writes the `deleted` history row and deletes. It ignores `version`; the run's version guards it.
  - `lockForWrite`'s default `permitted` rejects `kind === "payroll"` with `ERR_PAYROLL_ONLY` = `급여 전표는 급여 대장에서 확정을 취소해야 고칠 수 있습니다.`. That covers update, delete, attach and detach from the voucher screens.
  - `decide` (approve/reject) additionally requires `payroll:manage` for payroll vouchers, through the exported pure guard `canDecidePayroll(role: Role): boolean` (= `can(role,"voucher:approve") && can(role,"payroll:manage")`).
  - Check that attach/detach go through `lockForWrite`; if one does not, add the same `kind === "payroll"` refusal there.
- Produces in `src/server/payroll/runs.ts`:
  - `createRun(db, actor, input: { type: "regular" | "bonus"; yearMonth: string; payDate: string; bonusFrom?: string | null; bonusTo?: string | null }): Promise<Result<{ id: string }>>`. It pre-fills one line per employee employed on any day of `yearMonth`: `hired_on <= last day` and (`left_on` null or `>= first day`). Each line gets that employee's latest confirmed run amounts of the same type, else `default_amounts`; bonus runs start at 0. It then computes. A duplicate regular run gives the exact duplicate message.
  - `updateRunLines(db, actor, runId, version, changes: { employeeId: number; amounts?: Record<string, number>; overrides?: Partial<Record<DeductionKey, number | null>> }[]): Promise<Result<{ version: number }>>`. Draft only; it recomputes changed lines. A `null` override clears it.
  - `addEmployeeToRun` / `removeEmployeeFromRun(db, actor, runId, version, employeeId)`
  - `recomputeRun(db, actor, runId, version)`: reloads employee snapshots and rates.
  - `confirmRun(db, actor, runId, version): Promise<Result>`. In one transaction:
    1. Take the period lock shared via `assertMonthsOpen(tx, [payDate])`.
    2. Lock the run FOR UPDATE and check the version and draft status.
    3. Resolve and validate the accounts and partners. Use the exact missing-account and missing-partner messages, and require a partner only where the account's `requiresPartner` is set.
    4. Recompute every line.
    5. Build the voucher, call `writePayrollVoucher`, and set status `confirmed`, `voucher_id` and `version+1`.
  - `cancelConfirm(db, actor, runId, version): Promise<Result>`. In one transaction: period lock via `assertMonthsOpen(tx, [voucher date])`, lock the run, `deletePayrollVoucher`, then status `draft`. A run whose voucher is already gone (null) just goes back to draft.
  - `getRun(db, runId): Promise<RunDetail | null>`. Includes the voucher status and reject reason for the banner.
  - `listRuns(db, { year: number }): Promise<RunRow[]>`
  - The 상여 tax per line: load the confirmed regular runs whose `year_month` falls in the period, sum their taxable totals and withheld 소득세 for that employee, then call `bonusIncomeTax`.

- [ ] **Step 1: Write the failing tests**
  - `voucher.test.ts`:
    - 2 staff and 1 executive at one site → debit 801 and 802 separately.
    - Employees at two sites → separate lines per site.
    - Debits equal credits.
    - A zero 고용보험 drops its line.
    - Partner IDs land on the right credit lines.
  - `runs.test.ts` (DB):
    - `createRun skips employees not employed in the 귀속월`: left before, or hired after.
    - `createRun uses 귀속월 rates and 지급일 table`: a June run paid on 2026-07-10 uses the 6,370,000 cap.
    - A duplicate regular run fails with the exact message; a second bonus run succeeds.
    - `updateRunLines` on a confirmed run fails.
    - `confirm creates one approved payroll voucher when approval is off`, and a `pending` one when approval is on.
    - `confirm fails with ERR_CONFLICT after a concurrent line edit`.
    - `cancelConfirm deletes the voucher and returns to draft`.
    - `cancelConfirm refuses in a closed month`: close the month with `closeMonth`; both run and voucher are unchanged.
    - `updateVoucher` / `deleteVoucher` on the payroll voucher give `ERR_PAYROLL_ONLY`.
    - A rejected payroll voucher shows `voucherStatus: "rejected"` and its reason in `getRun`. `cancelConfirm` then deletes it.
    - Approving a payroll voucher as a user with `voucher:approve` but not `payroll:manage` fails. The default matrix has no such role, so test the `decide` guard through a unit seam or a temporary role-less check. Keep it simple: assert `canDecidePayroll(role)`.
    - A bonus run's 소득세 matches `bonusIncomeTax` given the employee's confirmed regular runs in the period.
- [ ] **Step 2: Run** `pnpm test src/lib/payroll src/server/payroll src/server/vouchers` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests plus `pnpm test src/server/closing` — PASS. The closing tests cover the lock order.
- [ ] **Step 5: Commit** `feat(payroll): payroll runs with confirm-to-voucher and cancel`

---

### Task 9: Run screens, payslips and the 대장 Excel

**Files:**
- Create pages: `src/app/(dashboard)/payroll/runs/page.tsx` (list by year + 새 대장), `…/runs/[id]/page.tsx` (grid), `…/runs/[id]/payslips/page.tsx` (print view: one payslip per page; `?employee=<id>` for one)
- Create: `src/components/payroll/runs/` (grid, banner, confirm/cancel buttons), `src/components/payroll/payslip.tsx`, `src/server/payroll/ledger-sheet.ts`
- Modify: `src/server/exports/specs.ts` and `src/app/api/exports/[report]/route.ts`. Add the report key `payroll-run`, which takes `?run=<id>`, requires `payroll:manage` in `exportPermission`, and is named `급여대장_<YYYY-MM>[_상여].xlsx`.
- Modify: `src/lib/nav.ts` (add 급여 대장)
- Test: `e2e/payroll.spec.ts`. Add it to the `settings-serial` project, because it changes shared state (employees, runs, a voucher). Read `playwright.config.ts` for where serial specs are listed.

**Behavior:**
- The grid has one row per employee and one column per active item. Then come the computed deduction columns. Overridden cells are marked with a dot and a 계산값 tooltip and can be cleared. Last come 공제 계 and 실지급액, with a totals footer.
- Edits save on blur through `updateRunLines` with the run version. A conflict shows `ERR_CONFLICT` and reloads.
- The 확정 button opens a confirm dialog showing the voucher preview (account totals). The 확정 취소 button appears only when confirmed.
- The rejected banner uses the exact message.
- Payslips are a print view (`@media print`, A4, `window.print()` button 인쇄/PDF 저장); no PDF library. Each shows the company name, 귀속월, 지급일, the employee name and employee_no, and the masked RRN only. Then the earnings and deductions tables, 실지급액 and the 계산 근거: 보수월액, 기준소득월액, the rates used and 간이세액 비율.
- The Excel file uses masked RRNs only.

- [ ] **Step 1: Write the failing e2e** `e2e/payroll.spec.ts`:
  1. Create employee `홍길동` with basic 3,000,000 and meal 200,000.
  2. Create a regular run for a month in fiscal year 2000 (follow the closing spec's year-2000 isolation pattern) and see the computed 국민연금.
  3. Override 소득세 and see the marker.
  4. 확정; open `/vouchers` and see a `급여` kind voucher.
  5. Open the payslip print view and see `900101-1******`.
  6. 확정 취소; the voucher is gone.
  7. Download the Excel file; it does not contain the plain RRN (read it with exceljs in the test).
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/payroll.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the spec plus `e2e/smoke.spec.ts` and `e2e/no-base-ui-warnings.spec.ts` — PASS. Take a screenshot of the grid and of a payslip, and look at them (memory: verify UI before "done").
- [ ] **Step 5: Commit** `feat(payroll): run grid, payslips and 급여 대장 Excel`

---

### Task 10: Hide payroll vouchers from users without payroll:manage

**Files:**
- Modify: `src/lib/reports/types.ts`. `ReportFilter` gains `hidePayroll: boolean`. Update `parseReportParams` callers so pages pass `!can(user.role,"payroll:manage")`.
- Modify: `src/server/reports/ledgers.ts`. `scope(f)` adds `ne(vouchers.kind, "payroll")` when `hidePayroll`. Add `countHiddenPayroll(db, f): Promise<number>`, the payroll vouchers in the period and scope.
- Modify: `src/server/reports/service.ts`, `totals.ts`. These **ignore** `hidePayroll`: statements keep the totals. Add a test that pins it.
- Modify: `src/server/vouchers/service.ts`.
  - `listVouchers` takes `hidePayroll`. Hidden rows come back with `description: "급여 전표"`, amount `null` and partner `null`, and cannot be opened.
  - `getVoucher(db, id, { hidePayroll })` returns `null` for a hidden payroll voucher, which renders as 404.
- Modify: `src/server/exports/specs.ts`. The journal and ledger sheet specs honour `hidePayroll` from the requesting user. `buildTaxPackage` always passes `hidePayroll: true` for its journal sheet; the trial balance is unchanged.
- Modify: the ledger pages and components to show the exact notice when `countHiddenPayroll > 0`.
- Modify: the dashboard's pending banner and `countPending`. They keep counting payroll vouchers, so no change. Note it in a test comment.

- [ ] **Step 1: Write the failing tests** (`src/server/reports/ledgers.test.ts`, `src/server/vouchers/service.test.ts`, `src/server/exports/*.test.ts`), seeding one confirmed payroll voucher:
  - The journal with `hidePayroll: true` excludes it and `countHiddenPayroll` = 1; with false it includes it.
  - The account ledger for 802 with `hidePayroll: true` has no rows from it.
  - `getTrialBalance` totals are equal for both flags.
  - `listVouchers({ hidePayroll: true })` row has description `급여 전표` and no amount.
  - `getVoucher(..., { hidePayroll: true })` is null.
  - The 세무사 package journal sheet has no payroll rows.
- [ ] **Step 2: Run** `pnpm test src/server/reports src/server/vouchers src/server/exports` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests plus the full `pnpm test` — PASS. Add an e2e case to `e2e/payroll.spec.ts`: log in as a staff user via `e2e/helpers/login.ts`, see the notice in 분개장, and get 404 opening the payroll voucher URL.
- [ ] **Step 5: Commit** `feat(payroll): hide payroll voucher details from users without payroll permission`

---

### Task 11: Docs and full regression

**Files:**
- Modify: `CLAUDE.md`
  - the project line: Phase 2 payroll
  - an Architecture bullet for Payroll: `src/lib/payroll/`, `src/server/payroll/`, confirm → `writePayrollVoucher`, the visibility rule and the rate lookup dates
  - an Auth/2FA bullet: `mfa` on the session, `/2fa/*`, `e2e/helpers/login.ts` secrets, `--reset-2fa`
  - `PAYROLL_ENCRYPTION_KEY` in the env notes
- Modify: `docs/deploy.md` (Korean)
  - generating the key: `openssl rand -base64 32`
  - **losing the key makes stored 주민등록번호 and accounts unreadable**, so back it up apart from the DB dump
  - first login now asks managers and admins to enrol 2FA
  - how to reset it
- Modify: `.gitignore` for `e2e/.auth/totp-*.txt` if `e2e/.auth/` is not already ignored

- [ ] **Step 1: Run** `pnpm lint`, `pnpm build`, `pnpm test` and `pnpm test:e2e`. Run e2e with no dev server on :3710 so it tests the production build. Everything must pass. Report any failure verbatim; don't skip.
- [ ] **Step 2: Grep check:**
  - Run `git grep -n "4\.75\|3\.595\|6590000\|6,590,000" -- src ':!src/server/payroll/seed-data'`. It must return nothing; rates exist only in seed data and tests.
  - Run `git grep -n "UNVERIFIED" src/server/payroll/seed-data` and put its output in the final report.
- [ ] **Step 3: Commit** `docs: Phase 2 payroll, 2FA and the payroll encryption key`
