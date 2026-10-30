# Phase 1D — Executive Dashboard · Month Close · Opening Balances · 결산 Vouchers · Year Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the executive the "어제까지" dashboard (B안: profit + cash). Let the admin close months so booked numbers stop moving. Let a company that adopts mid-year enter its opening balances. Let staff record the 세무사's year-end adjustments as 결산 vouchers. Close a fiscal year once its year-end numbers have been reconciled with the 세무사's filed statements.

**Architecture:**
- **Dashboard:** reuses the 1C report core (`accountTotals`, the statement builders). Three dashboard figures need to know which accounts are "cash", "receivable" and "payable". That classification is a new account column, not hard-coded codes.
- **Month close:** a `period_closes` table. Every voucher write takes a shared per-month advisory lock and refuses closed months. Closing takes the exclusive lock.
- **Opening balances:** exactly one voucher of the new kind `opening`, dated on the adoption cut-off. No regular voucher may be dated on or before that day, so nothing is ever double counted.
- **Year close:** no carry-forward voucher (1C "Notes for Phase 1D"). Balance-sheet accounts already roll forward because reports accumulate from the beginning of time. The year close is a lock plus a reconciliation of system figures against the 세무사's figures.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM 0.45 · recharts 3.8 (via `src/components/ui/chart.tsx`) · Vitest · Playwright.

**Spec:** [docs/superpowers/specs/2026-10-29-accounting-tax-system-design.md](../specs/2026-10-29-accounting-tax-system-design.md)
- §4: pending count for approvers
- §5.1.1: 사업장/부서 filter on dashboards
- §5.1.2: month close
- §5.1.3: opening balances
- §5.3: dashboard B안
- §5.4: 결산 vouchers, 연도 이월

**Binding notes:** the "Notes for Phase 1D" section at the end of [the 1C plan](2026-10-30-phase-1c-ledgers-reports.md).
**Mockup:** `.superpowers/brainstorm/2000-1793277344/content/ceo-dashboard.html`, B안. It has four headline numbers, the monthly P&L trend, and the 자산·부채·자본 summary, all "YYYY-MM-DD 마감 기준".

## Global Constraints

- Everything in the 1A–1C Global Constraints still applies:
  - Korean UI copy, the posted rule via `POSTED_STATUSES`, integer won, `YYYY-MM-DD` strings, and Asia/Seoul "today" (`todayInSeoul`).
  - No hard-coded account codes in logic. Only `135` and `255` are allowed.
  - Line-level 사업장/부서 filters.
- **1D notes (binding):**
  - `closing` vouchers are ordinary adjusting entries and stay in every report.
  - Never post a P&L-zeroing 집합손익 대체 voucher.
  - Never post carry-forward or opening vouchers for balances already in the system.
  - The only `opening` voucher is for history from before adoption.
- **"어제"** = `addDays(todayInSeoul(), -1)`. The dashboard's default as-of date is 어제.
- **Permissions** (existing matrix in `src/lib/permissions.ts`):
  - dashboard: `overview:view`
  - month close, reopen, opening balances, year close: `period:close` (admin)
  - 결산 vouchers: `voucher:create`
- **Locks:** voucher writes already take, in this order:
  1. company `FOR SHARE`
  2. the voucher row `FOR UPDATE`
  3. the numbering advisory lock

  The new period lock is taken **first** in every voucher-writing transaction, before any of those. It is one global key, `pg_advisory_xact_lock_shared(PERIOD_LOCK, 0)`. Close and reopen take `pg_advisory_xact_lock(PERIOD_LOCK, 0)` and no row locks. `PERIOD_LOCK` is a new constant distinct from `NUMBERING_LOCK`.
- **Month close is a watermark — "closed through M"** (amended after the Task 3 review). A month counts as closed when any `period_closes` row has `month ≥` it. Writes into an earlier month that is empty and not explicitly closed are refused too, because they would move balance-sheet and year-to-date figures as of M. Closing M still requires every earlier month **that has vouchers** to be explicitly closed, so each one is reviewed and has no pending vouchers. Reopen works on the latest explicit close only.
- **Exact messages:**
  - closed month: `마감된 월(YYYY-MM)의 전표는 추가·수정·삭제할 수 없습니다.`
  - date on or before the opening cut-off: `기초잔액 기준일(YYYY-MM-DD) 이후 날짜만 입력할 수 있습니다.`

