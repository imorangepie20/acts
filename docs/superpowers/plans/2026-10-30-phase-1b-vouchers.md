# Phase 1B — Chart of Accounts · Partners · Sites · Vouchers (VAT) · Approval · History · Evidence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can enter balanced vouchers — through three transaction-type forms (매입·비용, 매출, 입출금·대체) that split VAT automatically, or a general debit/credit form — against a Douzone-coded chart of accounts, partners, and 사업장/부서; managers approve or reject them when approval is on; every change is kept in a history; receipts and invoices can be attached as files.

**Architecture:** Same layering as 1A: Drizzle tables in `src/server/db/schema.ts`, domain services `src/server/<area>/service.ts` that take `db` first and return `Result`, pure logic in `src/lib/**` (client-safe, unit-tested without a DB), Server Actions that call `requirePermission` → zod parse → service → `revalidatePath`. A voucher is a header (date, entry type, evidence/VAT metadata, status, version) plus ≥2 lines (account, side, amount, partner, site, department). The transaction-type forms are a pure builder (`buildSimpleVoucher`) that turns form input into header + lines, so the service only ever validates one shape.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM 0.45 (postgres-js) · zod · Vitest · Playwright · TanStack Table · cmdk (`src/components/ui/command.tsx`) + Popover for pickers.

**Spec:** [docs/superpowers/specs/2026-10-29-accounting-tax-system-design.md](../specs/2026-10-29-accounting-tax-system-design.md) — §4 (approval), §5.1, §5.1.1, §5.1.2, §5.4 (Douzone codes), §5.5, §6 (files on server disk), §8.
**Previous plan:** [2026-10-29-phase-1a-foundation-auth.md](2026-10-29-phase-1a-foundation-auth.md) (1C–1E scope table is there).

Out of scope here (later plans): month close and its lock (1D), opening balances / 결산 voucher UI / carry-forward (1D), ledgers and statements (1C), account recommendation / templates / Excel import / 세무사 export (1E). The schema below already carries what they need (`kind` enum with `closing`, posted-status rule, account groups).

## Global Constraints

- Everything in 1A's Global Constraints still applies (read `node_modules/next/dist/docs/` before Next code; Base UI `render` prop and `nativeButton={false}`; Korean UI copy; pnpm; ports 3710/5710; `pnpm lint` separate from build; Playwright runs a production build).
- **Money:** integer won in `bigint` columns with `mode: "number"`. Never a float. One line's amount is `1 ≤ amount ≤ MAX_WON` with `MAX_WON = 999_999_999_999`. Currency is KRW only.
- **Dates:** voucher date is a Postgres `date`, handled in code as a `"YYYY-MM-DD"` string (`date(..., { mode: "string" })`). "Today" means today in `Asia/Seoul`.
- **Account codes:** 3-digit Douzone-style codes, unique. The seeded standard chart below is the default; its exact match with Smart A is confirmed later with the first client's 세무사 (spec §5.4), so code must never hard-wire codes except the two VAT accounts `135` and `255`.
- **Posted rule (for 1C/1D):** only vouchers with `status = 'approved'` count in ledgers, statements and the dashboard. Export it as `POSTED_STATUSES = ["approved"] as const` from `src/lib/vouchers/types.ts`.
- **Single company:** no company id columns.
- **Every write to a voucher** (create, update, delete, approve, reject, attach, detach) inserts one `voucher_history` row in the same DB transaction.
- `tests/helpers/db.ts` `resetDb` must truncate every table a task adds (keep the list in FK-safe order, `RESTART IDENTITY CASCADE`).
- Each schema change: edit `schema.ts` → `pnpm db:generate` → commit the generated `drizzle/*.sql` and `drizzle/meta/*`. Never hand-edit an applied migration.

## Review Focus

1. Amounts typed the way people type them — `"1,234,000"`, `" 1234000 "`, `"1,234,000원"` — parse to `1234000`; `"12.5"`, `"-3"`, `""`, `"abc"` are rejected with `금액을 올바르게 입력하세요.` → Task 2 `parseWon` tests.
2. A card receipt whose total is not divisible by 11 (`10,000원`) — default split is VAT `909` / supply `9,091`, the voucher balances, and the totals shown equal what was typed. → Task 5 `splitVatFromTotal` + builder tests.
3. Two people save the same voucher from stale pages — the second save gets `다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.` and nothing of the first save is lost. → Task 6 `version conflict` test.
4. An account (or site/department) hidden after vouchers already used it — editing such an old voucher without touching those lines still saves; a new voucher cannot pick it. → Task 6 `keeps hidden account on existing line` test.
5. A file that lies about its type (HTML or an `.exe` renamed `.jpg`) — rejected by content sniffing with `JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.`; downloads are sent with the stored type, `nosniff`, and only to logged-in users with `ledger:view`. → Task 9 tests.

---

## File Structure

```
src/lib/money.ts                         # parseWon, formatWon, MAX_WON              (Task 2)
src/lib/accounts.ts                      # AccountGroup, labels, suggestGroup, normal side (Task 2)
src/lib/vouchers/types.ts                # enums, labels, LineInput, VoucherInput, POSTED_STATUSES (Task 5)
src/lib/vouchers/simple.ts               # buildSimpleVoucher, toSimpleInput, splitVatFromTotal (Task 5)
src/lib/vouchers/history.ts              # describeChanges (Task 7)
src/server/accounts/{standard-chart,service,form}.ts      # Task 2
src/server/partners/{service,form}.ts                     # Task 3
src/server/sites/{service,form}.ts                        # sites + departments, Task 4
src/server/vouchers/{service,form}.ts                     # Task 6 (+ approve/reject in Task 8)
src/server/attachments/{storage,service}.ts               # Task 9
src/app/(dashboard)/admin/{accounts,partners,sites}/      # pages + actions (Tasks 2-4)
src/app/(dashboard)/vouchers/{page.tsx,actions.ts,new/,[id]/,[id]/edit/}   # Task 7
src/app/api/attachments/[id]/route.ts                     # download, Task 9
src/components/admin/{accounts,partners,sites}/           # tables + dialogs
src/components/vouchers/                                  # entry forms, pickers, list, detail, history, attachments
```

---

### Task 1: Shell cleanup (Korean breadcrumbs, title, no mock notifications)

Small, independent; done first so later e2e assertions see the final shell.

**Files:**
- Modify: `src/app/layout.tsx` (metadata), `src/components/layout/breadcrumbs.tsx`, `src/components/layout/app-header.tsx`, `src/lib/nav.ts`
- Delete: `src/components/layout/notifications.tsx` (only if nothing else imports it)
- Test: `src/lib/nav.test.ts` (add), `e2e/smoke.spec.ts` (add)

