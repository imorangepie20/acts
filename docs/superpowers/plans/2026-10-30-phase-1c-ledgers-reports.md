# Phase 1C — Journal · Ledgers · Trial Balance · Income Statement · Balance Sheet · Excel Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn posted vouchers into the books people actually read: the 분개장, the 계정별 원장 and the 거래처별 원장, plus the 합계잔액시산표, 손익계산서 and 재무상태표. Statements are laid out per 일반기업회계기준 and can be compared with the prior period. Every report can be filtered by 사업장/부서 and downloaded as Excel.

**Architecture:**
- One SQL aggregation service (`src/server/reports/`) reads posted voucher lines only (`status = 'approved'`), with optional site and department filters.
- Pure, DB-free builders in `src/lib/reports/` turn account totals into report rows (trial balance, income statement, balance sheet), so the accounting arithmetic is unit-tested without Postgres.
- Pages are thin server components under the existing placeholder routes. They share one filter bar and one search-param parser.
- Excel files come from a single route handler that renders a generic sheet spec with `exceljs`.
- Opening balances and year-end closing arrive in 1D. Until then, the profit of earlier fiscal years is shown as a computed equity line so that statements balance.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM 0.45 (postgres-js) · `exceljs` (new) · Vitest · Playwright.

**Spec:** [docs/superpowers/specs/2026-10-29-accounting-tax-system-design.md](../specs/2026-10-29-accounting-tax-system-design.md). Sections: §5.1.1 (사업장/부서 filter on every report), §5.2, §5.4 (codes in exports), §7 (performance, measure aggregation), §8 (일반기업회계기준).
**Previous plans:** [1A](2026-10-29-phase-1a-foundation-auth.md) (phase split table), [1B](2026-10-30-phase-1b-vouchers.md).

Out of scope (1D/1E): opening-balance entry, month close, closing vouchers UI, carry-forward, the dashboard, and the Smart A upload format. Reports must keep working unchanged once 1D adds closing vouchers (kind `closing`) — they are ordinary posted vouchers.

## Global Constraints

- Everything in 1A/1B Global Constraints still applies:
  - Korean UI copy, Base UI `render` prop, pnpm, ports 3710/5710, lint separate from build, Playwright on a production build.
  - Money is integer won (`bigint`, `mode: "number"`), never a float.
  - Dates are `YYYY-MM-DD` strings, and "today" means today in Asia/Seoul (`todayInSeoul` in `src/lib/vouchers/dates.ts`).
- **Posted rule:** reports read only lines of vouchers whose `status` is in `POSTED_STATUSES` (`src/lib/vouchers/types.ts`). Never hard-code `'approved'` in report SQL; import the constant.
- **Never hard-code account codes** in report logic. Grouping comes from `accounts.group` (`AccountGroup`, `src/lib/accounts.ts`). The sign comes from `normalSideOf(group)`.
- **Signed balance** of an account is `debit − credit` when `normalSideOf(group) === "debit"`, else `credit − debit`. A contra account therefore shows negative inside its section (e.g. 감가상각누계액 under 비유동자산), displayed as `-1,000`.
- **Fiscal year:** starts on day 1 of `company.fiscalYearStartMonth` (`getCompany`).
  - Balance-sheet-type groups (`current_asset`, `noncurrent_asset`, `current_liability`, `noncurrent_liability`, `equity`) accumulate from the beginning of time.
  - Profit-and-loss groups (`revenue`, `cost_of_sales`, `sga`, `non_operating_income`, `non_operating_expense`, `income_tax`) accumulate from the fiscal-year start.
  - **Prior-years profit** = Σ P&L (credit − debit) for posted lines dated before the current fiscal-year start. It appears as the computed row `이월이익잉여금(전기 손익)`.
  - **Current profit** = the same sum from the fiscal-year start through the as-of date. It appears as `당기순이익`.
  - When 1D posts closing vouchers that move P&L into 이월이익잉여금, both computed rows shrink naturally.
- **Filters:** `siteId` / `departmentId` filter individual lines (`voucher_lines.site_id` / `department_id`), not vouchers. Every report and every export accepts them.
- **Hidden accounts** (`isActive = false`) with activity still appear in every report. Accounts with no activity in the requested range are omitted from row lists.
- All amounts in report types are `number` (won). SQL `sum()` of `bigint` returns `numeric`; cast it to `bigint` and read it as a number (`mode: "number"` / `Number(...)`). Totals stay below 2^53 at this product's scale.

## Review Focus