## Review Focus

1. **A write into a closed month from any path** must be refused with the closed-month message, and nothing must change. Paths: create; update moving a voucher *into* or *out of* a closed month; delete; approve; reject; attach; detach; saving opening balances. → Task 3 test `every write path respects month close`.
2. **Close and reopen order:**
   - a later month cannot be closed while an earlier month that has vouchers is still open;
   - only the most recently closed month can be reopened;
   - a month inside a closed fiscal year cannot be reopened.

   → Task 3 and Task 7 tests.
3. **The dashboard on the 1st of a month and on the first day of a fiscal year.**
   - On 2026-11-01, "이번 달" means October.
   - On 2027-01-01 with a January fiscal year, the trend shows all of 2026, not an empty 2027.

   → Task 6 test `as-of yesterday crosses month and fiscal-year boundaries`.
4. **Opening balances:**
   - totals that don't balance;
   - a partner breakdown on a `requiresPartner` account;
   - a cut-off on or after an existing voucher's date;
   - saving twice, which must replace, not duplicate.

   Each gives its exact message or behaviour. → Task 5 tests.
5. **A voucher saved concurrently with closing its month:** either the save fails with the closed-month message, or the close sees the voucher. A posted voucher never appears in a month after it was closed, and a pending voucher never appears in a closed month. → Task 3 test `close races a write` (`Promise.all`).

---

## File Structure

```
src/lib/money.ts                       # + formatKoreanShort (Task 6)
src/lib/accounts.ts                    # + DashboardRole, labels (Task 2)
src/server/closing/periods.ts          # month close, assertMonthsOpen (Task 3)
src/server/closing/opening.ts          # opening balances (Task 5)
src/server/closing/year.ts             # fiscal-year close + reconciliation (Task 7)
src/server/dashboard/service.ts        # getDashboard (Task 6)
src/server/reports/totals.ts           # + accountTotalsByMonth (Task 6)
src/app/(dashboard)/closing/page.tsx   # month close screen (Task 3)
src/app/(dashboard)/closing/opening/page.tsx  # tabs: 기초잔액 (Task 5) · 연도 이월 (Task 7)
src/app/(dashboard)/overview/page.tsx  # dashboard (Task 6)
src/components/{closing,dashboard}/    # UI
```

---

### Task 1: 1C carry-over

**Files:**
- Modify:
  - `src/server/auth/service.ts`
  - `src/server/vouchers/service.ts`
  - `src/server/vouchers/snapshot.ts` (approvedAt)
  - `src/server/reports/ledgers.ts`
  - `src/app/(dashboard)/ledgers/accounts/page.tsx`
  - `playwright.config.ts`
- Test:
  - `src/server/auth/service.test.ts`
  - `src/server/reports/ledgers.test.ts`

Changes:
1. **DB clock.** `users.updatedAt` written on login (`auth/service.ts`) and every `approvedAt` write use `sql\`now()\`` instead of a JS `Date`. The injected `now` stays only for the lockout arithmetic.
2. **P&L ledgers stay inside one fiscal year** (1C note M1).
   - Applies to `getAccountLedger` (and `getPartnerSummary`) for a P&L-group account whose `[from, to]` crosses a fiscal-year start.
   - `from` is moved up to `fiscalYearStart(to)`, and the result carries `{ clampedFrom: string | null }` (`null` when nothing changed).
   - The account-ledger page shows `손익 계정은 회계연도 단위로 조회합니다. (<clampedFrom>부터)` when `clampedFrom` is set.
   - The Excel export uses the same service, so it follows automatically.
3. **Template specs must stop blocking app specs.** Add a Playwright project `showcase` matching `e2e/(components|dashboards|apps)-*.spec.ts`. The `chromium` project ignores those files. `settings-serial` depends on `chromium` only, so showcase failures can no longer skip the settings projects.

