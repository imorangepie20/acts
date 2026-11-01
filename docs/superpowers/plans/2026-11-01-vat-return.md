# 부가가치세 신고 자료 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/exports/vat-return`은 승인된 매입·매출 전표로 일반과세자 부가가치세 신고서(별지 제21호서식)와 부속서류 세 가지의 칸을 채워 보여 주고, 같은 내용의 Excel을 준다. 매입·매출 폼에는 `종이 세금계산서`와 `홈택스 미등록 카드` 스위치를 추가한다.

**Architecture:**
- 전표 머리에 boolean 두 개(`paper_tax_invoice`, `unregistered_card`)를 추가하고, 간이 빌더·서비스 재검증·스냅숏에 연결한다.
- 순수 계산은 `src/lib/vat/`에 둔다. 기간 계산, 칸 정의, `VatEntry[]` → `VatReturn` 집계를 맡는다.
- DB 로더와 화면 모델은 `src/server/vat/`에 둔다.
- 화면은 `src/components/vat/`와 `src/app/(dashboard)/exports/vat-return/page.tsx`다.
- Excel은 기존 `GET /api/exports/[report]`에 `vat-return` 키로 붙인다. 원천세(`src/lib/withholding/`, `src/server/withholding/return-view.ts`, `return-sheet.ts`)와 같은 나눔이다.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle/Postgres, Vitest(실 DB `acts_test`), Playwright, exceljs, Base UI.

**Spec:** `docs/superpowers/specs/2026-11-01-vat-return-design.md`

## Global Constraints

- 대상 전표: `POSTED_STATUSES`(승인)뿐이다. `entry_type`은 `purchase` / `sale`만 쓴다. 날짜는 전표 `date`다. 음수 머리(수정·취소분)는 부호 그대로 더한다.
- 칸 번호와 이름은 별지 제21호서식 `<개정 2026. 3. 20.>`을 따른다. 그 밖의 공제매입세액은 (15), 공제받지 못할 매입세액은 (17), (11)은 수출기업 수입분 납부유예, (25)는 수시부과세액, (30)이 최종 납부세액이다. 예전 번호(14)/(16)을 쓰지 않는다.
- 계산하지 않는 칸에는 기존 `NOT_COMPUTED_TEXT`(`src/lib/withholding/return-rows.ts`, "이 프로그램에서 계산하지 않음")를 그대로 쓴다. 0과 구분한다.
- 홈택스에서 검증됐다거나 홈택스 화면과 같다는 문구를 쓰지 않는다.
- 전자신고세액공제는 5,000원이다. 출처는 조특법 시행령 제104조의5④, 대통령령 제36127호(2026. 2. 27.)다. `src/lib/vat/` 상수 하나로 둔다.
- 권한은 `export:tax`다. 경로는 `/exports/vat-return`이고 nav 제목은 `부가세 신고 자료`다.
- 문구는 스펙에 적힌 그대로 쓴다. "이 기간에 승인된 매입·매출 전표가 없습니다.", "계산하지 않은 칸은 0으로 보고 계산했습니다", "홈택스 전자신고 화면의 문구·순서는 확인하지 않았습니다. 서식(2026. 3. 20. 개정)의 칸 번호를 따릅니다.", "업태·종목별로 직접 나눠 적으세요", "사유별 명세는 직접 나눠 적으세요", "직접 입력".
- Base UI다. 링크 버튼에는 `render={<a/>}`와 `nativeButton={false}`를 쓴다.

**Ruling (스펙과 다름):** 스펙은 "증빙이 맞지 않으면 null"이라고 했다. 이 계획은 두 컬럼을 `not null default false`로 두고, check로 "true는 맞는 증빙에서만"을 강제한다. 이유는 다음과 같다.
- 기존 전표와 수십 개의 테스트 fixture가 그대로 유효하다.
- 의미가 같다. 맞지 않는 증빙이면 항상 false다.

타입에서는 `VoucherHeaderInput`과 `TradeInput`의 두 필드를 optional(`?: boolean`, 없으면 false)로 둔다.

## Review Focus