**Interfaces:**
- Produces: `breadcrumbTrail(pathname: string): { href: string; label: string }[]` in `src/lib/nav.ts`.

- [ ] **Step 1: Failing tests.** `nav.test.ts`:
  - `breadcrumbTrail("/admin/users")` → `[{ href: "/admin/users", label: "사용자" }]` (the `admin` segment has no page of its own and is omitted)
  - `breadcrumbTrail("/reports/income-statement")` → `[{ href: "/reports/income-statement", label: "손익계산서" }]`
  - `breadcrumbTrail("/vouchers/new")` → `[{ href: "/vouchers", label: "전표 목록" }, { href: "/vouchers/new", label: "전표 입력" }]`
  - `breadcrumbTrail("/vouchers/3f2a…uuid")` → last label `전표 상세`; `breadcrumbTrail("/vouchers/<uuid>/edit")` → labels `전표 목록`, `전표 상세`, `수정`
  - Rule: a segment prefix that matches an `allNavItems` href uses that item's title; a uuid segment under `/vouchers` is `전표 상세`; `edit` is `수정`; other unmatched prefixes are skipped.

  `smoke.spec.ts`: the page `<title>` of `/overview` is `회계 시스템`; the header has no `알림`/notification button.
- [ ] **Step 2: Run** `pnpm test src/lib/nav.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `metadata.title = "회계 시스템"`. `Breadcrumbs` renders `breadcrumbTrail(usePathname())`. Remove `<Notifications />` from the header.
- [ ] **Step 4: Run** `pnpm test` and `pnpm exec playwright test e2e/smoke.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "chore(shell): Korean breadcrumbs, app title, drop mock notifications"`

### Task 2: Money helpers + chart of accounts

**Files:**
- Create: `src/lib/money.ts`, `src/lib/accounts.ts`, `src/server/accounts/standard-chart.ts`, `src/server/accounts/service.ts`, `src/server/accounts/form.ts`, `src/app/(dashboard)/admin/accounts/actions.ts`, `src/components/admin/accounts/*`
- Modify: `src/server/db/schema.ts`, `tests/helpers/db.ts`, `scripts/seed.ts`, `src/app/(dashboard)/admin/accounts/page.tsx` (replace placeholder)
- Test: `src/lib/money.test.ts`, `src/lib/accounts.test.ts`, `src/server/accounts/service.test.ts`, `src/server/seed.test.ts` (extend), `e2e/admin-accounts.spec.ts`

**Interfaces:**
- Produces:
  - `MAX_WON = 999_999_999_999`; `parseWon(input: string): number | null` (strips spaces, commas, a trailing `원`; accepts only digits after that; `null` for empty, non-integer, negative, or `> MAX_WON`); `formatWon(n: number): string` (`1234000` → `"1,234,000"`)
  - `type AccountGroup = "current_asset" | "noncurrent_asset" | "current_liability" | "noncurrent_liability" | "equity" | "revenue" | "cost_of_sales" | "sga" | "non_operating_income" | "non_operating_expense" | "income_tax"`; `ACCOUNT_GROUP_LABELS` = 유동자산, 비유동자산, 유동부채, 비유동부채, 자본, 매출, 매출원가, 판매비와관리비, 영업외수익, 영업외비용, 법인세비용 (same order); `normalSideOf(g): "debit" | "credit"` (assets, cost_of_sales, sga, non_operating_expense, income_tax → debit; the rest credit); `suggestGroup(code: string): AccountGroup | null` from Douzone ranges: 101–175 current_asset, 176–250 noncurrent_asset, 251–290 current_liability, 291–330 noncurrent_liability, 331–400 equity, 401–450 revenue, 451–800 cost_of_sales, 801–900 sga, 901–950 non_operating_income, 951–997 non_operating_expense, 998–999 income_tax (a UI default only; the stored `group` is what counts)
  - pg enum `account_group` (values above); table `accounts`: `id integer generatedAlwaysAsIdentity pk`, `code text not null unique`, `name text not null`, `group account_group not null`, `requiresPartner boolean not null default false`, `isActive boolean not null default true`, `isSystem boolean not null default false`, `createdAt`/`updatedAt timestamptz`
  - `VAT_INPUT_CODE = "135"` (부가세대급금), `VAT_OUTPUT_CODE = "255"` (부가세예수금)
  - `type AccountRow = { id: number; code: string; name: string; group: AccountGroup; requiresPartner: boolean; isActive: boolean; isSystem: boolean }`
  - `listAccounts(db, opts?: { activeOnly?: boolean }): Promise<AccountRow[]>` (ordered by code); `createAccount(db, input: { code: string; name: string; group: AccountGroup; requiresPartner: boolean }): Promise<Result<AccountRow>>`; `updateAccount(db, id: number, patch: { name?: string; group?: AccountGroup; requiresPartner?: boolean; isActive?: boolean }): Promise<Result>`; `getVatAccountIds(db): Promise<{ inputAccountId: number; outputAccountId: number }>` (throws if missing)
  - `seedStandardAccounts(db): Promise<void>` — inserts `STANDARD_ACCOUNTS` with `isSystem: true`, `onConflictDoNothing` on code (safe to run on every deploy)

Standard chart (`STANDARD_ACCOUNTS`, exact; `*` = `requiresPartner: true`):

| group | accounts |
|---|---|
| current_asset | 101 현금, 102 당좌예금, 103 보통예금, 104 기타제예금, 105 정기예금, 106 정기적금, 107 단기매매증권, 108 외상매출금*, 109 대손충당금, 110 받을어음*, 111 대손충당금, 114 단기대여금*, 116 미수수익, 120 미수금*, 131 선급금*, 133 선급비용, 134 가지급금, 135 부가세대급금, 136 선납세금, 146 상품, 150 제품, 153 원재료 |
| noncurrent_asset | 179 장기대여금*, 201 토지, 202 건물, 203 감가상각누계액, 206 기계장치, 207 감가상각누계액, 208 차량운반구, 209 감가상각누계액, 212 비품, 213 감가상각누계액 |
| current_liability | 251 외상매입금*, 252 지급어음*, 253 미지급금*, 254 예수금, 255 부가세예수금, 257 가수금, 259 선수금*, 260 단기차입금*, 261 미지급세금, 262 미지급비용 |
| noncurrent_liability | 293 장기차입금*, 295 퇴직급여충당부채 |
| equity | 331 자본금, 375 이월이익잉여금, 377 미처분이익잉여금 |
| revenue | 401 상품매출, 404 제품매출 |
| cost_of_sales | 451 상품매출원가, 455 제품매출원가 |
| sga | 801 임원급여, 802 직원급여, 803 상여금, 806 퇴직급여, 811 복리후생비, 812 여비교통비, 813 기업업무추진비, 814 통신비, 815 수도광열비, 817 세금과공과, 818 감가상각비, 819 지급임차료, 820 수선비, 821 보험료, 822 차량유지비, 824 운반비, 825 교육훈련비, 826 도서인쇄비, 829 사무용품비, 830 소모품비, 831 지급수수료, 833 광고선전비, 835 대손상각비, 848 잡비 |
| non_operating_income | 901 이자수익, 903 배당금수익, 904 임대료, 907 외환차익, 930 잡이익 |
| non_operating_expense | 951 이자비용, 952 외환차손, 953 기부금, 980 잡손실 |
| income_tax | 998 법인세등 |

Rules and exact Korean errors: code must match `/^\d{3}$/` and be ≥ `101` → `계정코드는 101~999 사이의 3자리 숫자여야 합니다.`; duplicate → `이미 사용 중인 계정코드입니다.`; name trimmed, required → `계정명을 입력하세요.`; hiding `135` or `255` → `부가세 계정은 숨길 수 없습니다.`; unknown id → `계정과목을 찾을 수 없습니다.` Codes are immutable (no code in the update patch). There is no delete — hiding (`isActive=false`) replaces it.

- [ ] **Step 1: Failing tests.**
  - `money.test.ts`: `parseWon("1,234,000")`, `parseWon(" 1234000 ")`, `parseWon("1,234,000원")` → `1234000`; `parseWon("12.5")`, `parseWon("-3")`, `parseWon("")`, `parseWon("abc")`, `parseWon("1000000000000")` → `null`; `parseWon("0")` → `0` (callers decide if 0 is allowed); `formatWon(1234000)` → `"1,234,000"`.
  - `accounts.test.ts`: `suggestGroup("103")` → `current_asset`, `"212"` → `noncurrent_asset`, `"255"` → `current_liability`, `"813"` → `sga`, `"951"` → `non_operating_expense`, `"998"` → `income_tax`, `"099"` → `null`; `normalSideOf("sga")` → `debit`, `normalSideOf("revenue")` → `credit`.
  - `service.test.ts`: each rule above (exact strings); `seedStandardAccounts` twice → row count equals `STANDARD_ACCOUNTS.length`, every seeded row `isSystem`; every standard account's `group` equals `suggestGroup(code)` (guards the table above against typos); `listAccounts(db, { activeOnly: true })` omits a hidden account; `getVatAccountIds` returns the ids of 135/255.
  - `seed.test.ts`: after `seed()`, account `103` exists.
- [ ] **Step 2: Run** `pnpm test` → FAIL.
- [ ] **Step 3: Implement** schema + migration (`pnpm db:generate`), lib, service, `scripts/seed.ts` calling `seedStandardAccounts` (so the server picks the chart up on the next deploy), `resetDb` adds `accounts`. Form parsing in `form.ts` with zod like `src/server/users/form.ts`.
- [ ] **Step 4: Page `/admin/accounts`** (`settings:manage`): table 코드 · 계정명 · 구분 (`ACCOUNT_GROUP_LABELS`) · 거래처 필수 · 상태 (`사용`/`숨김`) with a group filter (`전체` + 11 groups) and a text filter on code/name; `계정 추가` dialog (코드, 계정명, 구분 select pre-filled by `suggestGroup` as the code is typed, 거래처 필수 switch); row `수정` dialog (계정명, 구분, 거래처 필수, 사용 switch). Same action/`useActionState`/echo-on-error pattern as `src/app/(dashboard)/admin/users/actions.ts`.
- [ ] **Step 5: e2e `e2e/admin-accounts.spec.ts`:** list shows `103 보통예금`; add an account named `E2E 회의비` with a code `8xx` that is not in the standard chart (pick random digits; retry with another code on `이미 사용 중인 계정코드입니다.` so re-runs against the same DB pass) — the 구분 select auto-selects `판매비와관리비` → the row appears; hide it → status `숨김`.
- [ ] **Step 6: Run** `pnpm test`, the new e2e, `pnpm lint` → PASS. **Commit** — `git commit -m "feat(accounts): Douzone standard chart, account admin, money helpers"`

### Task 3: Partners (거래처)

**Files:**
- Create: `src/server/partners/service.ts`, `src/server/partners/form.ts`, `src/app/(dashboard)/admin/partners/actions.ts`, `src/components/admin/partners/*`
- Modify: `src/server/db/schema.ts`, `tests/helpers/db.ts`, `src/app/(dashboard)/admin/partners/page.tsx`
- Test: `src/server/partners/service.test.ts`, `e2e/admin-partners.spec.ts`

**Interfaces:**
- Consumes: `normalizeBusinessNumber`, `isValidBusinessNumber`, `formatBusinessNumber` (`src/lib/business-number.ts`)
- Produces:
  - table `partners`: `id integer identity pk`, `name text not null`, `businessNumber text` (10 digits or null; **partial unique index** where not null), `representative text`, `phone text`, `email text`, `memo text`, `isActive boolean not null default true`, `createdAt`/`updatedAt`
  - `type PartnerRow = { id: number; name: string; businessNumber: string | null; representative: string | null; phone: string | null; email: string | null; memo: string | null; isActive: boolean }`; `type PartnerInput = Omit<PartnerRow, "id" | "isActive">`
  - `listPartners(db, opts?: { q?: string; activeOnly?: boolean }): Promise<PartnerRow[]>` (ordered by name; `q` matches name `ilike` or business-number digits)
  - `searchPartners(db, q: string, limit = 20): Promise<PartnerRow[]>` (active only; used by the voucher picker)
  - `createPartner(db, input: PartnerInput): Promise<Result<PartnerRow>>`; `updatePartner(db, id: number, input: PartnerInput & { isActive: boolean }): Promise<Result>`
  - Server Actions in `src/app/(dashboard)/admin/partners/actions.ts`: `createPartnerAction`, `updatePartnerAction` (both `settings:manage`), and **`quickCreatePartnerAction(input: { name: string; businessNumber: string }): Promise<Result<PartnerRow>>` guarded by `voucher:create`** — staff add a new partner from the voucher form without settings access.

Rules: name trimmed, required → `거래처명을 입력하세요.`; business number optional, stored as 10 digits, rejects stray characters and bad checksum → `사업자등록번호가 올바르지 않습니다.`; duplicate → `이미 등록된 사업자등록번호입니다.` (catch the unique violation, also when two requests race); empty optional strings stored as `null`.

- [ ] **Step 1: Failing service tests** — one per rule; `searchPartners(db, "220")` finds a partner with `2208162517`; `searchPartners` excludes inactive; two partners without a business number are allowed.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** schema/migration, service, actions, `resetDb` adds `partners`.
- [ ] **Step 4: Page `/admin/partners`** (`settings:manage`): search box, table 거래처명 · 사업자등록번호 (formatted) · 대표자 · 연락처 · 상태, `거래처 추가` / `수정` dialogs.
- [ ] **Step 5: e2e** — add partner `E2E 상사 <timestamp>` with `220-81-62517` the first time it is free (otherwise without a number); search finds it; deactivate → `중지`.
- [ ] **Step 6: Run** tests + lint → PASS. **Commit** — `git commit -m "feat(partners): partner master with business-number validation"`

### Task 4: Sites (사업장) and departments (부서)

**Files:**
- Create: `src/server/sites/service.ts`, `src/server/sites/form.ts`, `src/app/(dashboard)/admin/sites/actions.ts`, `src/components/admin/sites/*`
- Modify: `src/server/db/schema.ts`, `tests/helpers/db.ts`, `scripts/seed.ts`, `src/app/(dashboard)/admin/sites/page.tsx`
- Test: `src/server/sites/service.test.ts`, `src/server/seed.test.ts` (extend), `e2e/admin-sites.spec.ts`

**Interfaces:**
- Produces:
  - tables `sites` (`id integer identity pk`, `name text not null unique`, `businessNumber text`, `isActive boolean not null default true`, timestamps) and `departments` (`id integer identity pk`, `name text not null unique`, `isActive boolean not null default true`, timestamps)
  - `type SiteRow = { id: number; name: string; businessNumber: string | null; isActive: boolean }`; `type DepartmentRow = { id: number; name: string; isActive: boolean }`
  - `listSites(db, opts?: { activeOnly?: boolean })`, `createSite(db, { name, businessNumber })`, `updateSite(db, id, { name, businessNumber, isActive })`, `listDepartments(db, opts?)`, `createDepartment(db, { name })`, `updateDepartment(db, id, { name, isActive })` — all `Result`-returning except the lists
  - `ensureMainSite(db): Promise<void>` — inserts `본점` when the `sites` table is empty; called by `scripts/seed.ts`
  - `getEntryOptions(db): Promise<{ sites: SiteRow[]; departments: DepartmentRow[]; showSite: boolean; showDepartment: boolean }>` — active rows only; `showSite = sites.length > 1`, `showDepartment = departments.length > 0`

**Ruling on "사용 여부" (spec §5.1.1, §5.5):** expressed by data, not extra switches — the 사업장 field appears in voucher entry only when more than one active site exists, the 부서 field only when at least one active department exists. Every voucher line still stores a `siteId` (defaulting to the first active site by id), so nothing has to be migrated when a second site is added later.

Rules: names trimmed, required → `사업장명을 입력하세요.` / `부서명을 입력하세요.`; duplicate → `이미 있는 사업장명입니다.` / `이미 있는 부서명입니다.`; site business number optional, same validation and message as Task 3; deactivating the last active site → `활성 사업장이 최소 1개 있어야 합니다.`

- [ ] **Step 1: Failing tests** — each rule; `ensureMainSite` twice → exactly one `본점`; `getEntryOptions` with one site and no departments → `showSite false, showDepartment false`; after adding a second site and one department → both `true`; seed creates `본점`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (schema/migration, service, seed, `resetDb` adds `departments, sites`).
- [ ] **Step 4: Page `/admin/sites`** (`settings:manage`): two cards, `사업장` and `부서`, each a small table with add/edit dialogs (부서 card's empty state: `부서를 추가하면 전표 입력에 부서 항목이 나타납니다.`).
- [ ] **Step 5: e2e** — `본점` listed; add department `E2E부서 <timestamp>`, then deactivate it.
- [ ] **Step 6: Run** tests + lint → PASS. **Commit** — `git commit -m "feat(sites): sites and departments as optional voucher dimensions"`

### Task 5: Voucher types and the transaction-type builder (pure)

No DB, no UI — the rules for VAT and the shape of simple entries.

**Files:**
- Create: `src/lib/vouchers/types.ts`, `src/lib/vouchers/simple.ts`
- Test: `src/lib/vouchers/simple.test.ts`

**Interfaces:**
- Consumes: `MAX_WON` (Task 2)
- Produces (in `types.ts`):
  - `EntryType = "purchase" | "sale" | "transfer" | "general"`, labels `매입·비용`, `매출`, `입출금·대체`, `일반 전표`
  - `VoucherKind = "general" | "closing"`, labels `일반`, `결산` (1B only creates `general`; 1D uses `closing`)
  - `VoucherStatus = "pending" | "approved" | "rejected"`, labels `승인 대기`, `승인`, `반려`; `POSTED_STATUSES = ["approved"] as const`
  - `EvidenceType = "tax_invoice" | "invoice" | "card" | "cash_receipt" | "simple_receipt" | "none"`, labels `세금계산서`, `계산서`, `신용카드`, `현금영수증`, `간이영수증`, `증빙 없음`
  - `VatType = "taxable" | "zero_rated" | "exempt"`, labels `과세`, `영세`, `면세`
  - `Side = "debit" | "credit"`
  - `LineInput = { accountId: number; side: Side; amount: number; partnerId: number | null; siteId: number; departmentId: number | null; description: string }`
  - `VoucherHeaderInput = { date: string; description: string; entryType: EntryType; partnerId: number | null; evidenceType: EvidenceType; vatType: VatType | null; vatDeductible: boolean | null; supplyAmount: number | null; vatAmount: number | null }`
  - `VoucherInput = VoucherHeaderInput & { lines: LineInput[] }`
- Produces (in `simple.ts`):
  - `type TradeInput = { type: "purchase" | "sale"; date: string; description: string; mainAccountId: number; counterAccountId: number; partnerId: number | null; siteId: number; departmentId: number | null; evidenceType: EvidenceType; vatType: VatType; vatDeductible: boolean; supplyAmount: number; vatAmount: number }` — purchase: main = expense/asset account, counter = payment account; sale: main = revenue account, counter = receipt account
  - `type TransferInput = { type: "transfer"; date: string; description: string; debitAccountId: number; creditAccountId: number; amount: number; partnerId: number | null; siteId: number; departmentId: number | null; evidenceType: EvidenceType }`
  - `type SimpleInput = TradeInput | TransferInput`; `type VatAccounts = { inputAccountId: number; outputAccountId: number }`
  - `splitVatFromTotal(total: number): { supplyAmount: number; vatAmount: number }` — `vatAmount = Math.floor(total / 11)`, `supplyAmount = total - vatAmount` (원 미만 절사, the receipt-total convention) **[일반 관행 ruling]**
  - `defaultVat(supplyAmount: number): number` = `Math.floor(supplyAmount / 10)` (for tax invoices where supply is typed)
  - `buildSimpleVoucher(input: SimpleInput, vat: VatAccounts): Result<VoucherInput>`
  - `toSimpleInput(v: VoucherInput, vat: VatAccounts): SimpleInput | null` — inverse for the edit form; `null` for `general`

Lines the builder emits (in this order; every line gets the input's `partnerId`, `siteId`, `departmentId`, and `description`):
- **purchase:** debit `mainAccountId` = `supply` (+ `vat` when not deductible); debit `inputAccountId` = `vat` only when deductible and `vat > 0`; credit `counterAccountId` = `supply + vat`
- **sale:** debit `counterAccountId` = `supply + vat`; credit `mainAccountId` = `supply`; credit `outputAccountId` = `vat` when `vat > 0`
- **transfer:** debit `debitAccountId` = `amount`; credit `creditAccountId` = `amount`; header `vatType/vatDeductible/supplyAmount/vatAmount` = `null`
- trade header: `entryType = type`, `supplyAmount`, `vatAmount`, `vatType`, `evidenceType`, `partnerId`; `vatDeductible` = the input value for purchases, `null` for sales

VAT rules (checked in this order; exact messages):
1. `supplyAmount < 1` or `> MAX_WON`, or (transfer) `amount < 1` → `금액을 입력하세요.`; `vatAmount < 0` → `부가세가 올바르지 않습니다.`
2. `evidenceType = "invoice"` and `vatType ≠ "exempt"` → `계산서는 면세 거래에만 사용할 수 있습니다.`
3. `vatType` is `zero_rated` or `exempt` and `vatAmount > 0` → `영세·면세 거래는 부가세가 0원이어야 합니다.`
4. purchase with `evidenceType` in (`simple_receipt`, `none`) and `vatAmount > 0` → `간이영수증·증빙 없음은 부가세를 공제받을 수 없습니다. 합계를 공급가액으로 입력하세요.`
5. `vatAmount > supplyAmount` → `부가세가 공급가액보다 클 수 없습니다.`
(A sale with `none` evidence may still carry VAT — 무증빙 과세 매출도 부가세예수금이 생긴다.)

- [ ] **Step 1: Failing tests** (`simple.test.ts`, pure — use fake ids such as `vat = { inputAccountId: 9135, outputAccountId: 9255 }`, main `9811`, counter `9253`):
  - `splitVatFromTotal(11000)` → `{ supplyAmount: 10000, vatAmount: 1000 }`; `splitVatFromTotal(10000)` → `{ 9091, 909 }`; `defaultVat(10001)` → `1000`
  - card purchase, deductible, supply 9091 / vat 909 → 3 lines: debit main 9091, debit 135 909, credit counter 10000; debits = credits
  - same but `vatDeductible: false` → 2 lines: debit main 10000, credit counter 10000
  - purchase with vat 0 → no 135 line
  - sale taxable 100000/10000 → debit counter 110000, credit main 100000, credit 255 10000
  - transfer 50000 → 2 lines, VAT header fields `null`
  - each VAT rule message (one test each)
  - round trip: for each of the purchase/sale/transfer cases above, `toSimpleInput(buildSimpleVoucher(x).value, vat)` deep-equals `x`; `toSimpleInput` of a `general` voucher → `null`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vouchers): voucher types and VAT-splitting transaction builder"`

### Task 6: Voucher schema and service (create, update, delete, read, list, history)

**Files:**
- Create: `src/server/vouchers/service.ts`, `src/server/vouchers/form.ts` (zod schema for `VoucherInput` and `SimpleInput`)
- Modify: `src/server/db/schema.ts`, `tests/helpers/db.ts` (also add `seedReference(db)` helper: company row + `seedStandardAccounts` + `ensureMainSite`)
- Test: `src/server/vouchers/service.test.ts`

**Interfaces:**
- Consumes: Task 2 accounts, Task 3 partners, Task 4 sites/departments, Task 5 types, `getCompany` (1A), `SessionUser`, `can` (1A)
- Produces:
  - pg enums `voucher_kind`, `voucher_status`, `entry_type`, `evidence_type`, `vat_type`, `line_side`, `voucher_action` (`created | updated | deleted | approved | rejected | attached | detached`)
  - table `vouchers`: `id uuid pk defaultRandom`; `date date not null`; `no integer not null` (per-date sequence from 1); unique `(date, no)`; `kind voucher_kind not null default 'general'`; `entryType entry_type not null`; `description text not null default ''`; `partnerId integer references partners`; `evidenceType evidence_type not null default 'none'`; `vatType vat_type`; `vatDeductible boolean`; `supplyAmount bigint`; `vatAmount bigint`; `status voucher_status not null`; `rejectReason text`; `version integer not null default 1`; `createdBy uuid not null references users`; `updatedBy uuid not null references users`; `approvedBy uuid references users`; `approvedAt timestamptz`; `createdAt`/`updatedAt`; index on `date`
  - table `voucher_lines`: `id integer identity pk`; `voucherId uuid not null references vouchers on delete cascade`; `lineNo integer not null`; `accountId integer not null references accounts`; `side line_side not null`; `amount bigint not null` (check `amount > 0`); `partnerId integer references partners`; `siteId integer not null references sites`; `departmentId integer references departments`; `description text not null default ''`; indexes on `voucherId`, `accountId`, `partnerId`
  - table `voucher_history`: `id integer identity pk`; `voucherId uuid not null` (**no FK** — history outlives a deleted voucher); `action voucher_action not null`; `userId uuid not null references users`; `at timestamptz not null default now()`; `snapshot jsonb not null` (a `VoucherSnapshot`); `note text`; index on `voucherId`
  - in `src/lib/vouchers/types.ts` (client-safe, used by Task 7's `describeChanges`): `type VoucherAction = "created" | "updated" | "deleted" | "approved" | "rejected" | "attached" | "detached"` and `type VoucherSnapshot = VoucherInput & { no: number; status: VoucherStatus; attachments: string[] }` (attachment file names; empty until Task 9)
  - `type VoucherDetail = VoucherInput & { id: string; no: number; kind: VoucherKind; status: VoucherStatus; rejectReason: string | null; version: number; createdBy: { id: string; name: string }; updatedAt: Date; approvedBy: { id: string; name: string } | null; approvedAt: Date | null; lines: (LineInput & { account: { code: string; name: string }; partnerName: string | null; siteName: string; departmentName: string | null })[] }`
  - `type VoucherListRow = { id: string; date: string; no: number; entryType: EntryType; description: string; partnerName: string | null; amount: number /* debit total */; status: VoucherStatus; createdByName: string }`
  - `type HistoryEntry = { id: number; action: VoucherAction; userName: string; at: Date; snapshot: VoucherSnapshot; note: string | null }`
  - `createVoucher(db, actor: SessionUser, input: VoucherInput): Promise<Result<{ id: string }>>`
  - `updateVoucher(db, actor: SessionUser, id: string, version: number, input: VoucherInput): Promise<Result>`
  - `deleteVoucher(db, actor: SessionUser, id: string, version: number): Promise<Result>`
  - `getVoucher(db, id: string): Promise<VoucherDetail | null>`
  - `listVouchers(db, f: { from?: string; to?: string; status?: VoucherStatus; q?: string; page?: number }): Promise<{ rows: VoucherListRow[]; total: number }>` — 50 per page, newest date/no first; `q` matches description or partner name
  - `listHistory(db, voucherId: string): Promise<HistoryEntry[]>` (oldest first)
  - `canModify(actor: SessionUser, v: { createdBy: string }): boolean` = `can(actor.role, "voucher:create") && (v.createdBy === actor.id || can(actor.role, "voucher:approve"))`
  - `formatVoucherNo(date: string, no: number): string` → `"20261030-0001"` (put in `src/lib/vouchers/types.ts`)

Behaviour:
- Validation (exact messages, first failure wins): date is a real `YYYY-MM-DD` → `날짜가 올바르지 않습니다.`; fewer than 2 lines → `전표에는 2줄 이상이 필요합니다.`; any amount not an integer in `1..MAX_WON` → `금액은 1원 이상 1조 원 미만의 정수여야 합니다.`; debit total ≠ credit total → `차변 합계와 대변 합계가 일치하지 않습니다.`; unknown or hidden account → `사용할 수 없는 계정과목입니다.`; a line on a `requiresPartner` account without a partner → `<code> <name> 계정은 거래처를 입력해야 합니다.`; unknown/inactive partner, site or department → `사용할 수 없는 거래처, 사업장 또는 부서입니다.`; for `purchase`/`sale`/`transfer` entry types the header must also pass Task 5's VAT rules (re-run them server-side from `toSimpleInput`; if it returns `null` for a non-general type → `입력값이 올바르지 않습니다.`).
- **Hidden reference rule:** on update, an inactive account/partner/site/department is accepted on a line when the stored voucher already had that same id on a line; on create it is always rejected.
- Status on create and on any update: `approvalRequired ? "pending" : "approved"` (from `getCompany`); when it becomes `approved` this way, `approvedBy = actor`, `approvedAt = now`. An update clears `rejectReason`.
- Numbering: inside the create transaction take `pg_advisory_xact_lock(<int derived from the date, e.g. days since epoch>)`, then `no = coalesce(max(no), 0) + 1` for that date. Changing a voucher's date on update gives it the next number of the new date.
- Optimistic lock: update/delete with `where id = ? and version = ?`; zero rows → `다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.` (or `전표를 찾을 수 없습니다.` if the id is gone). Update sets `version = version + 1`, replaces all lines.
- Permission: `!canModify` → `이 전표를 수정할 권한이 없습니다.`
- History: one row per write in the same transaction, `snapshot` = the voucher **after** the change (for `deleted`, the state before deletion).

- [ ] **Step 1: Failing tests** (`beforeEach`: `resetDb`, `seedReference`, users `staff` + `manager`, partner `거래처A`):
  - create a balanced 2-line general voucher → `ok`, `getVoucher` returns it with `no = 1`, status `approved` (approval off), 1 history row `created`
  - each validation message above (one test each), including `108 외상매출금 계정은 거래처를 입력해야 합니다.`
  - purchase built by `buildSimpleVoucher` → saved; a purchase whose header claims `vatAmount 909` with `evidenceType: "simple_receipt"` → Task 5 rule 4 message
  - approval on (`updateCompany`) → new voucher `pending`, `approvedBy` null
  - `numbers per date`: three creates on `2026-10-30` → `no` 1, 2, 3; one on `2026-10-31` → `1`; **two concurrent creates** (`Promise.all`) on the same date → distinct numbers
  - `version conflict`: update with version 1 succeeds (version → 2); a second update with version 1 → conflict message; the first update's description is still stored
  - `keeps hidden account on existing line`: create with account `811`, hide `811`, update the description only → `ok`; a new voucher with `811` → `사용할 수 없는 계정과목입니다.`
  - staff cannot update or delete another staff member's voucher (message above); manager can
  - delete → `getVoucher` null, lines gone, history has `created` + `deleted` with the pre-delete snapshot
  - `listVouchers` filter by date range, status, and `q` (description and partner name); `total` counts all matches while `rows` is one page
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (schema/migration; `resetDb` order `voucher_history, voucher_lines, vouchers, ...`).
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vouchers): voucher schema and service with validation, numbering, optimistic lock, history"`

