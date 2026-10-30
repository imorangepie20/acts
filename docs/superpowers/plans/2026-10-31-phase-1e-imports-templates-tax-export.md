# Phase 1E — Account Recommendation · Transaction Templates · Hometax/Card Imports · 세무사 Export Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut staff typing and classification mistakes, and hand the 세무사 everything they need in one download.
- Suggest the account for a purchase or sale from this company's own history.
- Save and reuse recurring transactions as templates.
- Turn Hometax tax-invoice and card-purchase Excel files into draft vouchers that staff confirm in bulk.
- Export the journal, trial balance, the tax-invoice list, the card/cash-receipt purchase list and the evidence files for a period.

**Architecture:**
- **Recommendation:** a pure ranking function in `src/lib/recommend.ts` scores accounts from history rows. The server loads those rows once per request: past purchase/sale vouchers, their main account, partner and description. A small keyword table is the fallback for a company with no history yet.
- **Templates:** a `voucher_templates` table holds a form-shaped JSON body. Templates never create vouchers themselves: loading one pre-fills the existing entry forms.
- **Imports:**
  - Pure parsers (`src/lib/imports/`) turn a sheet's cell grid into rows. They find the header row by column names, so title rows and column order don't matter.
  - The server reads the `.xlsx`, matches partners, flags duplicates and blocked rows, and attaches recommendations. The client holds the preview.
  - On commit every row goes through `buildSimpleVoucher` and `createVoucher`, so the locks, validation, approval status and history are unchanged. Each voucher carries a `voucher_imports` row whose primary key is the source key, so the same row can't be imported twice.
- **세무사 package:** two new list builders plus the existing journal and trial-balance sheet specs. A streamed ZIP adds the evidence files.

**Tech Stack:** Next.js 16.2 · React 19 · Drizzle ORM 0.45 · exceljs 4.4 (read and write) · archiver 7 (new, ZIP streaming) · Vitest · Playwright.

**Spec:** [docs/superpowers/specs/2026-10-29-accounting-tax-system-design.md](../specs/2026-10-29-accounting-tax-system-design.md)
- §4: staff confirm the recommended accounts
- §5.1: 계정과목 추천, 거래 템플릿, 전자세금계산서/카드 일괄 불러오기
- §5.4: 내보내기 (회사 → 세무사)

(`2026-06-07-phase-1e-final-dashboards.md` is an unrelated plan from the template era.)

## Global Constraints

- Everything in the 1A–1D Global Constraints still applies:
  - Korean UI copy, integer won, `YYYY-MM-DD` strings, Asia/Seoul today (`todayInSeoul`).
  - Posted means `POSTED_STATUSES`.
  - Lock order for every voucher write: period lock → company → voucher row → numbering.
  - The month-close watermark and the opening cut-off.
- **Every imported voucher is created through `createVoucher`.** No bulk insert, no bypass. Imported vouchers are `pending` when approval is on, like any typed voucher.
- **Recommendation uses only this database's own history** (spec §5.1), plus the fallback keyword table. Recommendations never include an inactive account.
- **Account codes in logic.** Codes appear only in:
  - the keyword fallback table (data, resolved by code at runtime; a missing or inactive code is skipped);
  - UI preselections, following the existing `counterFirst` pattern. The import screen preselects the counter account: 매입 세금계산서 `251`, 매출 `108`, 카드 `253`.
  - Server logic never assumes they exist.
- **Uploads:**
  - `.xlsx` only, at most 5 MB and 1,000 data rows.
  - Read with exceljs. Never evaluate formulas: use the cached `result` of formula cells.
- **Exports** include posted vouchers only. The page shows how many pending vouchers fall in the period.
- **Permissions:**
  - templates, recommendation, imports: `voucher:create`
  - 세무사 package and tax lists: `export:tax`
  - The existing `/api/exports/[report]` keeps `ledger:view` for the 1C report keys.
- **Exact messages:**
  - Wrong file type: `엑셀(.xlsx) 파일만 올릴 수 있습니다. 엑셀에서 'Excel 통합 문서(.xlsx)'로 저장한 뒤 올려 주세요.`
  - File too large: `5MB 이하 파일만 올릴 수 있습니다.`
  - Too many rows: `한 번에 1,000건까지 불러올 수 있습니다.`
  - Header row not found: `필요한 열(<열 이름, …>)을 찾을 수 없습니다. 홈택스에서 내려받은 파일인지 확인하세요.`
  - Wrong direction: `이 파일의 <공급받는자|공급자>가 우리 회사가 아닙니다. 매입·매출 선택을 확인하세요.`
  - Already imported: `이미 불러온 자료입니다.`
  - Negative or cancelled row: `음수 금액(수정·취소분)은 전표 입력 화면에서 직접 입력하세요.`
  - Card row with 봉사료: `봉사료가 있는 건은 직접 입력하세요.`
  - Template name: `템플릿 이름을 입력하세요.` (blank) · `템플릿은 200개까지 저장할 수 있습니다.`