1. **고정자산 판정:** 매입 전표의 상대 계정이 비유동자산(예: 보증금)이고 주 계정은 비용인 경우 → 일반매입(10)이어야 한다. Task 4에서 테스트한다.
2. **수정·취소분:** 같은 기간에 정상분 1,000,000/100,000과 수정분 −1,000,000/−100,000이 있으면 → (1) 금액과 세액은 0, 합계표 매수는 2다. Task 3에서 테스트한다.
3. **개인 기본값:** 개인 회사에서 확정을 고르고 `prelim`이 없으면 → 여섯 달 전체를 집계한다. 법인은 석 달이다. Task 3에서 테스트한다.
4. **전자신고세액공제:** 예정이거나, 전표 0건이거나, `efile=0`이면 → (57)은 0이다. 확정이고 전표가 있으면 5,000이고, (30)은 그만큼 줄어든다. Task 3에서 테스트한다.
5. **잘못된 입력값:** `notice=-5` 또는 `notice=abc`이면 → 0으로 보고 오류 문구를 표시한다. 예정에서는 `notice`/`prelimRefund`를 무시한다. Task 4에서 테스트한다.

---

### Task 1: 전표 필드 두 개 (스키마·빌더·서비스·스냅숏)

**Files:**
- Modify: `src/server/db/schema.ts` (vouchers 테이블과 checks)
- Create: `drizzle/0019_*.sql`. `pnpm db:generate`가 이름을 정한다. package.json에 해당 스크립트가 없으면 `pnpm exec drizzle-kit generate`를 쓴다.
- Modify: `src/lib/vouchers/types.ts`, `src/lib/vouchers/simple.ts`, `src/server/vouchers/form.ts`, `src/server/vouchers/service.ts`, `src/server/vouchers/snapshot.ts`, `src/lib/vouchers/history.ts`
- Test: `src/lib/vouchers/simple.test.ts`, `src/server/vouchers/service.test.ts`, `src/lib/vouchers/history.test.ts`

**Interfaces:**
- Produces:
  - `vouchers.paperTaxInvoice` (`paper_tax_invoice boolean not null default false`)
  - `vouchers.unregisteredCard` (`unregistered_card boolean not null default false`)
  - checks:
    - `vouchers_paper_tax_invoice_evidence`: `not paper_tax_invoice or (evidence_type = 'tax_invoice' and entry_type in ('purchase','sale'))`
    - `vouchers_unregistered_card_evidence`: `not unregistered_card or (evidence_type = 'card' and entry_type = 'purchase')`
  - `VoucherHeaderInput.paperTaxInvoice?: boolean`, `VoucherHeaderInput.unregisteredCard?: boolean`
  - `TradeInput.paperTaxInvoice?: boolean`, `TradeInput.unregisteredCard?: boolean`
  - `ERR_PAPER = "종이 세금계산서는 세금계산서 증빙에만 표시할 수 있습니다."`, `ERR_UNREGISTERED_CARD = "홈택스 미등록 카드는 신용카드 매입에만 표시할 수 있습니다."` (simple.ts)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `simple.test.ts`:
    - `"carries 종이 세금계산서 and 미등록 카드 to the header and back"`: 매입, `tax_invoice`, `paperTaxInvoice: true`로 빌드하면 머리 `paperTaxInvoice === true`, `unregisteredCard === false`다. `toSimpleInput`으로 되돌리면 `paperTaxInvoice === true`다. 카드 매입 `unregisteredCard: true`도 같은 방식으로 확인한다.
    - `"rejects 종이 세금계산서 on a non-tax-invoice evidence"`: `evidenceType: "card"`, `paperTaxInvoice: true` → `ERR_PAPER`.
    - `"rejects 미등록 카드 on a sale or a non-card evidence"`: 매출 카드 `unregisteredCard: true` → `ERR_UNREGISTERED_CARD`. 매입 `cash_receipt` `unregisteredCard: true` → `ERR_UNREGISTERED_CARD`.
    - `"omitting the flags builds false"`: 필드를 빼고 빌드하면 둘 다 false다.
  - `service.test.ts`:
    - `"stores 종이 세금계산서 and re-validates it"`: 종이 매입을 생성하고 `getVoucher`로 읽으면 true다.
    - 같은 테스트 안에서, 일반 전표(`entryType: "general"`)에 `paperTaxInvoice: true`를 넣으면 `ERR_INVALID`(service의 기존 상수)다.
    - 필드 없는 기존 fixture 매입은 계속 성공한다.
  - `history.test.ts`: `"describes a 종이 세금계산서 change"`: prev에 필드가 없고(예전 스냅숏) next가 true이면 → `"종이 세금계산서: 아니요 → 예"`가 들어 있다.