1. **Contra and negative balances** (감가상각누계액 credit balance, an overdrawn 보통예금): these show as negative in their own section, never moved to the other side, and 자산총계 still equals 부채와자본총계. → Task 4 test `contra account stays in its section`.
2. **A fiscal year that does not start in January** (start month 4, as-of 2026-02-10):
   - the fiscal-year start is `2025-04-01`;
   - the prior-years / current split uses that start;
   - the prior-period comparison shifts by exactly one year;
   - 2028-02-29 shifts to 2027-02-28.

   → Task 2 `fiscal.ts` tests and Task 4 test `non-January fiscal year`.
3. **Pending and rejected vouchers** never move any number. Turning approval on after the fact does not hide vouchers that were already approved. → Task 2 test `only posted lines count`.
4. **A 사업장 filter** where one voucher's lines are split across two sites: each site's report shows only its own lines. When filtered debit and credit totals differ, the trial balance shows a `차액` notice instead of silently claiming balance. → Task 3 test `filtered trial balance can be unbalanced`.
5. **Excel opened in Korean Excel:**
   - the file name is Korean and correctly encoded;
   - amounts are numeric cells with a thousands format (summable, not text);
   - the header block shows company, report, period and filter.

   → Task 7 tests.

---

## File Structure

```
src/lib/uuid.ts                          # isUuid (Task 1)
src/lib/reports/fiscal.ts                # fiscalYearStart, priorYear, defaultPeriod (Task 2)
src/lib/reports/types.ts                 # ReportFilter, AccountTotal, row types (Task 2)
src/lib/reports/params.ts                # parseReportParams (search params → filter) (Task 2)
src/lib/reports/trial-balance.ts         # buildTrialBalance (Task 3)
src/lib/reports/statements.ts            # buildIncomeStatement, buildBalanceSheet (Task 4)
src/server/reports/totals.ts             # accountTotals, profitBetween (Task 2)
src/server/reports/service.ts            # getTrialBalance, getIncomeStatement, getBalanceSheet (Tasks 3-4)
src/server/reports/ledgers.ts            # getJournal, getAccountLedger, getPartnerSummary, getPartnerLedger (Tasks 5-6)
src/server/exports/{xlsx,specs}.ts       # renderXlsx, per-report SheetSpec (Task 7)
src/app/api/exports/[report]/route.ts    # Excel download (Task 7)
src/components/reports/                  # report-filters, money-cell, per-report tables
src/app/(dashboard)/{ledgers/*,reports/*}/page.tsx  # replace placeholders
```

---

### Task 1: 1B carry-over (shared uuid check, voucher date range, lean detail page)

**Files:**
- Create: `src/lib/uuid.ts`
- Modify:
  - `src/lib/nav.ts`
  - `src/app/(dashboard)/vouchers/[id]/page.tsx`
  - `src/app/(dashboard)/vouchers/[id]/edit/page.tsx`
  - `src/server/attachments/service.ts`
  - `src/server/vouchers/service.ts` (date range)
  - the detail page's partner/account name loading
- Test: `src/lib/uuid.test.ts`, `src/server/vouchers/service.test.ts` (extend)

**Interfaces:**
- Produces: `isUuid(s: string): boolean` in `src/lib/uuid.ts`, client-safe. All five former `UUID_RE` copies use it.

Rules:
- A voucher date must fall in the years `2000` through the current Seoul year + 1. Otherwise create and update return the existing message `날짜가 올바르지 않습니다.`.
- The detail page must not load every account and partner. It loads only the partner ids that appear in that voucher's history snapshots, and drops the unused account load.

- [ ] **Step 1: Failing tests.**
  - `isUuid` accepts a v4 uuid in either case.
  - `isUuid` rejects `"abc"`, a uuid with a trailing space, and `""`.
  - The service rejects `1999-12-31` and `<currentYear+2>-01-01` with the date message, and accepts `2000-01-01`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Replace the five copies of `UUID_RE`. Add a `listPartnersByIds(db, ids: number[]): Promise<PartnerRow[]>` to `src/server/partners/service.ts` for the detail page.
- [ ] **Step 4: Run** `pnpm test`, `pnpm lint`, and `pnpm exec playwright test e2e/vouchers.spec.ts` → PASS.
- [ ] **Step 5: Commit:** `git commit -m "refactor: shared isUuid, voucher date range, lean voucher detail"`

### Task 2: Report core — fiscal helpers, filter parsing, posted-line totals, filter bar

**Files:**
- Create:
  - `src/lib/reports/fiscal.ts`, `src/lib/reports/types.ts`, `src/lib/reports/params.ts`
  - `src/server/reports/totals.ts`
  - `src/components/reports/report-filters.tsx`, `src/components/reports/money.tsx`