## Review Focus

1. **Importing the same rows twice** must not create duplicate vouchers. Cases: the same file uploaded again; a later file overlapping the period; the commit button pressed twice concurrently. The second time, rows show `duplicate` in the preview, and the commit returns `이미 불러온 자료입니다.` per row. → Task 4 tests `re-import is flagged and refused` and `concurrent commit creates one voucher` (`Promise.all`).
2. **Real Hometax sheets are messy:**
   - title rows above the header;
   - two `상호` columns (supplier, then buyer);
   - amounts as numbers or as `"1,234,000"` strings;
   - dates as `2026-10-15`, `20261015` or Excel dates;
   - blank rows and a trailing `합계` row.

   Each must parse or be skipped cleanly, never become a wrong voucher. → Task 3 tests.
3. **Rows that must not be auto-booked:** negative or zero amounts, 봉사료, a closed month, a date on or before the opening cut-off, and an inactive matched partner. Each is `blocked` with its reason and can't be selected. A failure at commit time doesn't stop the other rows. → Task 3 and Task 4 tests.
4. **A 매출 file uploaded as 매입** (or the reverse) is refused when the company or a site has a business number. → Task 4 test.
5. **The 세무사 package:**
   - pending and rejected vouchers are excluded;
   - an attachment missing on disk is listed in `누락된 증빙.txt` instead of failing the download;
   - zip entry names never contain `/`, `\` or `..` from user file names.

   → Task 7 tests.

---

## File Structure

```
src/lib/recommend.ts                    # pure ranking + keyword fallback (Task 1)
src/server/recommend/service.ts         # history load, recommendAccounts / recommendMany (Task 1)
src/lib/vouchers/templates.ts           # TemplateBody types (Task 2)
src/server/templates/{service,form}.ts  # CRUD + zod (Task 2)
src/lib/imports/{types,sheet,tax-invoice,card}.ts  # pure parsers (Task 3)
src/server/imports/read-xlsx.ts         # exceljs → cell grid (Task 3)
src/server/imports/service.ts           # preview + commit (Task 4)
src/app/(dashboard)/imports/{page,actions}.tsx|ts   # (Task 4 actions, Task 5 page)
src/components/imports/                 # import UI (Task 5)
src/server/exports/tax-lists.ts         # tax-invoice + card purchase lists (Task 6)
src/server/exports/package.ts           # ZIP stream (Task 7)
src/app/api/exports/tax-package/route.ts
src/app/(dashboard)/exports/page.tsx    # 세무사 자료 page (Task 7)
src/components/exports/
```

---

### Task 1: Account recommendation

**Files:**
- Create: `src/lib/recommend.ts`, `src/server/recommend/service.ts`
- Modify:
  - `src/app/(dashboard)/vouchers/actions.ts` (+ `recommendAccountsAction`)
  - `src/components/vouchers/trade-form.tsx` (suggestion chips)
- Test: `src/lib/recommend.test.ts`, `src/server/recommend/service.test.ts`, `e2e/vouchers.spec.ts` (extend)

**Interfaces:**
- Produces (`src/lib/recommend.ts`):
  - `type HistoryItem = { accountId: number; partnerId: number | null; description: string; date: string }`
  - `type Recommendation = { accountId: number; reason: string }`
  - `type KeywordRule = { keywords: string[]; code: string }`
  - `const KEYWORD_RULES: KeywordRule[]`, purchase only, data below
  - `function tokenize(text: string): string[]`: lower-case, split on whitespace and punctuation, drop tokens shorter than 2 characters, deduplicate
  - `function rankAccounts(history: HistoryItem[], q: { partnerId: number | null; text: string }, fallback: { accountId: number; keyword: string }[], limit = 3): Recommendation[]`
- Produces (`src/server/recommend/service.ts`):
  - `type RecommendQuery = { entryType: "purchase" | "sale"; partnerId: number | null; text: string }`
  - `loadHistory(db: Db, entryType: "purchase" | "sale"): Promise<HistoryItem[]>`
  - `recommendAccounts(db: Db, q: RecommendQuery): Promise<Recommendation[]>`
  - `recommendMany(db: Db, entryType: "purchase" | "sale", qs: Omit<RecommendQuery, "entryType">[]): Promise<Recommendation[][]>` (loads history and rules once)

**Scoring** (`rankAccounts`). For each history item `h`:
- weight = `(h.partnerId !== null && h.partnerId === q.partnerId ? 3 : 0) + 2 × min(2, shared tokens of h.description and q.text)`;
- items with weight 0 are ignored.

Sum the weights per account. Sort by score, break ties by the latest `date`, and keep the top `limit`. The reason is built from counts: `이 거래처 N회` and/or `비슷한 적요 N회`, joined with ` · `. If history yields fewer than `limit`, append fallback hits not already listed, with reason `기본 규칙(<keyword>)`.

**History** (`loadHistory`):
- the 2,000 most recent vouchers with `kind = 'general'`, this `entryType`, and `status <> 'rejected'` (pending counts: staff classified it);
- the main account is the first line on the main side (purchase: debit, sale: credit) whose account is neither VAT account (`getVatAccountIds`);
- accounts that are inactive now are dropped.

**Keyword rules** (code ← keywords):
| Code | Keywords |
|---|---|
| 819 | 임차료, 임대료, 월세, 관리비 |
| 814 | 통신, 인터넷, 휴대폰, 전화, kt, skt, 유플러스 |
| 815 | 전기, 가스, 수도, 한전 |
| 812 | 택시, 교통, 주차, 항공, ktx, 숙박, 출장 |
| 811 | 식대, 식사, 커피, 간식, 회식 |
| 813 | 접대, 선물, 경조 |
| 822 | 주유, 차량, 세차, 정비, 통행료, 하이패스 |
| 824 | 택배, 운송, 퀵, 배송 |
| 829 | 문구, 사무용품, 복사용지, 토너 |
| 830 | 소모품, 다이소 |
| 831 | 수수료, 세무, 기장 |
| 833 | 광고, 홍보, 마케팅 |
| 821 | 보험 |
| 826 | 도서, 신문, 인쇄 |
| 825 | 교육, 강의, 세미나 |
| 820 | 수리, 수선, 유지보수 |

A keyword matches when `q.text` lower-cased **contains** it (substring, so `주유소` matches `주유`).

**UI:**
- In `TradeForm`, below the main account picker, show up to 3 chips `<code> <name>` with the reason as a `title`.
- Clicking a chip sets the main account. Chips equal to the current selection are hidden.
- Fetch on partner change immediately and on description change after 400 ms idle, only when the partner or the text is non-empty.
- A failed fetch shows nothing.

- [ ] **Step 1: Failing tests.**
  - `rankAccounts`: partner match outranks text match; ties go to the latest date; the reason reads `이 거래처 2회 · 비슷한 적요 1회`; empty history with text `주유소 결제` returns the 822 fallback with reason `기본 규칙(주유)`.
  - `tokenize("스타벅스 강남점, 커피!")` = `["스타벅스", "강남점", "커피"]`.
  - Service: after two purchases from partner P to 811, `recommendAccounts({ entryType: "purchase", partnerId: P, text: "" })[0].accountId` is 811. A rejected voucher is ignored. Deactivating 811 removes it. A sale history doesn't leak into purchase.
  - e2e: create a purchase for a new partner to 811, start another purchase, pick the same partner, and the chip `811 복리후생비` appears; clicking it fills the account.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, lint, the e2e → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(vouchers): account recommendation from company history"`