- [ ] **Step 2: 실행해서 실패 확인**
  Run: `pnpm test src/lib/vouchers src/server/vouchers`
  Expected: 새 테스트가 FAIL(필드 없음 / 오류 문구 없음).

- [ ] **Step 3: 구현**
  - **schema:** 컬럼 두 개와 check 두 개를 추가한다. 마이그레이션을 생성한 뒤 `pnpm db:migrate`를 실행한다. 테스트 DB에는 helper가 적용하는지 확인한다.
  - **simple.ts:**
    - `validateTrade`에서 `paperTaxInvoice && evidenceType !== "tax_invoice"`이면 `ERR_PAPER`를 돌려준다.
    - `unregisteredCard && (type !== "purchase" || evidenceType !== "card")`이면 `ERR_UNREGISTERED_CARD`를 돌려준다.
    - `emitSimple`은 trade 머리에 `paperTaxInvoice: input.paperTaxInvoice === true`, `unregisteredCard: input.unregisteredCard === true`를 넣는다. transfer는 둘 다 false다.
    - `toSimpleInput`은 `v.paperTaxInvoice === true` / `v.unregisteredCard === true`를 그대로 옮긴다.
  - **form.ts:** 전표 zod 스키마 두 곳(일반 머리와 trade 입력)에 `z.boolean().optional()`을 추가한다.
  - **service.ts:**
    - 일반 전표 가드 조건에 `input.paperTaxInvoice === true || input.unregisteredCard === true`를 더한다.
    - `sameVoucher`는 두 키를 `(a[k] ?? false) === (b[k] ?? false)`로 비교한다. 기존 headerKeys 비교와 분리한다.
    - insert와 update에 `paperTaxInvoice: input.paperTaxInvoice ?? false`, `unregisteredCard: input.unregisteredCard ?? false`를 쓴다.
    - `getVoucher` 등 머리를 읽는 곳이 두 값을 돌려주도록 한다.
  - **snapshot.ts:** 같은 `?? false`로 두 필드를 저장한다.
  - **history.ts:** `describeChanges`에 `diff("종이 세금계산서", yes(prev.paperTaxInvoice), yes(next.paperTaxInvoice))`와 `"홈택스 미등록 카드"` diff를 추가한다. `yes = (v?: boolean) => (v ? "예" : "아니요")`다.

- [ ] **Step 4: 통과 확인**
  Run: `pnpm test src/lib/vouchers src/server/vouchers src/server/imports src/server/templates && pnpm exec tsc --noEmit`
  Expected: 모두 PASS, 타입 오류 없음.

- [ ] **Step 5: 커밋**
  `git commit -m "feat(vouchers): 종이 세금계산서 and 홈택스 미등록 카드 flags"`

### Task 2: 매입·매출 폼 스위치와 상세 표시