- Modify: `src/server/db/schema.ts` (index, see below)
- Test: `src/lib/reports/fiscal.test.ts`, `src/lib/reports/params.test.ts`, `src/server/reports/totals.test.ts`

**Interfaces:**
- Consumes: `todayInSeoul`, `isIsoDate`, `monthRange` (`src/lib/vouchers/dates.ts`); `POSTED_STATUSES`; `getCompany`; `getEntryOptions` (for the filter bar's site/department options and show flags).
- Produces:
  - `fiscalYearStart(date: string, startMonth: number): string`
    - `("2026-10-30", 1)` → `"2026-01-01"`
    - `("2026-03-15", 4)` → `"2025-04-01"`
    - `("2026-04-01", 4)` → `"2026-04-01"`
  - `addDays(date: string, n: number): string`
  - `shiftYear(date: string, years: number): string`, clamping Feb 29 to Feb 28: `shiftYear("2028-02-29", -1)` → `"2027-02-28"`
  - `type Period = { from: string; to: string }`
  - `priorYearPeriod(p: Period): Period`: shift both ends by −1 year
  - `defaultPeriod(today: string, startMonth: number): Period`: fiscal-year start through today
  - `type ReportFilter = { from: string; to: string; siteId: number | null; departmentId: number | null }`
  - `parseReportParams(sp: Record<string, string | string[] | undefined>, today: string, startMonth: number): ReportFilter`
    - Rejects invalid `from`/`to`, falling back to `defaultPeriod`.
    - Swaps them when `from > to`.
    - Treats non-positive-integer `site`/`dept` as `null`.
    - Query keys are exactly `from`, `to`, `site`, `dept` (plus report-specific `account`, `partner`, `page`, parsed by the pages).
  - `type AccountTotal = { accountId: number; debit: number; credit: number }`
  - `accountTotals(db, f: { from: string | null; to: string; siteId: number | null; departmentId: number | null }): Promise<AccountTotal[]>`
    - Sums posted lines with voucher `date` between `from` (inclusive; `null` = no lower bound) and `to` (inclusive), grouped by account.
    - Accounts with zero debit and zero credit are omitted.
  - `profitBetween(db, f: same shape): Promise<number>`: Σ (credit − debit) over posted lines on P&L-group accounts. It may be a thin wrapper over `accountTotals` plus the account groups.
  - `<ReportFilters mode="period" | "asOf" … />`:
    - a GET form with 기간 (`from`–`to`) or 기준일 (`to` only), and 사업장 / 부서 selects shown under the same rule as voucher entry (`showSite`, `showDepartment`);
    - a 조회 submit button and an `엑셀 다운로드` link slot (href passed in by the page; wired in Task 7).
    - The filter keeps other query params (e.g. `account`) through hidden inputs.
  - `<Money value={number} />`: right-aligned `formatWon`, negative values prefixed `-` and colored `text-destructive`, zero rendered as `0`.
- Index: add a composite index `vouchers_status_date_idx` on `vouchers(status, date)` (`pnpm db:generate`). Task 8 measures whether more is needed.

- [ ] **Step 1: Failing tests.**
  - `fiscal.test.ts`: every example above. Also `defaultPeriod("2026-02-10", 4)` → `{ from: "2025-04-01", to: "2026-02-10" }` and `priorYearPeriod({ from: "2025-04-01", to: "2026-02-10" })` → `{ from: "2024-04-01", to: "2025-02-10" }`.
  - `params.test.ts`:
    - garbage `from` falls back;
    - `from > to` is swapped;
    - `site=abc` gives `null`;
    - `site=2` gives `2`;
    - array values use the first element.
  - `totals.test.ts` (`seedReference` plus 1B's voucher service to create data):
    - `only posted lines count`: approval on → a pending voucher and a rejected voucher contribute nothing, an approved one does;
    - the date bounds are inclusive and `from: null` includes everything before;
    - the site filter keeps only lines whose `siteId` matches, including a voucher whose two lines have different sites;
    - `profitBetween` for a 401 sale of 100,000 and an 811 expense of 30,000 → `70000`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Aggregate in one SQL query (join `voucher_lines` → `vouchers`, `where status in POSTED_STATUSES`).
- [ ] **Step 4: Run** `pnpm test`, `pnpm lint` → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(reports): fiscal periods, report filters, posted-line totals"`

### Task 3: 합계잔액시산표

**Files:**
- Create:
  - `src/lib/reports/trial-balance.ts`, `src/server/reports/service.ts`
  - `src/components/reports/trial-balance-table.tsx`
- Modify: `src/app/(dashboard)/reports/trial-balance/page.tsx`
- Test: `src/lib/reports/trial-balance.test.ts`, `src/server/reports/service.test.ts`, `e2e/reports.spec.ts` (new file, first case)

**Interfaces:**
- Consumes: Task 2; `listAccounts(db)` (all accounts, including hidden); `ACCOUNT_GROUP_LABELS`; `normalSideOf`.
- Produces:
  - `type TrialBalanceRow` =
    - `{ kind: "group"; label: string } |`
    - `{ kind: "account"; accountId: number; code: string; name: string; debitBalance: number; debitTotal: number; creditTotal: number; creditBalance: number } |`
    - `{ kind: "auto"; name: "이월이익잉여금(전기 손익)"; debitBalance; debitTotal; creditTotal; creditBalance } |`
    - `{ kind: "subtotal"; label: string; debitBalance; debitTotal; creditTotal; creditBalance }`
  - `type TrialBalance = { rows: TrialBalanceRow[]; total: { debitBalance: number; debitTotal: number; creditTotal: number; creditBalance: number }; balanced: boolean }`
  - `buildTrialBalance(input: { accounts: AccountRow[]; bsTotals: AccountTotal[]; plTotals: AccountTotal[]; priorProfit: number }): TrialBalance` (pure)
  - `getTrialBalance(db, f: ReportFilter): Promise<TrialBalance & { asOf: string; fiscalStart: string }>`. It uses `f.to` as the as-of date and ignores `f.from`.
    - `bsTotals` = `accountTotals({ from: null, to: asOf })` restricted to balance-sheet groups.
    - `plTotals` = `accountTotals({ from: fiscalStart, to: asOf })` restricted to P&L groups.
    - `priorProfit` = `profitBetween({ from: null, to: addDays(fiscalStart, −1) })`.

Layout rules:
- Groups appear in the `AccountGroup` order of `src/lib/accounts.ts`. Each group gets a `group` header row, then its accounts ordered by code, then a `subtotal` row labelled `<그룹명> 계`. Groups with no rows are omitted.
- An account's balance column goes on the side where the net amount is positive: `debitBalance = max(debitTotal − creditTotal, 0)` and `creditBalance = max(creditTotal − debitTotal, 0)`.
- The `auto` row goes inside the `equity` group, right after the equity accounts, and only when `priorProfit ≠ 0`. A profit is placed as `creditTotal = creditBalance = priorProfit`; a loss as `debitTotal = debitBalance = −priorProfit`.
- `balanced` means `total.debitTotal === total.creditTotal`.
- The page shows the 기준일 filter. A row's account name links to `/ledgers/accounts?account=<id>&from=<fiscalStart>&to=<asOf>` (plus site/dept).
- When `!balanced`, show this notice above the table: `사업장·부서 필터가 적용되어 차변과 대변 합계가 다릅니다. (차액 <formatWon>)`. An unbalanced result without a filter cannot happen. If it does, show the same notice without the first clause, so it is visible.

- [ ] **Step 1: Failing tests.**
  - Pure:
    - cash sale (Dr 101 110,000 / Cr 401 100,000 / Cr 255 10,000) → rows for 101, 255, 401 with the right columns; `balanced`;
    - prior profit 50,000 → an `auto` row with credit 50,000, and totals still balance;
    - a prior loss goes on the debit side;
    - an account with debit 300 and credit 500 → `creditBalance` 200;
    - empty groups are omitted;
    - group order and subtotals are correct.
  - Service:
    - fiscal start month 1;
    - a voucher dated last year on 811 lands in `priorProfit`, not in `plTotals`;
    - a 101 voucher dated last year stays in `bsTotals`;
    - `filtered trial balance can be unbalanced`: one voucher whose debit line is site A and credit line is site B, filtered by A → `balanced: false`.
  - e2e (`e2e/reports.spec.ts`, admin, after creating its own uniquely-described voucher): `/reports/trial-balance` shows the `합계잔액시산표` heading, a `합계` row, and no `차액` notice.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the builder, service and page (permission `ledger:view`, as the placeholder already does).
- [ ] **Step 4: Run** `pnpm test`, the e2e and `pnpm lint` → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(reports): trial balance with prior-years profit line"`

### Task 4: 손익계산서 and 재무상태표 (with comparison)

**Files:**
- Create:
  - `src/lib/reports/statements.ts`
  - `src/components/reports/income-statement-table.tsx`, `src/components/reports/balance-sheet-table.tsx`
- Modify:
  - `src/server/reports/service.ts`
  - `src/app/(dashboard)/reports/income-statement/page.tsx`, `src/app/(dashboard)/reports/balance-sheet/page.tsx`
- Test: `src/lib/reports/statements.test.ts`, `src/server/reports/service.test.ts` (extend), `e2e/reports.spec.ts` (extend)

**Interfaces:**
- Produces:
  - `type StatementLine` =
    - `{ kind: "section"; key: string; label: string; amount: number; prior: number } |`
    - `{ kind: "account"; code: string; name: string; accountId: number | null; amount: number; prior: number } |`
    - `{ kind: "computed"; key: string; label: string; amount: number; prior: number }`
  - `buildIncomeStatement(accounts: AccountRow[], current: AccountTotal[], prior: AccountTotal[]): StatementLine[]`
  - `buildBalanceSheet(accounts: AccountRow[], current: BsInput, prior: BsInput): StatementLine[]`, where `type BsInput = { bsTotals: AccountTotal[]; priorProfit: number; currentProfit: number }`
  - `getIncomeStatement(db, f: ReportFilter): Promise<{ lines: StatementLine[]; period: Period; priorPeriod: Period }>`. The prior period is `priorYearPeriod(f)`.
  - `getBalanceSheet(db, f: ReportFilter): Promise<{ lines: StatementLine[]; asOf: string; priorAsOf: string }>`
    - `asOf = f.to`.
    - `priorAsOf = addDays(fiscalYearStart(asOf), −1)` (전기말).
    - Each column computes its own `fiscalStart` from its own as-of date.

Income statement layout (exact labels, each section followed by its accounts ordered by code; amount = signed balance):

| key | label | computed as |
|---|---|---|
| revenue | `Ⅰ. 매출액` | revenue group |
| cost_of_sales | `Ⅱ. 매출원가` | cost_of_sales group |
| gross | `Ⅲ. 매출총이익` | Ⅰ − Ⅱ |
| sga | `Ⅳ. 판매비와관리비` | sga group |
| operating | `Ⅴ. 영업이익` | Ⅲ − Ⅳ |
| non_operating_income | `Ⅵ. 영업외수익` | group |
| non_operating_expense | `Ⅶ. 영업외비용` | group |
| pretax | `Ⅷ. 법인세비용차감전순이익` | Ⅴ + Ⅵ − Ⅶ |
| income_tax | `Ⅸ. 법인세비용` | group |
| net | `Ⅹ. 당기순이익` | Ⅷ − Ⅸ |

Rows:
- Sections and computed rows always appear, even when they are 0.
- An account row appears when its current or prior amount is ≠ 0.
- A computed line shows negative values with `-` (e.g. 영업손실).

Balance sheet layout (exact labels):

| | |
|---|---|
| `자산` | section header |
| `Ⅰ. 유동자산` | current_asset accounts |
| `Ⅱ. 비유동자산` | noncurrent_asset accounts |
| `자산총계` | computed: Ⅰ + Ⅱ |
| `부채` | section header |
| `Ⅰ. 유동부채` | current_liability accounts |
| `Ⅱ. 비유동부채` | noncurrent_liability accounts |
| `부채총계` | computed |
| `자본` | section header |
| `Ⅰ. 자본` | equity accounts, then `이월이익잉여금(전기 손익)` (`priorProfit`, `accountId: null`, code `""`), then `당기순이익` (`currentProfit`, `accountId: null`, code `""`) |
| `자본총계` | computed |
| `부채와자본총계` | computed |

The header rows `자산`, `부채` and `자본` are `section` lines with amount = their total. The two computed equity rows appear when either column is ≠ 0.

Pages:
- The income statement uses the 기간 filter. Columns: `과목`, `당기 (<from> ~ <to>)`, `전기 (<prior from> ~ <prior to>)`.
- The balance sheet uses the 기준일 filter. Columns: `과목`, `당기 (<asOf>)`, `전기말 (<priorAsOf>)`.
- Account rows link to the account ledger with the matching period.

- [ ] **Step 1: Failing tests.**
  - Pure IS:
    - sale 100,000, cost 60,000, sga 30,000, non-op income 5,000, non-op expense 2,000, tax 3,000 → 매출총이익 40,000, 영업이익 10,000, 법인세비용차감전순이익 13,000, 당기순이익 10,000;
    - a prior column computed independently;
    - a zero-activity account omitted.
  - Pure BS:
    - `contra account stays in its section`: 212 비품 1,000,000 debit and 213 감가상각누계액 200,000 credit → under `Ⅱ. 비유동자산` as 1,000,000 and −200,000; 자산총계 800,000.
    - For any balanced set of vouchers, `자산총계 === 부채와자본총계`. Use a small table-driven case list: capital injection, credit purchase, cash sale, expense, prior-year profit.
  - Service:
    - `non-January fiscal year`: start month 4, as-of 2026-02-10 → `currentProfit` covers 2025-04-01..2026-02-10 and `priorProfit` covers everything before; `priorAsOf` = 2025-03-31.
    - The IS prior period equals `priorYearPeriod`.
  - e2e: `/reports/income-statement` shows `Ⅹ. 당기순이익`; `/reports/balance-sheet` shows `자산총계` and `부채와자본총계` with equal amounts (compare the text of the two cells).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** tests, e2e, lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(reports): income statement and balance sheet with prior-period comparison"`

### Task 5: 분개장 and 계정별 원장

**Files:**
- Create: `src/server/reports/ledgers.ts`, `src/components/reports/journal-table.tsx`, `src/components/reports/account-ledger-table.tsx`, `src/components/reports/account-select.tsx`
- Modify: `src/app/(dashboard)/ledgers/journal/page.tsx`, `src/app/(dashboard)/ledgers/accounts/page.tsx`
- Test: `src/server/reports/ledgers.test.ts`, `e2e/reports.spec.ts` (extend)

**Interfaces:**
- Produces:
  - `type JournalEntry = { voucherId: string; date: string; no: number; description: string; lines: { code: string; name: string; side: Side; amount: number; partnerName: string | null; description: string }[] }`
  - `getJournal(db, f: ReportFilter, page: number): Promise<{ entries: JournalEntry[]; total: number; debitSum: number; creditSum: number }>`
    - 100 vouchers per page, ordered by date then no, ascending.
    - `debitSum`/`creditSum` cover the whole filtered period, not just the page.
    - With a site/department filter, each entry lists only the matching lines, and vouchers with none are skipped.
  - `type LedgerRow` =
    - `{ kind: "opening"; balance: number } |`
    - `{ kind: "line"; voucherId: string; date: string; no: number; description: string; partnerName: string | null; debit: number; credit: number; balance: number } |`
    - `{ kind: "month"; month: string /* YYYY-MM */; debit: number; credit: number } |`
    - `{ kind: "cumulative"; debit: number; credit: number }`
  - `getAccountLedger(db, accountId: number, f: ReportFilter, opts?: { partnerId?: number | null }): Promise<{ account: AccountRow; rows: LedgerRow[]; closing: number } | null>`. Returns `null` for an unknown account id. `partnerId` is used by Task 6.

Account ledger rules:
- The opening balance is the signed balance of posted lines before `f.from`:
  - for balance-sheet groups, since the beginning;
  - for P&L groups, since `fiscalYearStart(f.from)`.
- Lines are ordered by date, no, then line no. `balance` is the running signed balance.
- After the last line of each month: a `month` row (`월계`, that month's sums) followed by a `cumulative` row (`누계`, sums from `f.from` through that month end).
- Labels shown in the UI: opening `이월`, month `월계`, cumulative `누계`.
- No pagination. Task 8 measures a year of 보통예금 activity. If it is too slow, Task 8 adds a page size; this task must not guess one.

Pages:
- `/ledgers/journal`: period filter, a table grouped per voucher (번호 links to the voucher), a 합계 footer, and pagination.
- `/ledgers/accounts`: period filter plus an account select (`account` param, a searchable select of all accounts including hidden ones, ordered by code). With no account chosen, show an empty state `계정과목을 선택하세요.`.

- [ ] **Step 1: Failing tests.**
  - Journal:
    - ordering;
    - a pending voucher is excluded;
    - the site filter keeps only matching lines;
    - sums cover all pages (create 101 vouchers and check `entries.length === 100` and `total === 101`).
  - Account ledger on 103:
    - an opening balance from before `from`;
    - three lines across two months → running balances;
    - one `월계` and one `누계` row after each month, with the correct values.
  - Account ledger on 811 with `from` in a later fiscal year: last year's expense is not in the opening balance.
  - Unknown account → `null`.
  - e2e: the journal shows the spec's own voucher by its description; the account ledger for `103` (chosen via the select) shows `이월` and `월계`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(ledgers): journal and account ledger with running balance and monthly totals"`

### Task 6: 거래처별 원장

**Files:**
- Create: `src/components/reports/partner-summary-table.tsx`
- Modify: `src/server/reports/ledgers.ts`, `src/app/(dashboard)/ledgers/partners/page.tsx`
- Test: `src/server/reports/ledgers.test.ts` (extend), `e2e/reports.spec.ts` (extend)

**Interfaces:**
- Consumes: `getAccountLedger(..., { partnerId })` (Task 5)
- Produces: `type PartnerSummaryRow = { partnerId: number | null; partnerName: string /* "(거래처 없음)" for null */; opening: number; debit: number; credit: number; closing: number }`, and `getPartnerSummary(db, accountId: number, f: ReportFilter): Promise<PartnerSummaryRow[]>`
  - Opening follows the same rule as the account ledger.
  - One row per partner with any opening, debit or credit.
  - Rows are ordered by partner name, with `(거래처 없음)` last.

Page `/ledgers/partners`:
- An account select. The default is the first `requiresPartner` account by code; this comes from data, not a hard-coded code.
- With no `partner` param, the page shows the summary table (거래처 · 이월 · 차변 · 대변 · 잔액, plus a total row). Each name links to `?partner=<id>`.
- With `partner`, the page shows that partner's ledger (reusing the account-ledger table) and a `전체 거래처` back link.

- [ ] **Step 1: Failing tests.**
  - Two partners on 108 plus one line without a partner: three summary rows with correct opening, debit, credit and closing amounts. The no-partner row is last.
  - `getAccountLedger` with `partnerId` keeps only that partner's lines, including in the opening balance.
  - e2e: the page lists the spec's own partner under its account; clicking the partner shows `이월`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(ledgers): partner ledger summary and detail"`

### Task 7: Excel export for all six reports

**Files:**
- Create:
  - `src/server/exports/xlsx.ts`, `src/server/exports/specs.ts`
  - `src/app/api/exports/[report]/route.ts`
- Modify: all six report pages (the `엑셀 다운로드` link)
- Test: `src/server/exports/xlsx.test.ts`, `src/server/exports/specs.test.ts`, `e2e/reports.spec.ts` (extend)

**Interfaces:**
- Produces:
  - `type SheetColumn = { header: string; key: string; width: number; money?: boolean }`
  - `type SheetSpec = { fileName: string /* without .xlsx */; title: string; meta: string[] /* lines under the title */; columns: SheetColumn[]; rows: Record<string, string | number | null>[]; emphasis?: number[] /* row indexes rendered bold */ }`
  - `renderXlsx(spec: SheetSpec): Promise<Buffer>`, using `exceljs`.
    - Row 1 is the title (bold, size 14).
    - Each `meta` line follows.
    - Then one blank row, the header row (bold, bottom border), and the data rows.
    - Money columns are numeric cells with `numFmt` `#,##0;-#,##0`.
    - The header row is frozen.
    - The sheet name is the title, truncated to 31 characters.
  - `type ReportKey = "journal" | "account-ledger" | "partner-ledger" | "trial-balance" | "income-statement" | "balance-sheet"`
  - `buildSheetSpec(db, report: ReportKey, sp: Record<string, string | string[] | undefined>): Promise<SheetSpec | null>`
    - It parses with `parseReportParams` and calls the same services as the pages. The journal export is not paginated.
    - It returns `null` for an account or partner ledger without a valid `account`.
    - `meta` = `[<company name>, <기간 or 기준일 text>, <"사업장: name" / "부서: name" when filtered>]`.
    - Exports include account codes (spec §5.4).
  - Route `GET /api/exports/[report]`:
    - `requirePermission`-equivalent for `ledger:view`: `verifySession`, then `can`, else 403.
    - Unknown report or `null` spec → 404.
    - Response: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(fileName)>.xlsx`, `Cache-Control: private, no-store`.

File names (exact; `<from>`/`<to>`/`<asOf>` are dates):

| report | fileName |
|---|---|
| journal | `분개장_<from>_<to>` |
| account-ledger | `계정별원장_<code><name>_<from>_<to>` |
| partner-ledger | `거래처별원장_<code><name>_<from>_<to>` (partner name appended when `partner` is set) |
| trial-balance | `합계잔액시산표_<asOf>` |
| income-statement | `손익계산서_<from>_<to>` |
| balance-sheet | `재무상태표_<asOf>` |

- [ ] **Step 1: Failing tests.**
  - `xlsx.test.ts`: render a 2-row spec, read it back with `exceljs`, and check that:
    - cell A1 holds the title;
    - money cells are `number`-typed with the format above;
    - the header row is frozen.
  - `specs.test.ts`: for seeded data, `buildSheetSpec(db, "trial-balance", { to: "2026-10-30" })` → `fileName` `합계잔액시산표_2026-10-30`, the first `meta` line is the company name, and a row for `101` has numeric money values. Also `buildSheetSpec(db, "account-ledger", {})` → `null`.
  - e2e: on `/reports/trial-balance`, clicking `엑셀 다운로드` triggers a download whose `suggestedFilename()` starts with `합계잔액시산표_` and ends `.xlsx`. A logged-out request to `/api/exports/trial-balance` does not return a spreadsheet.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Run `pnpm add exceljs`; if pnpm reports ignored build scripts it needs, add it to `allowBuilds`. Read the route-handler docs in `node_modules/next/dist/docs/` (async `params`).
- [ ] **Step 4: Run** tests, e2e, `pnpm build`, lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(exports): Excel download for journal, ledgers and statements"`

### Task 8: Measure report performance (spec §7) and add what the numbers demand

**Files:**
- Create: `src/server/reports/perf.test.ts`
- Modify: `src/server/db/schema.ts` (only if the numbers demand it), `CLAUDE.md` (record the result in one line)

The perf test runs only when `PERF=1` is set (`describe.skipIf(!process.env.PERF)`). It seeds `acts_test` with **200,000 posted vouchers / 500,000 lines** across one fiscal year, using a single `generate_series` SQL insert:
- 30 accounts;
- 50 partners on 108/251;
- 2 sites;
- dates spread across the year;
- 60% of lines on 103.

It then times each call 3 times and keeps the median.

Targets (spec §7: "수 초 안에"):

| call | target |
|---|---|
| `getTrialBalance` | < 1,500 ms |
| `getBalanceSheet` | < 1,500 ms |
| `getIncomeStatement` | < 1,500 ms |
| `getJournal` page 1 | < 1,000 ms |
| `getAccountLedger` for 103, full year | < 3,000 ms, and the page renders (check via `pnpm build && pnpm start` and a timed `curl` of the ledger URL with a session cookie) |

- [ ] **Step 1:** Write the perf test and run `PERF=1 pnpm test src/server/reports/perf.test.ts`. Record the medians and the `EXPLAIN (ANALYZE, BUFFERS)` of the `accountTotals` query in the report.
- [ ] **Step 2: If a target fails**, choose the smallest fix and re-measure. In order of preference:
  1. an index (e.g. `voucher_lines(account_id) include (amount, side)` or `(voucher_id, account_id)`);
  2. for the account ledger, pagination at 1,000 lines per page with the opening balance carried across pages;
  3. a materialized daily summary (only if 1 and 2 fail; it would then need its own plan section, so stop and report instead).
- [ ] **Step 3:** Restore `acts_test` (`resetDb` at the end of the perf test). Record one line in `CLAUDE.md`, for example "Reports aggregate posted lines on the fly; measured N ms for a 500k-line year (perf test: `PERF=1 pnpm test src/server/reports/perf.test.ts`)".
- [ ] **Step 4: Run** the normal `pnpm test` (the perf test is skipped), lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "perf(reports): measure on-the-fly aggregation at 500k lines"` (plus `perf(reports): …index` when Step 2 applies)

### Task 9: Regression, docs, deploy

- [ ] **Step 1:** `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Known flaky template specs may pass on retry; anything else failing blocks.
- [ ] **Step 2:** Update `CLAUDE.md`:
  - Project line → Phase 1C.
  - One Architecture bullet: the report core (`src/server/reports/`, pure builders in `src/lib/reports/`), the fiscal-year and prior-years profit rule, and the export route.
  - Commit: `git commit -m "docs: update CLAUDE.md for phase 1C"`.
- [ ] **Step 3 (confirm with the user first):** `git push`, then on the server (Windows `ssh.exe` + agent, see 1B Task 10): `cd ~/acts && git pull && docker compose --profile prod up -d --build`. Verify `/login` returns 200 locally on the server. The user checks the reports through Cloudflare Access.

## Notes for Phase 1D (from the 1C final review)

- Reports compute prior-years profit on the fly, so year-end 결산 vouchers (kind `closing`) must be ordinary adjusting entries (감가상각, 대손, 미지급비용, 법인세) and must stay in the income statement.
- Do NOT post a P&L-zeroing "집합손익 대체" voucher. It would make that year's 손익계산서 show 0 and turn the year-end trial balance into a post-closing one. If one is ever needed, mark it distinctly and exclude it from the income statement only.
- Balance-sheet accounts accumulate from the beginning of time. 연도 이월 must therefore NOT post next-year opening-balance vouchers for balances already in the system, which would double-count. Opening-balance entry is only for history from before the system was introduced.
- A P&L account ledger whose period spans a fiscal-year boundary does not reset at the boundary. Decide in 1D whether to reset at each fiscal start or restrict the period.