- [ ] **Step 1: Failing tests.**
  - After a successful login, `users.updatedAt` ≥ the DB `now()` taken just before.
  - An 811 ledger for `2025-07-01..2026-06-30` (fiscal year starts in January) returns `clampedFrom: "2026-01-01"`, and its rows start in 2026.
  - A 103 ledger over the same range is not clamped.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run.**
  - `pnpm test` and `pnpm lint` → PASS.
  - `pnpm exec playwright test --list` shows the template specs only under `showcase`.
- [ ] **Step 5: Commit:** `git commit -m "chore: DB-clock timestamps, fiscal-year P&L ledgers, separate showcase e2e project"`

### Task 2: Account dashboard roles

**Files:**
- Modify:
  - `src/server/db/schema.ts`
  - `src/lib/accounts.ts`
  - `src/server/accounts/{service,form,standard-chart}.ts`
  - `src/components/admin/accounts/*`
- Create: a custom data migration (see Step 3)
- Test: `src/server/accounts/service.test.ts`, `e2e/admin-accounts.spec.ts` (extend)

**Interfaces:**
- Produces:
  - pg enum `dashboard_role` = `cash | receivable | payable`
  - column `accounts.dashboard_role` (nullable, SQL name `dashboard_role`, TS `dashboardRole`)
  - `type DashboardRole = "cash" | "receivable" | "payable"`
  - `DASHBOARD_ROLE_LABELS` = `{ cash: "현금·예금", receivable: "받을 돈", payable: "줄 돈" }`
  - `AccountRow` gains `dashboardRole: DashboardRole | null`
  - `createAccount` / `updateAccount` accept `dashboardRole`

Standard chart values (data, set in `STANDARD_ACCOUNTS`):
- `cash`: 101, 102, 103, 104, 105, 106
- `receivable`: 108, 110, 120
- `payable`: 251, 252, 253

- [ ] **Step 1: Failing tests.**
  - The seeded 103 has `dashboardRole: "cash"`, 108 has `receivable`, 253 has `payable`, and 811 has `null`.
  - `updateAccount` can set and clear the role.
  - e2e: the account edit dialog shows a `대시보드 구분` select with `없음` plus the three labels.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Run `pnpm db:generate` for the schema.
  - Then run `pnpm drizzle-kit generate --custom --name dashboard_roles` and write `UPDATE accounts SET dashboard_role = … WHERE is_system AND code IN (…)` for the three lists. This fills in the role on existing production rows, which the seed's `onConflictDoNothing` would leave alone.
  - Add the select to the account create and edit dialogs.
- [ ] **Step 4: Run** `pnpm db:migrate`, `pnpm test`, lint, and the e2e → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(accounts): dashboard roles for cash, receivables and payables"`

### Task 3: Month close

**Files:**
- Create:
  - `src/server/closing/periods.ts`
  - `src/app/(dashboard)/closing/actions.ts`
  - `src/components/closing/month-close-table.tsx`
- Modify:
  - `src/server/db/schema.ts`, `tests/helpers/db.ts`
  - `src/server/vouchers/service.ts`, `src/server/vouchers/snapshot.ts`, `src/server/attachments/service.ts`
  - `src/app/(dashboard)/closing/page.tsx`
  - `src/components/vouchers/voucher-detail.tsx`, `src/app/(dashboard)/vouchers/[id]/page.tsx`