### Task 2: Transaction templates

**Files:**
- Modify:
  - `src/server/db/schema.ts` + generated migration
  - `src/components/vouchers/{voucher-entry,trade-form,transfer-form,general-form,shared}.tsx`
  - `src/app/(dashboard)/vouchers/actions.ts`
  - `src/app/(dashboard)/vouchers/new/page.tsx` (load templates)
- Create: `src/lib/vouchers/templates.ts`, `src/server/templates/{service,form}.ts`
- Test: `src/server/templates/service.test.ts`, `e2e/vouchers.spec.ts` (extend)

**Interfaces:**
- Table `voucher_templates`:
  - `id` integer identity PK
  - `name` text not null unique
  - `entry_type` `entry_type` not null
  - `body` jsonb `TemplateBody` not null
  - `created_by` uuid → users
  - `created_at`, `updated_at`
- `src/lib/vouchers/templates.ts`:
  ```ts
  export type TemplateBody =
    | { type: "purchase" | "sale"; description: string; mainAccountId: number | null; counterAccountId: number | null;
        partnerId: number | null; evidenceType: EvidenceType; vatType: VatType; vatDeductible: boolean;
        supplyAmount: number | null; vatAmount: number | null }
    | { type: "transfer"; description: string; debitAccountId: number | null; creditAccountId: number | null;
        partnerId: number | null; evidenceType: EvidenceType; amount: number | null }
    | { type: "general"; description: string; closing: boolean;
        lines: { accountId: number | null; side: Side; amount: number | null; partnerId: number | null; description: string }[] };
  export const MAX_TEMPLATES = 200;
  ```
  - Date, 사업장 and 부서 are never stored: they come from the entry screen.