**Files:**
- Modify: `src/components/vouchers/trade-form.tsx`, `src/components/vouchers/voucher-detail.tsx`, `src/app/(dashboard)/vouchers/[id]/edit/page.tsx`(init에 두 값 전달)
- Test: `e2e/vouchers.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `TradeInput.paperTaxInvoice` / `unregisteredCard`, 그리고 머리를 읽을 때의 두 필드.

- [ ] **Step 1: 실패하는 e2e 작성**
  `"전표: 종이 세금계산서 스위치가 저장되고 수정 화면에서 켜져 있다"`
  - 매입 폼에서 증빙을 세금계산서로 두고 `종이 세금계산서` 스위치를 켠다. 상대 계정은 101이다.
  - 저장 후 상세에 `종이 세금계산서`가 보인다.
  - 수정 화면에서 스위치가 `checked` 상태다.
  - 증빙을 신용카드로 바꾸면 `종이 세금계산서` 스위치가 사라지고 `홈택스 미등록 카드`가 보인다.
- [ ] **Step 2: 실행해서 실패 확인**
  Run: `pnpm exec playwright test e2e/vouchers.spec.ts -g "종이 세금계산서"`
  Expected: FAIL(스위치 없음).
- [ ] **Step 3: 구현**
  - **trade-form.tsx:** 상태 `paper` / `unregistered`를 init 값으로 시작하고, 없으면 false다.
    - `종이 세금계산서` 스위치(`id={`${p}-paper`}`)는 증빙이 `tax_invoice`일 때만 보인다.
    - `홈택스 미등록 카드` 스위치(`id={`${p}-unregistered`}`)는 매입이고 증빙이 `card`일 때만 보인다.
    - 증빙이 맞지 않으면 제출할 때 false를 보낸다. 상태를 따로 지우지 않아도 된다.
    - 템플릿 저장 본문에는 넣지 않는다(`TemplateBody` 변경 없음). 템플릿을 적용하면 false다.
  - **voucher-detail.tsx:** 값이 true일 때만 증빙 옆에 `종이 세금계산서` / `홈택스 미등록 카드` 배지를 보인다.
- [ ] **Step 4: 통과 확인**
  Run: `pnpm exec playwright test e2e/vouchers.spec.ts && pnpm lint`
  Expected: PASS, lint 오류 0.
- [ ] **Step 5: 커밋**
  `git commit -m "feat(vouchers): paper-invoice and unregistered-card switches on the trade form"`

### Task 3: 순수 계산 `src/lib/vat/`

**Files:**
- Create: `src/lib/vat/types.ts`, `src/lib/vat/periods.ts`, `src/lib/vat/rows.ts`, `src/lib/vat/return.ts`, `src/lib/vat/notices.ts`
- Test: `src/lib/vat/periods.test.ts`, `src/lib/vat/return.test.ts`

**Interfaces:**
- Produces:
```ts
// types.ts
export type VatEntry = {
  entryType: "purchase" | "sale";
  evidenceType: EvidenceType; vatType: VatType; vatDeductible: boolean | null;
  supplyAmount: number; vatAmount: number;
  /** purchase only: main (first) line's account group is noncurrent_asset */
  fixedAsset: boolean;
  paperTaxInvoice: boolean; unregisteredCard: boolean;
  /** 10 digits, or null when the partner has none */
  businessNumber: string | null;
  partnerName: string | null;
  /** distinct-partner key: business number, else `p:<partnerId>`, else `none` */
  partnerKey: string;
  cardNo: string | null;
};
export type Amounts = { amount: number; tax: number };
export type Tally = { count: number; supplyAmount: number; vatAmount: number };
export type PartnerTally = Tally & { partners: number };
export type InvoiceSummary = {
  total: PartnerTally;
  electronic: { bn: PartnerTally; rrn: PartnerTally; subtotal: PartnerTally };
  other: { bn: PartnerTally; rrn: PartnerTally; subtotal: PartnerTally };
  /** 전자 외 + 사업자등록번호 발급분, one row per business number, sorted by it */
  otherByPartner: (Tally & { businessNumber: string; name: string | null })[];
};
export type CardStatement = {
  total: Tally; cashReceipt: Tally; businessCard: Tally; otherCard: Tally;
  /** ⑧ by (cardNo, businessNumber); cardNo null = 직접 입력 */
  otherDetail: (Tally & { cardNo: string | null; businessNumber: string | null })[];
};
// periods.ts
export type VatKind = "prelim" | "final";
export type VatSelection = {
  year: number; term: 1 | 2; kind: VatKind;
  prelimFiled: boolean; efile: boolean; prelimRefund: number; notice: number;
  errors: { prelimRefund?: string; notice?: string };
};
export function vatPeriod(s: Pick<VatSelection, "year" | "term" | "kind" | "prelimFiled">): { from: string; to: string };
export function defaultVatPeriod(today: string, businessType: "corporation" | "individual"): Pick<VatSelection, "year" | "term" | "kind">;
export function parseVatParams(sp: Record<string, string | string[] | undefined>, ctx: { today: string; businessType: "corporation" | "individual" }): VatSelection;
// rows.ts
export type VatRow = { no: number; label: string; rate?: string; shadedAmount?: boolean; computed: boolean };
export type VatRowGroup = { label: string; rows: VatRow[] };
export const PAGE1_GROUPS: VatRowGroup[];   // (1)–(30); 납부(환급)세액 ㉰ is rendered between (18) and (19) by the component
export const PAGE4_GROUPS: VatRowGroup[];   // (36)–(43), (44)–(52), (53)–(56), (57)–(63), (64)–(84), (85)–(88), (89)–(90)
// return.ts
export type VatReturn = {
  rows: Map<number, Amounts>;            // computed rows only
  payable: number;                       // ㉰ = (9).tax − (18).tax
  taxDiff: Map<1 | 2 | 3 | 4, number>;   // only rows whose tax ≠ trunc(amount × 10 / 100)
  sales: InvoiceSummary; purchases: InvoiceSummary; card: CardStatement;
  entryCount: number;
};
export function buildVatReturn(entries: VatEntry[], s: VatSelection): VatReturn;
// notices.ts
export const E_FILING_CREDIT = 5000; // 조특법 시행령 §104의5④, 대통령령 제36127호 (2026. 2. 27.)
export const EMPTY_VAT_NOTICE: string; export const VAT_SOURCE_NOTICE: string; export const ZERO_ASSUMED_NOTICE: string;
export const BY_INDUSTRY_NOTICE: string; export const BY_REASON_NOTICE: string; export const ENTER_DIRECTLY: string;
export const taxDiffNotice: (diff: number) => string; // `금액 × 10%와 ${formatWon(|diff|)}원 차이`
```

- [ ] **Step 1: 실패하는 테스트 작성**
  - `periods.test.ts`:
    - `vatPeriod`:
      - `{2026,1,prelim}` → 2026-01-01~2026-03-31
      - `{2026,1,final,prelimFiled:true}` → 04-01~06-30
      - `{2026,1,final,prelimFiled:false}` → 01-01~06-30
      - `{2026,2,final,true}` → 10-01~12-31
      - `{2026,2,prelim}` → 07-01~09-30
    - `defaultVatPeriod`:
      - ("2026-11-01", corporation) → `{2026,2,prelim}`
      - ("2026-11-01", individual) → `{2026,1,final}`
      - ("2026-01-10", corporation) → `{2025,2,final}`
    - `parseVatParams`:
      - 파라미터 없음 + individual → `prelimFiled false`, `efile true`
      - corporation → `prelimFiled true`
      - `prelim=0` → false
      - `notice=-5` → `notice 0`, `errors.notice` 존재
      - `notice=120000`, `kind=final` → 120000
      - `kind=prelim`, `notice=120000` → `notice 0`, 오류 없음
      - `term=3` → 기본값
  - `return.test.ts`(fixture 함수 `entry(over: Partial<VatEntry>)`):
    - `"sorts sales into (1)–(6) and totals (9)"`: 과세 세금계산서 1,000,000/100,000, 과세 카드 200,000/20,000, 과세 none 50,000/5,000, 영세 세금계산서 300,000/0, 영세 none 10,000/0 → (1)(3)(4)(5)(6)이 각각 그 값이고, (9) = 1,560,000/125,000이다.
    - `"splits 세금계산서 수취분 into (10)/(12) and nets (17)"`: 매입 세금계산서
      - 일반·공제 500,000/50,000
      - 고정자산·공제 2,000,000/200,000
      - 일반·불공제 100,000/10,000
      → (10) 600,000/60,000, (12) 2,000,000/200,000, (53)=(56)=(17) 100,000/10,000, (16) 2,600,000/260,000, (18) 2,500,000/250,000이다.
    - `"puts deductible card/현금영수증 into (44)/(45) and skips non-deductible"`: 카드 공제 일반 30,000/3,000, 현금영수증 공제 고정자산 1,000,000/100,000, 카드 불공제 9,000/900 → (44) 30,000/3,000, (45) 1,000,000/100,000, (52)=(15) 합이다. 불공제 카드는 어디에도 없다.
    - `"nets a 수정·취소분 to zero and counts both"`: Review Focus 2.
    - `"(57) only on a 확정 with entries and efile"`: Review Focus 4. (30) = ㉰ − 5,000 − prelimRefund − notice.
    - `"exempt sales and 계산서 go to (88)/(89)/(90)"`: 면세 매출 계산서 400,000 → (88) 400,000, (89) 400,000. 면세 매입 계산서 70,000 → (90) 70,000. (1)–(18)에는 들어가지 않는다.
    - `"taxDiff flags rows whose tax is not 10%"`: 과세 카드 매출 99,999/9,091 → `taxDiff.get(3) === 91`. 맞으면 키가 없다.
    - `"invoice summary splits 전자/전자 외 and 사업자/주민 and lists 전자 외 by partner"`: 매출 세금계산서
      - 전자 bn A 2건
      - 종이 bn B 1건
      - 종이 bn B 1건(수정분 음수)
      - 종이 businessNumber null 1건
      → `electronic.bn.count 2 partners 1`, `other.bn.count 2 partners 1`, `other.rrn.count 1`, `otherByPartner = [{businessNumber:B, count:2, 금액 합}]`, `total.count 5`.
    - `"card statement ⑤/⑦/⑧ and ⑧ detail"`: 현금영수증 공제 1건, 등록 카드 공제 2건, 미등록 카드 공제 2건(같은 cardNo·같은 가맹점) + 1건(cardNo null) → `cashReceipt.count 1`, `businessCard.count 2`, `otherCard.count 3`, `otherDetail.length 2`이고 null cardNo 행이 있다. `total`의 금액·세액 = (44)+(45)다.
- [ ] **Step 2: 실행해서 실패 확인**
  Run: `pnpm test src/lib/vat`
  Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현**
  - **rows.ts:** 스펙의 Sources 표와 research 노트에 있는 이름을 서식 그대로 쓴다. 파일 머리에 `// Row layout of 별지 제21호서식 <개정 2026. 3. 20.> (law.go.kr flSeq=162619805).`를 적는다.
    - `computed`가 true인 칸: 1, 3, 4, 5, 6, 9, 10, 12, 15, 16, 17, 18, 19, 21, 23, 24, 30, 35, 44, 45, 52, 53, 56, 57, 63, 88, 89, 90. 나머지는 false다.
    - `shadedAmount`: 11, 19, 26, 27, 28, 48–51, 57–63.
    - `rate`: (1)–(4)는 `"10/100"`, (5)–(6)은 `"0/100"`.
  - **return.ts:** 스펙 "전표 → 신고서 칸" 표의 조건을 그대로 쓴다.
    - (16)은 `(10)−(11)+(12)+(13)+(14)+(15)`, 계산하지 않는 칸은 0이다.
    - (35) 금액 = (9) 금액이다.
    - (23)/(24)는 `kind === "final"`일 때만 s 값을, 아니면 0이다.
    - 합계표 대상은 `evidenceType === "tax_invoice"`뿐이고 공제 여부와 무관하다.
    - 수령명세서 대상은 `card` / `cash_receipt`이면서 `vatDeductible === true`다.