- Test: `src/server/closing/periods.test.ts`, `e2e/closing.spec.ts` (runs in the `settings-serial` project: add it to that project's `testMatch`, and make `chromium` ignore it)

**Interfaces:**
- Produces:
  - table `period_closes`:
    - `month text pk` (`YYYY-MM`)
    - `closedBy uuid not null references users`
    - `closedAt timestamptz not null default now()`
  - `PERIOD_LOCK`, `monthOf(date: string): string`, `monthKey(month: string): number`
  - `assertMonthsOpen(tx, dates: string[]): Promise<string | null>`
    - Takes the global period lock `(PERIOD_LOCK, 0)` shared, then refuses any date whose month is at or before the watermark (latest `period_closes.month`).
    - Returns the closed-month message for the first closed month, else `null`.
  - `isMonthClosed(db, month: string): Promise<boolean>`
  - `type MonthStatus = { month: string; closed: boolean; closedAt: Date | null; closedByName: string | null; voucherCount: number; pendingCount: number; reopenable: boolean }`
  - `listMonthStatus(db, fiscalStart: string): Promise<MonthStatus[]>`: the 12 months of that fiscal year.
  - `closeMonth(db, actor: SessionUser, month: string): Promise<Result>`
  - `reopenMonth(db, actor: SessionUser, month: string): Promise<Result>`
  - Actions `closeMonthAction(month)` and `reopenMonthAction(month)`, both `period:close`.

Rules (exact messages):

| condition | message |
|---|---|
| actor lacks `period:close` | `마감 권한이 없습니다.` |
| malformed month | `입력값이 올바르지 않습니다.` |
| month ≥ the month of today (Seoul) | `아직 끝나지 않은 월은 마감할 수 없습니다.` |
| already closed | `이미 마감된 월입니다.` |
| an earlier month has vouchers (any status) and is open | `이전 월(YYYY-MM)을 먼저 마감하세요.` (YYYY-MM = the earliest such month) |
| pending vouchers in the month | `승인 대기 전표가 N건 있어 마감할 수 없습니다.` |
| reopen a month that isn't the latest closed | `가장 최근에 마감한 월부터 해제할 수 있습니다.` |
| reopen a month that isn't closed | `마감되지 않은 월입니다.` |

Close and reopen run in one transaction that takes the exclusive month lock first.

Enforcement: `assertMonthsOpen` is the first statement inside the transaction of each of these:
- `createVoucher` (the new date)
- `updateVoucher` (old and new date)
- `deleteVoucher` (stored date)
- `approveVoucher` / `rejectVoucher` (stored date)
- `addAttachment` / `removeAttachment` (the voucher's date)

Old dates come from a plain read before the transaction, then are re-checked against the locked row. If the locked row's date differs, return the conflict message.

UI:
- `/closing` shows the 12 months of a fiscal year, with `이전 연도` / `다음 연도` links (`?fy=YYYY-MM-DD` fiscal start).
- Columns: 월, 상태 (`마감` badge / `열림`), 전표 수, 승인 대기, 마감 일시·마감자.
- Per-row buttons: `마감` and `마감 해제`, each in a confirm dialog. Errors appear in a toast.
- The voucher detail page shows a `마감됨` badge for a voucher in a closed month and hides 수정, 삭제, 승인, 반려 and 증빙 추가/삭제. The service remains the gate.

- [ ] **Step 1: Failing tests** (`periods.test.ts`):
  - each rule above;
  - `every write path respects month close`: one voucher per path, then close the month, then each path returns the closed-month message and the DB is unchanged (row count, version, attachments);
  - update moving a voucher from an open month into a closed one, and out of a closed one, are both refused;
  - `close races a write`: `Promise.all([closeMonth(m), createVoucher(date in m)])`, then either the close failed or the voucher write failed. A voucher never ends up in a closed month after the close committed. Repeat 10 times.
  - e2e, in `e2e/closing.spec.ts`. The spec is serial and uses only fiscal year 2000 (company fiscal start month 1 in the e2e DB):
    - Create a voucher dated `2000-02-15`.
    - On `/closing?fy=2000-01-01`, close `2000-01` and then `2000-02`. 2000-01 may hold Task 5's opening voucher from an earlier run.
    - That voucher's detail page shows `마감됨` and no `수정`.
    - In `afterAll`, reopen `2000-02` and then `2000-01`, so that re-runs and other specs find fiscal year 2000 open.
    - No other spec dates vouchers in 2000.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, the e2e and lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(closing): month close with locked voucher writes"`

### Task 4: 결산 vouchers

**Files:**
- Modify:
  - `src/lib/vouchers/types.ts`, `src/lib/vouchers/history.ts`
  - `src/server/vouchers/{service,form}.ts`
  - `src/components/vouchers/{general-form,voucher-list,voucher-detail}.tsx`
  - `src/app/(dashboard)/vouchers/page.tsx`
- Test: `src/server/vouchers/service.test.ts`, `src/lib/vouchers/history.test.ts`, `e2e/vouchers.spec.ts` (extend)

**Interfaces:**
- `VoucherHeaderInput` gains `kind: "general" | "closing"`. The zod default is `"general"`.
- `listVouchers` filter gains `kind?: VoucherKind`.
- `describeChanges` adds `구분: 일반 → 결산`.

Rules:
- `kind: "closing"` requires `entryType: "general"` → `결산 전표는 일반 전표로만 입력합니다.`
- `kind: "opening"` is never accepted from `createVoucher`/`updateVoucher` → `입력값이 올바르지 않습니다.`
- A voucher's kind may change between `general` and `closing` on update.

UI:
- The 일반 전표 tab gets a `결산 전표` switch, with helper text `세무사 결산 수정 내역(감가상각·대손·미지급비용·법인세 등)을 입력할 때 켭니다.`
- The voucher list gets a 구분 filter (`전체` / `일반` / `결산` / `기초`) and a `결산` / `기초` badge in the 유형 column.
- The detail page shows 구분.

- [ ] **Step 1: Failing tests:**
  - closing + purchase → the message above;
  - closing + general → saved with `kind: closing`, and it counts in `getIncomeStatement` (an 818 감가상각비 closing voucher lowers 영업이익);
  - kind opening via `createVoucher` → invalid;
  - `listVouchers({ kind: "closing" })`;
  - history line;
  - e2e: enter a 결산 전표 (Dr 818 / Cr 213) and filter the list by `결산` to see it.
- [ ] **Step 2–4:** RED → implement → GREEN (`pnpm test`, the e2e, lint).
- [ ] **Step 5: Commit:** `git commit -m "feat(vouchers): 결산 (closing) vouchers"`

### Task 5: Opening balances (기초잔액)

**Files:**
- Create:
  - `src/server/closing/opening.ts`
  - `src/app/(dashboard)/closing/opening/actions.ts`
  - `src/components/closing/opening-form.tsx`
- Modify:
  - `src/server/db/schema.ts` (enum value + partial unique index)
  - `src/server/vouchers/service.ts`
  - `src/app/(dashboard)/closing/opening/page.tsx` (tabs `기초잔액` | `연도 이월`; the second tab is a placeholder until Task 7)
  - `src/app/(dashboard)/vouchers/[id]/edit/page.tsx`
- Test: `src/server/closing/opening.test.ts`, `e2e/closing.spec.ts` (extend; it runs serially)

**Interfaces:**
- Schema:
  - `voucher_kind` gains `opening`.
  - Partial unique index `vouchers_single_opening_uq` on `(kind) WHERE kind = 'opening'`.
- `type OpeningLine = { accountId: number; partnerId: number | null; balance: number /* signed: positive = the account's normal side */ }`
- `getOpening(db): Promise<{ voucherId: string | null; version: number | null; date: string | null; lines: OpeningLine[] }>`
- `getOpeningCutoff(db): Promise<string | null>`
- `saveOpening(db, actor: SessionUser, input: { date: string; version: number | null; lines: OpeningLine[] }): Promise<Result>`
- Action `saveOpeningAction(input: unknown)`, guarded by `period:close` and zod-parsed.

`saveOpening` rules, checked in this order (exact messages):

| # | condition | message |
|---|---|---|
| 1 | actor lacks `period:close` | `기초잔액 입력 권한이 없습니다.` |
| 2 | invalid date, or a balance that isn't an integer with `|balance| ≤ MAX_WON` | the 1B voucher messages for date and amount |
| 3 | lines with `balance === 0` | dropped |
| 4 | the debits and credits built from the signs don't match | `차변과 대변 합계가 일치하지 않습니다. (차액 <formatWon>원)` |
| 5 | a `requiresPartner` account line has no partner | `<code> <name> 계정은 거래처를 입력해야 합니다.` |
| 6 | a non-opening voucher is dated on or before `date` | `기초잔액 기준일은 첫 전표 날짜(YYYY-MM-DD)보다 앞서야 합니다.` |
| 7 | the month of `date`, or of the existing opening voucher's date, is closed | the closed-month message |

On save:
- Status is always `approved` (approvedBy = actor), whatever the approval setting **[ruling: entered once by the admin from verified records]**.
- Lines:
  - `side` = the account's normal side when `balance > 0`, else the opposite side;
  - `amount = |balance|`;
  - `siteId` = the first active site by id;
  - description `기초잔액`.
- Header: `kind: opening`, `entryType: general`, description `기초잔액`, and the VAT fields null.
- An existing opening voucher is replaced in place: version check, lines replaced, history `updated`. Otherwise one is created (history `created`).
- A concurrent second create hits the unique index and gets `다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.`

Voucher service changes:
- create and update of a non-opening voucher dated on or before `getOpeningCutoff` get the cut-off message from Global Constraints.
- `updateVoucher` / `deleteVoucher` on the opening voucher → `기초잔액은 기초잔액 화면에서 수정하세요.`
- The edit page for the opening voucher redirects to `/closing/opening`.

UI, tab `기초잔액`:
- Cut-off date input. It defaults to `addDays(fiscalYearStart(today), -1)` when no opening exists.
- Helper text: `시스템 도입 전 잔액만 입력합니다. 도입 이후 거래는 전표로 입력하세요.`
- A table of all active accounts, grouped by `AccountGroup` with group headers, each with a signed `잔액` money input.
- `requiresPartner` accounts expand to partner rows, added with the partner picker. The account row shows their read-only sum.
- Footer: 차변 합계, 대변 합계, 차액. `저장` is disabled while 차액 ≠ 0.
- P&L accounts are allowed, for year-to-date amounts when adopting mid-year.

- [ ] **Step 1: Failing tests:**
  - each rule;
  - save twice: one opening voucher, version 2, two history rows;
  - the trial balance as of the cut-off equals the entered balances (signs included, e.g. 213 감가상각누계액 entered as `-200,000`, which shows on the credit side);
  - after save, `createVoucher` dated on the cut-off → cut-off message, and dated the day after → ok;
  - `updateVoucher` on the opening voucher → its message.
  - e2e (same serial `closing.spec.ts`, before the month-close test):
    - Cut-off `2000-01-01`, the 1B date floor. Only this spec uses year 2000, and its vouchers are dated after the cut-off.
    - Admin enters 101 `1,000,000` and 331 `1,000,000`, saves, and sees `저장되었습니다.`
    - Re-runs replace the same opening voucher.
    - The opening voucher stays in the e2e DB. It is harmless, because every other spec's vouchers are dated after 2000-01-01.
- [ ] **Step 2–4:** RED → implement → GREEN (`pnpm db:generate`, `pnpm test`, e2e, lint).
- [ ] **Step 5: Commit:** `git commit -m "feat(closing): opening balances as a single pre-adoption voucher"`

### Task 6: Executive dashboard (B안)

**Files:**
- Create:
  - `src/server/dashboard/service.ts`
  - `src/components/dashboard/{metric-card,profit-trend-chart,position-summary}.tsx`
- Modify:
  - `src/lib/money.ts`
  - `src/server/reports/totals.ts`
  - `src/app/(dashboard)/overview/page.tsx`
- Test: `src/lib/money.test.ts`, `src/server/dashboard/service.test.ts`, `e2e/dashboard.spec.ts`

**Interfaces:**
- `formatKoreanShort(n: number): string`:
  - `|n| ≥ 1억` → `X억 Y,YYY만` (만 part truncated; omitted when 0);
  - `1만 ≤ |n| < 1억` → `Y,YYY만`;
  - otherwise `formatWon(n)원`;
  - negatives are prefixed with `-`.
  - Examples: `1_140_000_000` → `11억 4,000만`; `62_000_000` → `6,200만`; `300_000_000` → `3억`; `9_999` → `9,999원`; `-62_000_000` → `-6,200만`.
- `accountTotalsByMonth(db, f: { from: string; to: string; siteId; departmentId }): Promise<Map<string /* YYYY-MM */, AccountTotal[]>>`: one SQL query grouped by month and account, posted lines only.
- `type Dashboard`:
  - `asOf: string`, `month: string /* YYYY-MM of asOf */`, `fiscalStart: string`
  - `monthOperatingProfit: number` (Ⅴ. 영업이익 for `[first day of month, asOf]`)
  - `cash: number`, `receivable: number`, `payable: number`: the summed signed balances, as of `asOf`, of accounts with that `dashboardRole`
  - `trend: { month: string; revenue: number; operatingProfit: number; netProfit: number }[]`: every month from `fiscalStart` through `month`, including empty months as 0
  - `position: { assets: number; liabilities: number; equity: number }`: from `getBalanceSheet` as of `asOf`
  - `closing: { count: number; profitEffect: number }`: the 결산 vouchers posted in `[fiscalStart, asOf]` and their net P&L effect (Σ credit − debit on P&L accounts)
  - `lastClosedMonth: string | null`
- `getDashboard(db, f: { asOf: string; siteId: number | null; departmentId: number | null }): Promise<Dashboard>`

Page `/overview` (`overview:view`):
- The filter is a 기준일 control defaulting to 어제 (`to` param), plus 사업장/부서 (`getReportFilterOptions`).
- Header: `<asOf> 마감 기준`, and `마감 완료: <lastClosedMonth>` when set.
- Four metric cards, values via `formatKoreanShort` with the exact won in `title`:
  - `<M>월 누적 영업이익` → links to the income statement for the month
  - `현금·예금 잔액`
  - `받을 돈 (미수금)`
  - `줄 돈 (미지급금)`

  The last three link to the trial balance as of `asOf`.
- A `월별 손익 추이` chart: bars for 매출액, a line for 영업이익, months on the x-axis (`n월`), via `src/components/ui/chart.tsx` and recharts.
- A `재무상태 요약` with three figures, 자산 · 부채 · 자본, linking to the balance sheet.
- When `closing.count > 0`: `결산 반영 N건 (손익 영향 <formatKoreanShort>)`, linking to `/vouchers?kind=closing`.
- For approvers, when approval is on and pending > 0: the 1B `승인 대기 N건` banner.
- If a figure's role has no accounts (an admin cleared every `cash` role), the card shows `—` with the hint `계정과목에서 대시보드 구분을 지정하세요.`
- The implementer loads the `dataviz` skill before writing the chart.

- [ ] **Step 1: Failing tests:**
  - `formatKoreanShort` examples;
  - service:
    - cash, receivable and payable sum per role (103 + 101; 108; 253);
    - `monthOperatingProfit` covers only the month;
    - the trend has 0-filled months and correct revenue and operating profit per month;
    - the position identity `assets = liabilities + equity`;
    - closing count and effect;
  - `as-of yesterday crosses month and fiscal-year boundaries`:
    - asOf `2026-10-31` → month `2026-10`;
    - asOf `2026-12-31`, January fiscal year → trend covers 2026-01..2026-12;
    - fiscal start month 4 with asOf `2026-03-31` → trend covers 2025-04..2026-03;
  - e2e: as admin, `/overview` shows the four card titles and `월별 손익 추이`; the header contains `마감 기준`.
- [ ] **Step 2–4:** RED → implement → GREEN (`pnpm test`, e2e, lint).
- [ ] **Step 5: Commit:** `git commit -m "feat(dashboard): executive dashboard (profit and cash as of yesterday)"`

### Task 7: Fiscal-year close and 세무사 reconciliation (연도 이월)

**Files:**
- Create: `src/server/closing/year.ts`, `src/components/closing/year-close.tsx`
- Modify:
  - `src/server/db/schema.ts`, `tests/helpers/db.ts`
  - `src/server/closing/periods.ts` (reopen guard)
  - `src/app/(dashboard)/closing/opening/page.tsx` (tab `연도 이월`), `src/app/(dashboard)/closing/opening/actions.ts`
- Test: `src/server/closing/year.test.ts`, `e2e/closing.spec.ts` (extend)

**Interfaces:**
- Table `fiscal_year_closes`:
  - `fiscalStart date pk`
  - `closedBy uuid references users` (nullable; set on close)
  - `closedAt timestamptz` (nullable)
  - `taxFigures jsonb` (nullable): `{ totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number }`
- `type YearEnd = { fiscalStart: string; fiscalEnd: string; system: TaxFigures; tax: TaxFigures | null; closed: boolean; closedAt: Date | null; allMonthsClosed: boolean }`
  - `system` comes from `getBalanceSheet` as of `fiscalEnd` (자산총계, 부채총계, 자본총계) and `getIncomeStatement` for the fiscal year (Ⅹ. 당기순이익). No filters.
- `getYearEnd(db, fiscalStart: string): Promise<YearEnd>`
- `saveTaxFigures(db, actor, fiscalStart, figures: TaxFigures): Promise<Result>`
- `closeFiscalYear(db, actor, fiscalStart): Promise<Result>`
- `reopenFiscalYear(db, actor, fiscalStart): Promise<Result>`

Rules (exact messages):

| condition | message |
|---|---|
| no `period:close` | `마감 권한이 없습니다.` |
| close while any of the 12 months is open | `회계연도의 모든 월을 먼저 마감하세요.` |
| close when already closed | `이미 마감된 회계연도입니다.` |
| reopen a year that isn't the latest closed one | `가장 최근에 마감한 회계연도부터 해제할 수 있습니다.` |
| `reopenMonth` on a month inside a closed fiscal year | `회계연도 마감을 먼저 해제하세요.` |

Saving tax figures is allowed whether the year is open or closed. Closing is allowed with differences: the screen shows them and does not block **[ruling: the 세무사's figures can legitimately differ until the company enters their adjustments as 결산 vouchers]**.

UI, tab `연도 이월`:
- A fiscal-year selector.
- A table: 항목 (`자산총계`, `부채총계`, `자본총계`, `당기순이익`) · `시스템` · `세무사 신고` (inputs) · `차이` (red when ≠ 0).
- `세무사 금액 저장` and `회계연도 마감` / `마감 해제` buttons.
- Fixed explanation text: `재무상태표 잔액은 다음 연도로 자동으로 이어집니다. 별도의 이월 전표는 만들지 않습니다. 차이가 있으면 세무사 결산 수정 내역을 결산 전표로 입력한 뒤 다시 확인하세요.`

- [ ] **Step 1: Failing tests:**
  - each rule;
  - `system` figures equal the balance sheet and income statement for a seeded year;
  - the difference after `saveTaxFigures`;
  - `reopenMonth` blocked inside a closed year;
  - after closing year Y, the next year's balance sheet opens with Y's balances and the trial balance's `이월이익잉여금(전기 손익)` equals Y's net income (no voucher was created: the voucher count is unchanged);
  - e2e (in `closing.spec.ts`): select fiscal year 2000 on `연도 이월`, enter 세무사 figures that differ from the system figures, save, and see a non-zero `차이`. Don't close the year in e2e; the service tests cover closing.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit:** `git commit -m "feat(closing): fiscal-year close with 세무사 reconciliation"`

### Task 8: Regression, docs, deploy

- [ ] **Step 1:** Run `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm test:e2e` (all projects). Showcase flakes no longer block the settings projects; any other failure blocks.
- [ ] **Step 2:** Update `CLAUDE.md`:
  - Change the project line to Phase 1D.
  - Add one bullet on closing: month locks and their lock order; one `opening` voucher plus the cut-off rule; year close without carry-forward vouchers; dashboard roles on accounts.
  - Commit: `git commit -m "docs: update CLAUDE.md for phase 1D"`
- [ ] **Step 3 (confirm with the user first):**
  - `git push`.
  - On the server: `cd ~/acts && git pull && docker compose --profile prod up -d --build`.
  - Verify `/login` returns 200 locally on the server, and that the migrate logs show the custom `dashboard_roles` migration applied.
  - Run a read-only check: `select code, dashboard_role from accounts where dashboard_role is not null order by code` should list the 12 standard accounts.
  - The user then checks `/overview` through Cloudflare Access.