### Task 7: Voucher entry, list, detail, edit and history UI

**Files:**
- Create: `src/app/(dashboard)/vouchers/actions.ts`, `src/app/(dashboard)/vouchers/[id]/page.tsx`, `src/app/(dashboard)/vouchers/[id]/edit/page.tsx`, `src/lib/vouchers/history.ts`, `src/components/vouchers/` (`voucher-entry.tsx`, `trade-form.tsx`, `transfer-form.tsx`, `general-form.tsx`, `account-picker.tsx`, `partner-picker.tsx`, `money-input.tsx`, `voucher-list.tsx`, `voucher-detail.tsx`, `voucher-history.tsx`)
- Modify: `src/app/(dashboard)/vouchers/page.tsx`, `src/app/(dashboard)/vouchers/new/page.tsx` (replace placeholders)
- Test: `src/lib/vouchers/history.test.ts`, `e2e/vouchers.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–6; `quickCreatePartnerAction` (Task 3); `getEntryOptions` (Task 4)
- Produces:
  - Server Actions (typed object args, zod-validated in `src/server/vouchers/form.ts`): `createVoucherAction(input: unknown): Promise<Result<{ id: string }>>`, `updateVoucherAction(id: string, version: number, input: unknown): Promise<Result>`, `deleteVoucherAction(id: string, version: number): Promise<Result>`; `input` is either `{ mode: "simple", simple: SimpleInput }` (server builds with `buildSimpleVoucher` + `getVatAccountIds`) or `{ mode: "general", voucher: VoucherInput }`. Create/update/delete require `voucher:create`; each revalidates `/vouchers` and `/vouchers/<id>`.
  - `describeChanges(prev: VoucherSnapshot, next: VoucherSnapshot, names: { account: (id: number) => string; partner: (id: number | null) => string }): string[]` — Korean one-liners, e.g. `날짜: 2026-10-30 → 2026-10-31`, `적요: 점심 → 회식`, `금액: 10,000 → 12,000` (debit total), `거래처: 없음 → 거래처A`, `분개 줄 변경` when lines differ otherwise, `상태: 승인 대기 → 승인`; empty list when nothing differs

Pages:
- **`/vouchers/new`** (`voucher:create`): tabs `매입·비용` (default) · `매출` · `입출금·대체` · `일반 전표`. Common fields: 날짜 (default today, Asia/Seoul), 적요; 사업장/부서 selects only when `getEntryOptions` says so.
  - 매입·비용 / 매출 (`trade-form.tsx`): 계정 (picker; purchase lists sga, cost_of_sales, non_operating_expense, current_asset, noncurrent_asset groups; sale lists revenue and non_operating_income), 결제/입금 계정 (picker; shows `101 현금`, `103 보통예금`, `253 미지급금` (purchase) / `108 외상매출금` (sale) first, then other asset/liability accounts), 거래처 (picker with `새 거래처 추가` inline → `quickCreatePartnerAction`), 증빙 (select, default `신용카드` for purchase, `세금계산서` for sale), 과세 구분 (select, default `과세`; forced to `면세` when 증빙 = 계산서), 공제 여부 switch (purchase only, default on, hidden when 증빙 is 간이영수증/증빙 없음), amount: `합계` input which fills 공급가액/부가세 via `splitVatFromTotal`, both still editable (editing 공급가액 re-fills 부가세 with `defaultVat`). A live preview table shows the lines that will be saved (차변/대변, account, amount) — the user sees the journal entry without having to compose it.
  - 입출금·대체: 차변 계정, 대변 계정, 금액, 거래처, 증빙.
  - 일반 전표: rows of 계정 · 차변 · 대변 · 거래처 · 적요 (enter one of 차변/대변 per row), `줄 추가`, 차변 합계 / 대변 합계 / 차액 footer; `저장` disabled while 차액 ≠ 0 or fewer than 2 filled rows.
  - On successful save: toast `저장되었습니다.` with a link `전표 보기`, the form resets but **keeps the tab, date, and 사업장/부서** (fast repeated entry, spec §2 실패 기준). Errors show above the save button; the entered values stay.
  - `money-input.tsx`: shows thousands separators while typing, parses with `parseWon`, inline error `금액을 올바르게 입력하세요.`
- **`/vouchers`** (`ledger:view`): filters 기간 (default this month), 상태 (`전체`/`승인 대기`/`승인`/`반려`), 검색; table 일자 · 번호 (`formatVoucherNo`) · 유형 · 적요 · 거래처 · 금액 · 상태 · 작성자; row click → detail; pagination; `전표 입력` button for `voucher:create` users.
- **`/vouchers/[id]`** (`ledger:view`; `notFound()` for unknown or malformed ids): header facts (번호, 일자, 유형, 증빙, 과세 구분, 공급가액/부가세, 상태 badge, 작성자, 승인자), lines table with 차변/대변 columns and totals, `수정` / `삭제` (confirm dialog) when `canModify`, history section (`voucher-history.tsx`: each entry = action label, user, time, and `describeChanges` against the previous entry's snapshot).
- **`/vouchers/[id]/edit`** (`voucher:create` + `canModify`, else redirect to the detail page): the same entry component, opened on the tab matching `entryType`, prefilled through `toSimpleInput` (or the lines for `general`), passing `version`; tabs other than the voucher's own type are disabled.

- [ ] **Step 1: Failing tests** — `history.test.ts`: date change, description change, amount change, partner change, status change each produce the exact line above; identical snapshots → `[]`.
- [ ] **Step 2: Failing e2e `e2e/vouchers.spec.ts`** (as admin; approval off):
  - 매입·비용: 계정 `811 복리후생비`, 결제 `253 미지급금`, new partner `E2E카드 <timestamp>` created inline, 증빙 신용카드, 합계 `10,000` → preview shows `909` on `135 부가세대급금`; save → toast; list shows the voucher with 금액 `10,000` and 상태 `승인`
  - 일반 전표 with 차변 1,000 / 대변 900 → 저장 disabled and 차액 `100` shown
  - open the purchase, `수정` → change 적요 → save → detail history shows `적요: … → …`
  - `삭제` → confirm → gone from the list
- [ ] **Step 3: Implement**, reading `node_modules/next/dist/docs/` for dynamic route params (`params` is a Promise in Next 16) and `notFound`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm exec playwright test e2e/vouchers.spec.ts e2e/smoke.spec.ts`, `pnpm lint` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vouchers): transaction-type entry, general entry, list, detail, edit, history"`