- [ ] **Step 4: 통과 확인**
  Run: `pnpm test src/lib/vat`
  Expected: PASS.
- [ ] **Step 5: 커밋**
  `git commit -m "feat(vat): pure VAT return builder (별지 제21호서식, 합계표, 수령명세서)"`

### Task 4: 로더와 화면 모델 `src/server/vat/`

**Files:**
- Create: `src/server/vat/entries.ts`, `src/server/vat/view.ts`
- Test: `src/server/vat/entries.test.ts`, `src/server/vat/view.test.ts`

**Interfaces:**
- Consumes: Task 1 컬럼. Task 3 `VatEntry`, `parseVatParams`, `vatPeriod`, `buildVatReturn`.
- Produces:
```ts
export async function loadVatEntries(db: Db, from: string, to: string): Promise<VatEntry[]>;
export type VatView = {
  selection: VatSelection; period: { from: string; to: string };
  company: { name: string; businessNumber: string | null; representative: string | null; businessType: "corporation" | "individual" };
  result: VatReturn;
};
export async function loadVatView(db: Db, sp: Record<string, string | string[] | undefined>): Promise<VatView>;
```

- [ ] **Step 1: 실패하는 테스트 작성**(`seedReference(db)`와 실제 `createVoucher`를 쓴다)
  - `entries.test.ts`:
    - `"reads posted purchase/sale vouchers only"`: pending 매출, 일반 전표, 기간 밖 전표는 빠진다.
    - `"fixedAsset follows the main line, not the counter account"`: Review Focus 1.
      - 주 계정이 비용이고 상대 계정이 비유동자산(시드 표준 계정에서 `noncurrent_asset` 그룹 하나를 코드로 찾는다)이면 `fixedAsset false`다.
      - 주 계정이 비유동자산(예: 비품)이면 true다.
      - 수정·취소분 음수 매입도 같은 판정이다.
    - `"uses import meta for name, business number and card no"`: 카드 import로 만든 전표의 `cardNo`와 가맹점 사업자번호가 meta 값이다. 거래처 사업자번호 `"123-45-67890"` 형식은 digits 10자리로 바뀐다.
  - `view.test.ts`:
    - `"defaults from the company business type"`: 회사를 `individual`로 바꾸면 `selection.prelimFiled === false`이고, 확정 기간이 여섯 달이다.
    - `"invalid notice falls back to 0 with an error"`: Review Focus 5.