- `src/server/templates/service.ts`:
  - `type TemplateRow = { id: number; name: string; body: TemplateBody; partners: { id: number; name: string }[] }`, with `partners` resolving every `partnerId` in the body for the pickers
  - `listTemplates(db: Db): Promise<TemplateRow[]>`, ordered by name
  - `saveTemplate(db: Db, actor: SessionUser, name: string, body: TemplateBody): Promise<Result<{ id: number }>>`: upsert by name. A trimmed name is 1–50 characters. Every account and partner id must exist (inactive is allowed; voucher save re-validates). The count cap applies to new names.
  - `deleteTemplate(db: Db, id: number): Promise<Result>`
- Actions: `saveTemplateAction(name: string, body: unknown)`, `deleteTemplateAction(id: number)`. Both need `voucher:create`. Bodies are parsed with a zod schema in `form.ts`.
- `FormContext` gains `saveAsTemplate: (body: TemplateBody) => void`. Each form's `SaveBar` gets a secondary button `템플릿으로 저장` that passes its current, possibly incomplete, state.
- Form initial types widen so a template can pre-fill them: `TradeInitial.simple` amounts become `number | null`; transfer and general follow suit. `toSimpleInput`-based edit initials still type-check.

**UI** (new entries only, hidden when editing):
- A `템플릿` button beside the tabs opens a popover with a search box and the template list. Each item has `불러오기` and a delete icon behind a confirm.
- Loading switches to the template's tab, sets 적요, and remounts that form with the template as `initial`. Date, 사업장 and 부서 keep their current values.
- `템플릿으로 저장` opens a dialog with a name input and the note `같은 이름이 있으면 덮어씁니다.`

- [ ] **Step 1: Failing tests.**
  - `saveTemplate` then `listTemplates` round-trips each of the three body types.
  - Saving the same name again replaces the template (count stays 1).
  - A blank name fails with `템플릿 이름을 입력하세요.`
  - An unknown account id fails.
  - The 201st new name fails with the cap message, but overwriting an existing name at the cap succeeds.
  - e2e: fill a purchase (819, partner, 1,100,000), save it as `월 임차료`, reload the page, load `월 임차료`; the account, partner and amounts are filled, and saving creates a voucher.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Run `pnpm db:generate` for the table.
- [ ] **Step 4: Run** `pnpm db:migrate`, `pnpm test`, lint, the e2e → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(vouchers): reusable transaction templates"`

### Task 3: Sheet reading and the two parsers

**Files:**
- Create:
  - `src/lib/imports/{types,sheet,tax-invoice,card}.ts`
  - `src/server/imports/read-xlsx.ts`
- Test: `src/lib/imports/{sheet,tax-invoice,card}.test.ts`, `src/server/imports/read-xlsx.test.ts`

**Interfaces:**
- `src/lib/imports/types.ts`:
  ```ts
  export type Cell = string | number | Date | null;
  export type ImportMeta = { approvalNo: string | null; merchantName: string | null;
    merchantBusinessNumber: string | null; cardNo: string | null };
  export type ParsedRow = {
    key: string; date: string | null; counterpartyName: string; counterpartyBusinessNumber: string | null;
    representative: string | null;
    ownBusinessNumber: string | null;   // our side of a tax invoice (buyer for purchase, supplier for sale); null for cards
    description: string; evidenceType: EvidenceType; vatType: VatType;
    supplyAmount: number; vatAmount: number; serviceCharge: number; deductible: boolean; meta: ImportMeta;
    problem: string | null;   // parse-level block reason (negative, 봉사료, bad date)
  };
  export type ParseResult = Result<{ rows: ParsedRow[] }>;
  ```
- `src/lib/imports/sheet.ts`:
  - `findHeader(grid: Cell[][], required: Record<string, string[]>, optional: Record<string, string[]>, scanRows = 20): Result<{ row: number; cols: Record<string, number[]> }>`. Each field maps to its aliases. The header row is the first row within `scanRows` where every required field has an alias match, after trimming and removing spaces. `cols` lists **every** matching column index in order, so duplicate headers like `상호` stay addressable. On failure it returns the header-not-found message listing the missing required fields' first aliases.
  - `parseWon(c: Cell): number | null`: numbers pass if integer. Strings drop `,`, spaces and `원`, and accept a leading `-`. Anything else is null.
  - `parseDate(c: Cell): string | null`: accepts a Date (formatted in Asia/Seoul), `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD`, `YYYYMMDD`, or those with a trailing time. The result must be a real calendar date.
  - `isBlankRow(cells: Cell[]): boolean`