### Task 8: Approval

**Files:**
- Modify: `src/server/vouchers/service.ts`, `src/app/(dashboard)/vouchers/actions.ts`, `src/server/company/service.ts`, `src/app/(dashboard)/admin/company/actions.ts`, `src/components/vouchers/voucher-detail.tsx`, `src/components/vouchers/voucher-list.tsx`, `src/app/(dashboard)/vouchers/page.tsx`
- Test: `src/server/vouchers/approval.test.ts`, `src/server/company/service.test.ts` (extend), `e2e/vouchers-approval.spec.ts`

**Interfaces:**
- Produces: `approveVoucher(db, actor: SessionUser, id: string, version: number): Promise<Result>`; `rejectVoucher(db, actor, id, version, reason: string): Promise<Result>`; `countPending(db): Promise<number>`; actions `approveVoucherAction(id, version)`, `rejectVoucherAction(id, version, reason)` (both `voucher:approve`); `updateCompany(db, input: Company, actorId?: string)` gains the optional actor.

Rules (exact messages): only `pending` vouchers can be approved/rejected → `승인 대기 중인 전표가 아닙니다.`; reject reason trimmed, required → `반려 사유를 입력하세요.`; actor lacking `voucher:approve` → `승인 권한이 없습니다.`; version check and history (`approved` / `rejected` with `note` = reason) as in Task 6. Self-approval is allowed **[ruling: small companies often have one manager; revisit per client]**. Approve sets `approvedBy`, `approvedAt`; reject sets `status = rejected`, `rejectReason`. A rejected voucher is edited (Task 6 update) back to `pending`.