- [ ] **Step 2: 실행해서 실패 확인**
  Run: `pnpm test src/server/vat`
  Expected: FAIL.
- [ ] **Step 3: 구현**
  - **entries.ts:** `tax-lists.ts`의 `loadVouchers`와 같은 join을 쓴다(partners, voucherImports). 조건은 posted + 두 entry type + 기간이다.
    - 매입 전표 id들의 첫 줄(`lineNo` 최소) 계정 그룹을 `accounts.group`과 한 번에 읽는다.
    - 사업자번호는 `meta.merchantBusinessNumber ?? partner.businessNumber`에서 숫자만 남긴다. 10자리가 아니면 null이다.
    - `partnerKey`는 bn → `p:${partnerId}` → `"none"` 순으로 정한다.
  - **view.ts:** `getCompany`, `todayInSeoul`, `parseVatParams`, `vatPeriod`, `loadVatEntries`, `buildVatReturn`를 차례로 부른다.
- [ ] **Step 4: 통과 확인**
  Run: `pnpm test src/server/vat`
  Expected: PASS.
- [ ] **Step 5: 커밋**
  `git commit -m "feat(vat): load VAT entries and the return view"`

### Task 5: 화면, nav, Excel, e2e

**Files:**
- Create: `src/app/(dashboard)/exports/vat-return/page.tsx`, `src/components/vat/vat-period-picker.tsx`(client), `src/components/vat/vat-return-form.tsx`, `src/components/vat/invoice-summary.tsx`, `src/components/vat/card-statement.tsx`, `src/server/vat/sheets.ts`, `e2e/vat-return.spec.ts`
- Modify: `src/lib/nav.ts`(결산·세무 그룹, `세무사 자료` 다음), `src/server/exports/specs.ts`(`VAT_RETURN_KEY = "vat-return"`, `exportPermission` → `export:tax`), `src/app/api/exports/[report]/route.ts`, `CLAUDE.md`(Architecture에 VAT 한 줄, 프로젝트 줄)
- Test: `src/server/vat/sheets.test.ts`, `src/server/exports/specs.test.ts`(권한)