- `src/lib/imports/tax-invoice.ts`: `parseTaxInvoices(grid: Cell[][], direction: "purchase" | "sale"): ParseResult`
  - Required: `작성일자`, `승인번호`, `공급자사업자등록번호`, `공급받는자사업자등록번호`, `상호`, `공급가액`.
  - Optional: `세액`, `대표자명`, `품목명`, `전자세금계산서종류`.
  - The supplier's `상호` / `대표자명` is the first occurrence after the 공급자 등록번호 column; the buyer's is the first after the 공급받는자 column. The counterparty is the buyer for `sale` and the supplier for `purchase`.
  - No `세액` column means 전자계산서: `evidenceType: "invoice"`, `vatType: "exempt"`, VAT 0. Otherwise `tax_invoice`, and `vatType` is `zero_rated` when the kind contains `영세`, else `taxable`.
  - `description` = 품목명, or the counterparty name when 품목명 is blank.
  - `key` = `nts:<승인번호 without '-'>`.
  - `deductible: true`.
  - Rows with a blank 승인번호 and a blank date are skipped silently (blank rows and the `합계` row).
  - `problem` is set for: an unparseable date (`날짜를 읽을 수 없습니다.`), a supply ≤ 0 or a VAT < 0 (the negative message), or a VAT > supply.
- `src/lib/imports/card.ts`: `parseCardPurchases(grid: Cell[][]): ParseResult`

  Field aliases (required fields marked):

  | Field | Aliases | Required |
  |---|---|---|
  | date | `승인일자`, `거래일자`, `이용일자`, `승인일시`, `거래일시` | yes |
  | merchant | `가맹점명`, `이용가맹점`, `가맹점` | yes |
  | total | `합계`, `합계금액`, `이용금액`, `승인금액`, `매입금액` | yes |
  | supply | `공급가액` | no |
  | vat | `세액`, `부가세` | no |
  | service | `봉사료` | no |
  | bizNo | `가맹점사업자번호`, `가맹점사업자등록번호`, `사업자번호` | no |
  | approvalNo | `승인번호` | no |
  | cardNo | `카드번호` | no |
  | deduct | `공제여부`, `공제구분` | no |
  | type | `가맹점유형`, `과세유형` | no |

  Amounts:
  - With supply **and** vat: use them, and `deductible` is false when the deduct cell contains `불공제`.
  - With only a total: supply = total, VAT 0, `deductible: false`. We don't guess a split.
  - A type containing `면세` gives `vatType: "exempt"`; otherwise `taxable`.
  - A 봉사료 > 0 sets the 봉사료 problem.
  - A total ≤ 0 sets the negative problem.

  Other fields:
  - `evidenceType: "card"`.
  - `description` and `counterpartyName` = the merchant; `meta` carries the merchant name, business number, approval number and card number, masked to its last 4 digits as `****1234`.
  - `key` = `card:<last4>:<date>:<approvalNo>` when there is an approval number. Otherwise it is `card:<date>:<merchant>:<total>:<n>`, where `n` is the occurrence index of that same tuple within the file (starting at 1).
- `src/server/imports/read-xlsx.ts`: `readFirstSheet(bytes: Uint8Array): Promise<Result<Cell[][]>>`
  - Rejects a non-zip signature (`PK\x03\x04`) with the wrong-type message, and more than 1,000 non-blank rows after the header area with the row-cap message. The 5 MB check is the caller's.
  - Formula cells yield their cached result; rich text is flattened to a string.

- [ ] **Step 1: Failing tests.** Build grids inline in the tests. `read-xlsx.test.ts` writes a workbook with exceljs in memory.
  - Header found below 4 title rows.
  - Two `상호` columns map to supplier and buyer correctly for both directions.
  - `"1,234,000"` and `1234000` both parse.
  - `20261015`, `2026-10-15 13:05` and a Date all give `2026-10-15`; `2026-02-30` is null.
  - The trailing `합계` row is skipped.
  - A missing `승인번호` column fails with the header-not-found message naming `승인번호`.
  - A -110,000 row has the negative problem.
  - No `세액` column → `invoice`/`exempt`.
  - 영세율 kind → `zero_rated`.
  - Card: a total-only file gives supply = total, VAT 0, not deductible; `불공제` is respected; 봉사료 is blocked; two identical card rows without an approval number get keys ending `:1` and `:2`; the card number is masked.
  - `readFirstSheet` returns the cached formula result, and rejects a CSV byte string with the wrong-type message.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(imports): Hometax tax-invoice and card sheet parsers"`