Turning approval **off** (`approvalRequired` true → false in `updateCompany`): in the same transaction every `pending` voucher becomes `approved` (approvedBy = actor, history `approved` with note `전표 승인 기능 해제로 자동 승인`). Rejected vouchers stay rejected. Turning it on changes nothing that exists. **[ruling: keeps the posted rule a single `status = 'approved'` check for 1C/1D]**

UI: detail page shows `승인` and `반려` (dialog with 사유 textarea) to `voucher:approve` users when `pending`; a rejected voucher shows the reason in an alert. `/vouchers` shows `승인 대기 N건` (link to the `승인 대기` filter) to `voucher:approve` users when approval is on and N > 0.

- [ ] **Step 1: Failing tests** — each rule; approve → status/approvedBy/history; reject → reason stored; editing a rejected voucher → `pending` and reason cleared; `countPending`; company toggle off → pending vouchers approved with the history note, rejected untouched.
- [ ] **Step 2: Failing e2e** — admin turns approval on (company page), creates a voucher → `승인 대기`; banner `승인 대기 1건` (count ≥ 1); approves it → `승인`; creates another, rejects with reason `증빙 누락` → detail shows the reason; finally turns approval off again (restore state for other specs).
- [ ] **Step 3: Implement. Step 4: Run** tests, e2e, lint → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vouchers): approve/reject flow and approval toggle handling"`