**Interfaces:**
- Consumes: Task 4 `loadVatView`, `VatView`. Task 3 `PAGE1_GROUPS`, `PAGE4_GROUPS`, notices.
- Produces: `buildVatSheets(view: VatView): { fileName: string; sheets: SheetSpec[] }`. 시트는 `신고서`, `매출처별 합계표`, `매입처별 합계표`, `신용카드 수령명세서`이고, 파일명은 `부가세신고자료_${year}_${term}기_${예정|확정}`이다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `sheets.test.ts`:
    - `"four sheets with the form's row numbers"`: 시트 제목 4개와 파일명을 확인한다. `신고서` 시트에 `(15)`, `(17)`, `(30)` 행이 있다. 계산하지 않는 (2) 행의 세액 셀은 `NOT_COMPUTED_TEXT`다.
    - `"합계표 sheet lists 전자 외 partners"`: 종이 거래처 행이 있다.
  - `specs.test.ts`: `exportPermission("vat-return") === "export:tax"`.
  - `e2e/vat-return.spec.ts`: `"부가세 신고 자료: 종이 세금계산서 매입이 매입처별 명세와 (10)에 나온다"`
    - API나 폼으로 2003-02-10에 종이 매입 세금계산서 전표를 만든다. 고유 거래처와 사업자번호를 쓴다.
    - `/exports/vat-return?year=2003&term=1&kind=prelim`을 연다.
    - 매입처별 합계표 명세에 그 사업자번호가 있다.
    - `(10)` 행 금액이 0이 아니다.
    - `VAT_SOURCE_NOTICE` 문구가 보인다.
    - Excel 링크 응답이 200이고 content-type이 xlsx다.