### Task 4: Import preview and commit

**Files:**
- Modify:
  - `src/server/db/schema.ts` + generated migration
  - `src/server/vouchers/service.ts` (`createVoucher` source option)
- Create: `src/server/imports/service.ts`, `src/app/(dashboard)/imports/actions.ts`
- Test: `src/server/imports/service.test.ts`, `src/server/vouchers/service.test.ts` (extend)

**Interfaces:**
- pg enum `import_source` = `tax_invoice | card`.
- Table `voucher_imports`:
  - `import_key` text PK
  - `voucher_id` uuid not null unique → vouchers `on delete cascade`, so deleting the voucher frees the key for re-import
  - `source` `import_source` not null
  - `meta` jsonb `ImportMeta` not null
  - `created_at`
- `createVoucher(db, actor, input, source?: { key: string; source: "tax_invoice" | "card"; meta: ImportMeta })` inserts the `voucher_imports` row in the same transaction, after the voucher. A unique violation on that key returns `fail("이미 불러온 자료입니다.")`: catch it around the transaction, and leave other errors alone.
- `src/server/imports/service.ts`:
  ```ts
  export type ImportKind = "tax_invoice" | "card";
  export type PreviewRow = ParsedRow & {
    direction: "purchase" | "sale"; partnerId: number | null; partnerName: string | null;
    status: "ready" | "duplicate" | "blocked"; reason: string | null; recommendations: Recommendation[];
  };
  export async function previewImport(db: Db, kind: ImportKind, direction: "purchase" | "sale", bytes: Uint8Array): Promise<Result<{ rows: PreviewRow[] }>>;
  export type CommitRow = { key: string; date: string; description: string; mainAccountId: number;
    deductible: boolean; partnerId: number | null;
    counterparty: { name: string; businessNumber: string | null; representative: string | null } | null;
    evidenceType: EvidenceType; vatType: VatType; supplyAmount: number; vatAmount: number; meta: ImportMeta };
  export type CommitInput = { kind: ImportKind; direction: "purchase" | "sale"; counterAccountId: number;
    cardPartnerId: number | null; siteId: number; departmentId: number | null; rows: CommitRow[] };
  export async function commitImport(db: Db, actor: SessionUser, input: CommitInput):
    Promise<{ created: { key: string; id: string }[]; failed: { key: string; error: string }[] }>;
  ```
  Card imports are always `direction: "purchase"`.

**Preview:**
1. Parse the file.
2. Direction guard for tax invoices. Collect the company's and all sites' business numbers. If any exist and no row's `ownBusinessNumber` is one of them, fail the whole file with the wrong-direction message.
3. Partners: tax-invoice rows match an existing partner by business number. Card rows get no partner.
4. Status, first match wins:
   1. `problem` → blocked;
   2. key already in `voucher_imports` → duplicate;
   3. date month closed (`isMonthClosed`) → blocked with the closed-month message;
   4. date ≤ the opening cut-off → blocked with the cut-off message;
   5. matched partner inactive → blocked with `거래처(<name>)가 사용 중지 상태입니다.`;
   6. otherwise ready.
5. Recommendations come from `recommendMany` with the row's partner and description.

**Commit:** rows are processed one at a time, each in its own `createVoucher` transaction. Validate the payload with zod in the action.
- Tax invoice partner: `partnerId` if given; else find by business number; else create the partner (`createPartner`), and on a unique violation re-select.
- Card partner: `cardPartnerId`, which may be null. `createVoucher` then reports the requires-partner message if the counter account needs one.
- Build a `TradeInput` with `type = direction`, `vatDeductible = deductible`, the batch counter account, site and department. Then `buildSimpleVoucher` → `createVoucher(..., source)`.
- Any failure goes to `failed` with its message, and processing continues.

**Actions:**
- `previewImportAction(fd: FormData)` takes fields `kind`, `direction` and `file`. It checks size ≤ 5 MB and the `.xlsx` extension.
- `commitImportAction(input: unknown)`.
- Both need `voucher:create` and revalidate `/vouchers`.