### Task 9: Evidence attachments

**Files:**
- Create: `src/server/attachments/storage.ts`, `src/server/attachments/service.ts`, `src/app/api/attachments/[id]/route.ts`, `src/components/vouchers/voucher-attachments.tsx`
- Modify: `src/server/db/schema.ts`, `tests/helpers/db.ts`, `src/app/(dashboard)/vouchers/actions.ts`, `src/server/vouchers/service.ts` (delete removes files; snapshots list attachment names), `next.config.ts`, `.env.example` (comment for `UPLOAD_DIR`), `docs/deploy.md` (backup note)
- Test: `src/server/attachments/storage.test.ts`, `src/server/attachments/service.test.ts`, `e2e/vouchers-attachments.spec.ts` (+ fixture `e2e/fixtures/receipt.png`, a tiny real PNG)

**Interfaces:**
- Produces:
  - table `voucher_attachments`: `id uuid pk defaultRandom`, `voucherId uuid not null references vouchers on delete cascade`, `fileName text not null` (original, for display), `mimeType text not null`, `size integer not null`, `storagePath text not null` (relative to the upload root), `uploadedBy uuid not null references users`, `createdAt`; index on `voucherId`
  - `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`; `sniffType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null` — JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WEBP `RIFF` + 4 bytes + `WEBP`; PDF `%PDF-`
  - `uploadRoot(): string` = `process.env.UPLOAD_DIR ?? path.resolve("uploads")` (the Docker runner's `/app/uploads` volume already exists and is owned by the app user)
  - `addAttachment(db, actor: SessionUser, voucherId: string, file: { name: string; bytes: Uint8Array }): Promise<Result<{ id: string }>>`; `removeAttachment(db, actor, attachmentId: string): Promise<Result>`; `listAttachments(db, voucherId): Promise<{ id: string; fileName: string; mimeType: string; size: number; createdAt: Date }[]>`; `getAttachmentFile(db, id): Promise<{ fileName: string; mimeType: string; absolutePath: string } | null>`
  - actions `uploadAttachmentAction(voucherId: string, fd: FormData)` (`file` field; `voucher:create` + `canModify`), `removeAttachmentAction(id: string)`

Rules (exact): size `> MAX_ATTACHMENT_BYTES` → `파일은 10MB 이하여야 합니다.`; empty file or `sniffType` null → `JPG, PNG, WEBP, PDF 파일만 첨부할 수 있습니다.` (the browser-sent type and the extension are ignored); permission as `canModify` → `이 전표를 수정할 권한이 없습니다.` Stored at `<root>/<yyyy>/<mm>/<uuid>.<ext from sniffed type>` — the original name never reaches the filesystem path. Write the file, then insert the row + history (`attached`, note = file name) in a transaction; if the transaction fails, unlink the file. Remove: delete the row + history (`detached`) in a transaction, then unlink (ignore `ENOENT`). Deleting a voucher unlinks its files after the transaction commits. Attachments do not change voucher `status` or `version`.

Download route `GET /api/attachments/[id]`: `verifySession()`; without `ledger:view` → `403`; unknown id → `404`; body streamed from disk with `Content-Type` = stored type, `Content-Disposition: inline; filename*=UTF-8''<encodeURIComponent(fileName)>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.

`next.config.ts`: `experimental.serverActions.bodySizeLimit = "11mb"` (per `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`; the default 1MB would reject phone photos).

- [ ] **Step 1: Failing tests** — `sniffType` for each signature, for HTML text (`<html>`) → null, for a PE header `MZ` → null; service (with `UPLOAD_DIR` set to a temp dir per test file): PNG upload stores the file under `yyyy/mm/` with `.png`, row + `attached` history; an HTML payload named `receipt.jpg` → rejected; 10MB + 1 byte → size message; staff cannot attach to another staff member's voucher; remove deletes the file and writes `detached`; `deleteVoucher` removes the files.
- [ ] **Step 2: Failing e2e** — on a new voucher's detail page upload `e2e/fixtures/receipt.png` → it is listed; its link returns `200` with `content-type: image/png` and `x-content-type-options: nosniff`; a logged-out request to the same URL does not return the file; remove → gone.
- [ ] **Step 3: Implement**; UI on the detail page: `증빙` card listing files (name, size, 미리보기 link opening the route in a new tab, `삭제` for `canModify`), file input `accept="image/jpeg,image/png,image/webp,application/pdf"` with camera capture allowed on phones. Add to `docs/deploy.md` §5 that `uploads` lives in the Docker volume `acts_uploads` and must be backed up with `docker run --rm -v acts_uploads:/u -v "$PWD/backups":/b alpine tar czf /b/uploads-$(date +%F).tgz -C /u .` (and add that line to `scripts/backup.sh`, keeping its 30-day pruning for `uploads-*.tgz` too).
- [ ] **Step 4: Run** tests, e2e, lint → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(vouchers): evidence attachments with content sniffing and protected download"`

### Task 10: Regression, docs, deploy

**Files:**
- Modify: `CLAUDE.md` (Project line → Phase 1B; mention `src/lib/vouchers/simple.ts` builder, posted rule, uploads), `docs/superpowers/specs/…` untouched

- [ ] **Step 1: Full regression** — `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e` (known flaky template showcase specs may be re-run individually; anything else failing blocks).
- [ ] **Step 2: Commit + push** — `git commit -m "docs: update CLAUDE.md for phase 1B" && git push`
- [ ] **Step 3: Deploy (confirm with the user first)** — on the server (`/c/Windows/System32/OpenSSH/ssh.exe approid@192.168.219.174` from this PC; the Git Bash ssh cannot use the passphrase key): `cd ~/acts && git pull && docker compose --profile prod up -d --build`; the `migrate` service applies the new migrations and seeds the standard chart and `본점`. Verify through `https://acts.approid.team` (the user passes Cloudflare Access): `/admin/accounts` lists the chart, a test voucher with a photo attachment saves and downloads, then delete it. Run `bash scripts/backup.sh` once and check both the DB dump and the uploads archive appear.