- [ ] **Step 2: 실행해서 실패 확인**
  Run: `pnpm test src/server/vat src/server/exports && pnpm exec playwright test e2e/vat-return.spec.ts`
  Expected: FAIL.
- [ ] **Step 3: 구현**
  - **page:** `requirePermission("export:tax")` → `loadVatView`. 제목은 `부가세 신고 자료`다. 원천세 page처럼 Excel 버튼을 두고 해석된 selection으로 qs를 만든다. `PrintButton`을 함께 쓴다.
  - **vat-period-picker:** GET form이다. 연도, 기(1·2), 구분(예정·확정), `예정신고를 했음` 체크(확정일 때만), `전자신고세액공제 적용` 체크, 확정일 때 (23)/(24) 숫자 입력이 있다. 오류는 입력칸 아래에 표시한다.
  - **vat-return-form:**
    - 칸 번호 | 이름 | 금액 | 세율 | 세액 표다.
    - 음영 칸은 비우고, 계산하지 않는 칸은 `NOT_COMPUTED_TEXT`다.
    - (18) 다음에 `납부(환급)세액 ㉰` 행을 둔다. `taxDiff`가 있는 칸 아래에 `taxDiffNotice`를 보인다.
    - (30) 옆에 `ZERO_ASSUMED_NOTICE`를 두고, 음수이면 `환급받을 세액`이다.
    - (31)–(34)는 `BY_INDUSTRY_NOTICE`, (53) 아래는 `BY_REASON_NOTICE`, (57) 아래는 근거 문구(조특법 시행령 제104조의5④)다.
    - 위쪽에 `VAT_SOURCE_NOTICE`와 기간, 전표 건수를, 0건이면 `EMPTY_VAT_NOTICE`를 보인다.
  - **invoice-summary:**
    - 매출처별·매입처별 각각 총합계 표(합계 / 전자 / 전자 외 × 사업자·주민·소계)와 전자 외 처별 명세가 있다.
    - 명세가 5행을 넘으면 `6번째부터는 (을) 서식에 적습니다.`를 보인다.
  - **card-statement:**
    - ④⑤⑥⑦⑧ 합계 표가 있고, ⑥은 `NOT_COMPUTED_TEXT`다.
    - ⑧ 명세에서 cardNo가 null이면 `ENTER_DIRECTLY`다.
    - 명세가 15행을 넘으면 `16번째부터는 (을) 서식에 적습니다.`를 보인다.
  - **nav:** `{ title: "부가세 신고 자료", href: "/exports/vat-return", icon: FileText, permission: "export:tax" }`.
  - **route:** `VAT_RETURN_KEY` 분기에서 `xlsxResponse(await renderWorkbook(sheets), fileName)`을 돌려준다. 0건이어도 파일을 준다.
- [ ] **Step 4: 통과 확인**
  Run: `pnpm test && pnpm lint && pnpm build && pnpm exec playwright test`
  Expected: 모두 PASS. smoke가 새 경로를 렌더하고, `no-base-ui-warnings`도 통과한다.
- [ ] **Step 5: 화면 확인**
  2003 1기 예정 화면과 Excel을 캡처해 직접 본다(메모리: 실제 UI를 확인하고 나서 완료라고 말한다).
- [ ] **Step 6: 커밋**
  `git commit -m "feat(vat): /exports/vat-return screen and Excel"`