- [ ] **Step 1: Failing tests** (workbooks are built in-test with exceljs):
  - A 2-row purchase file previews as ready with recommendations.
  - Committing creates 2 pending vouchers when approval is on, with 135 split, partner created from the business number, and `voucher_imports` rows.
  - **`re-import is flagged and refused`:** previewing again shows `duplicate`; committing the same rows again returns `이미 불러온 자료입니다.` for each.
  - **`concurrent commit creates one voucher`:** two `commitImport` calls with the same row in `Promise.all` create exactly one voucher and one failure.
  - Deleting an imported voucher makes its row importable again.
  - With the company business number set, a sale file previewed as purchase fails with the wrong-direction message.
  - A row in a closed month and a row before the cut-off are blocked. At commit, one bad row fails while the other succeeds.
  - A card file with `cardPartnerId` and counter 253 creates vouchers whose `voucher_imports.meta.merchantName` is set.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Run `pnpm db:generate` for the enum and table.
- [ ] **Step 4: Run** `pnpm db:migrate`, `pnpm test`, lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(imports): preview and commit with duplicate protection"`

### Task 5: Import screen

**Files:**
- Modify: `src/app/(dashboard)/imports/page.tsx`
- Create: `src/components/imports/{import-screen,preview-table}.tsx`
- Test: `e2e/imports.spec.ts`

**Screen** (`/imports`):
- Tabs `전자세금계산서` | `카드 사용내역`. The tax-invoice tab has a radio `매입` / `매출`.
- A file input (`accept=".xlsx"`) and a `미리보기` button. Errors show above the table.
- **Batch fields:**
  - `상대 계정`: an `AccountPicker`, preselected by code (매입 251, 매출 108, 카드 253) if that account is active;
  - `카드사 거래처` (card tab only, a `PartnerPicker`);
  - 사업장/부서, shown like the entry screen.
- **Preview table columns:** checkbox · 날짜 · 거래처/가맹점 (badge `새 거래처` when there is no match on a tax invoice) · 적요 · 공급가액 · 세액 · 합계 · 계정 · 공제 (switch, purchase only) · 상태.
  - 계정 is a compact `AccountPicker`, prefilled with the first recommendation; its reason shows as muted text.
  - Ready rows start checked. Duplicate and blocked rows show their reason and are disabled.
- **Bulk:** select rows → `계정 일괄 지정` (an account picker) sets 계정 on the checked rows.
- `선택한 N건 전표 만들기` is disabled while any checked row has no account.
- After commit, show `N건을 전표로 만들었습니다.` and a list of failures with reasons. Created rows turn into links to their voucher, and failed rows stay checked.

- [ ] **Step 1: Failing e2e.**
  - Generate an `.xlsx` in the test with exceljs, using unique business numbers (valid checksum, computed) and approval numbers per run, and a date of today.
  - Upload 2 purchase invoices, set 계정 to 811 via bulk assign, and commit. The success message shows 2, and both appear in `/vouchers` searched by partner name.
  - Re-upload the same file and both rows show `이미 불러온 자료`.
  - A card file with one 봉사료 row shows that row disabled with its reason.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the spec, smoke, `no-base-ui-warnings`, lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(imports): bulk import screen for tax invoices and card purchases"`

### Task 6: Tax lists and multi-sheet workbooks

**Files:**
- Create: `src/server/exports/tax-lists.ts`
- Modify:
  - `src/server/exports/xlsx.ts` (`renderWorkbook`)
  - `src/server/exports/specs.ts`
  - `src/app/api/exports/[report]/route.ts`
- Test: `src/server/exports/tax-lists.test.ts`, `src/server/exports/xlsx.test.ts` (extend)

**Interfaces:**
- `renderWorkbook(specs: SheetSpec[]): Promise<Buffer>`: one sheet per spec, named by `title` (max 31 characters). `renderXlsx(spec)` becomes `renderWorkbook([spec])`.
- `src/server/exports/tax-lists.ts`:
  ```ts
  export type TaxInvoiceRow = { date: string; voucherNo: string; direction: "매출" | "매입"; evidence: "세금계산서" | "계산서";
    partnerName: string | null; businessNumber: string | null; supplyAmount: number; vatAmount: number; total: number;
    approvalNo: string | null; siteName: string };
  export type CardPurchaseRow = { date: string; voucherNo: string; evidence: "신용카드" | "현금영수증";
    merchantName: string | null; merchantBusinessNumber: string | null; supplyAmount: number; vatAmount: number;
    deductible: boolean; cardNo: string | null; description: string; siteName: string };
  export async function listTaxInvoices(db: Db, from: string, to: string): Promise<TaxInvoiceRow[]>;
  export async function listCardPurchases(db: Db, from: string, to: string): Promise<CardPurchaseRow[]>;
  ```
  - Both include posted vouchers only. `entryType` is purchase/sale for invoices and purchase for cards. `evidenceType` is `tax_invoice`/`invoice` for invoices and `card`/`cash_receipt` for cards.
  - Imported metadata (`voucher_imports.meta`) wins over the partner's fields. The site is the first line's site.
  - Order: date, voucher no.
- Tax keys extend the export route as a separate `TaxListKey = "tax-invoices" | "card-purchases"`, requiring `export:tax`. They use `from`/`to` only.
  - `tax-invoices` → a workbook with sheets `매출` and `매입`, each with a 합계 row.
  - `card-purchases` → one sheet `카드·현금영수증 매입`, with 공제 shown as `공제`/`불공제`.

- [ ] **Step 1: Failing tests.**
  - A posted purchase with a tax invoice, a pending one, and a rejected one: only the posted one is listed.
  - The imported approval number appears.
  - A card voucher imported with merchant meta lists the merchant, not the card-company partner.
  - `renderWorkbook` of two specs has two sheets with the right names.
  - The route returns 403 for `executive` on `tax-invoices`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, lint → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(exports): tax-invoice and card purchase lists for the 세무사"`

### Task 7: 세무사 package and page

**Files:**
- Create:
  - `src/server/exports/package.ts`
  - `src/app/api/exports/tax-package/route.ts`
  - `src/components/exports/tax-export.tsx`
- Modify: `src/app/(dashboard)/exports/page.tsx`, `package.json` (archiver, @types/archiver)
- Test: `src/server/exports/package.test.ts`, `e2e/exports.spec.ts`

**Interfaces:**
- `type PackageSummary = { invoicesSale: { count: number; total: number }; invoicesPurchase: { count: number; total: number }; cards: { count: number; total: number }; attachments: { count: number; bytes: number }; pending: number }`
- `getPackageSummary(db: Db, from: string, to: string): Promise<PackageSummary>`
- `buildTaxPackage(db: Db, from: string, to: string): Promise<Readable>`: an archiver zip stream (store level 1 for xlsx, 0 for already-compressed images/PDF). Entries:
  - `분개장.xlsx` and `합계잔액시산표.xlsx` via `buildSheetSpec` with `{ from, to }`
  - `세금계산서.xlsx`
  - `카드·현금영수증 매입.xlsx`
  - `증빙/<voucherNo>_<n>_<safeName>`: attachments of posted vouchers in range. `safeName` replaces `/ \ : * ? " < > |` and control characters with `_`, removes `..`, and is trimmed to 100 characters.
  - `누락된 증빙.txt`: only when some stored file is missing, one line per `<voucherNo> <fileName>`.
- Route `GET /api/exports/tax-package?from&to`:
  - needs `export:tax`;
  - 400 on invalid dates or `from > to`;
  - streams with `Readable.toWeb`;
  - `Content-Disposition` filename `세무사자료_<from>_<to>.zip`;
  - `Cache-Control: private, no-store`.

**Page** (`/exports`):
- Period inputs with presets `지난달`, `지난 분기`, and `올해` (fiscal year to date). The default is `지난 분기`, computed from `todayInSeoul`.
- The summary from `getPackageSummary`. When `pending > 0`, show `승인 대기 N건은 포함되지 않습니다.`
- Buttons: `전체 묶음(zip)`, `분개장`, `합계잔액시산표`, `세금계산서 목록`, `카드·현금영수증 목록`. Each is a link to the matching export URL, so it is a plain download.

- [ ] **Step 1: Failing tests.**
  - Unpack the zip from `buildTaxPackage` with `unzipper` (already installed transitively; add it as a devDependency):
    - entry names are as listed;
    - a pending voucher's attachment is absent;
    - deleting one stored file on disk yields `누락된 증빙.txt` naming it;
    - an attachment named `../../evil.png` is stored as `증빙/<no>_1_.._.._evil.png`, with no path traversal.
  - e2e: `/exports` shows the summary, and clicking `전체 묶음(zip)` downloads a file named `세무사자료_*.zip`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, lint, the e2e, smoke → PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(exports): 세무사 package (zip) and export page"`

### Task 8: Docs and full regression

**Files:** `CLAUDE.md`

- [ ] **Step 1: Update `CLAUDE.md`.**
  - Project line: add Phase 1E.
  - Architecture bullets:
    - **Imports:** pure parsers, `voucher_imports` as the dedup key, commit through `createVoucher`.
    - **Recommendation:** history plus the keyword fallback.
    - **Templates.**
    - **Exports:** the tax lists and the package.
- [ ] **Step 2: Full regression:** `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Only known showcase flakes may fail.
- [ ] **Step 3: Commit:** `git commit -m "docs: Phase 1E in CLAUDE.md"`
- [ ] **Step 4:** Push and deploy only after the user confirms.
  - Deploy: `git pull && docker compose --profile prod up -d --build`.
  - Check the migrations applied and `/login` returns 200.
