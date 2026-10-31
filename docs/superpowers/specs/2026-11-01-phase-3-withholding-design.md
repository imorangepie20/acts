# Phase 3 — 원천세 신고 (원천징수이행상황신고서 집계 · 근로소득 간이지급명세서 파일)

## Intent

A company's 회계담당자 uses acts to file withholding tax. Every month (or every half
year for 반기 신고) they open acts before the 10th, see the 원천징수이행상황신고서
figures laid out exactly like the official form, and type them into 홈택스. Twice a
year they download the 근로소득 간이지급명세서 file from acts and upload it to 홈택스
as is (변환신고).

The user develops the program only; no real company uses it yet, and nobody has a
홈택스 account or business certificate to test an upload. So the file is built from
the officially published layout and labelled "홈택스 검증 전" everywhere until someone
actually uploads one.

## Why this shape (what we found)

- The 원천징수이행상황신고서 **electronic file** layout is not published on nts.go.kr
  (checked 원천세 주요서식 board, 95 posts; 원천세 참고자료실, 32 posts; web search). It
  appears to go to tax-software vendors only. So the 신고서 is a **screen to copy from**,
  not a file.
- The paper form is public and current: 소득세법 시행규칙 별지 제21호서식 <개정 2026. 5. 22.>,
  NTS 원천세 주요서식 post 1347750 (viewer:
  `https://doc.nts.go.kr:8080/SynapDocViewServer/viewer/doc.html?key=9f60ad2005d04a2fa9e7f99fcbe81f22`).
  The screen follows its row codes, column numbers and 작성방법.
- The 근로소득 간이지급명세서 file layout is public, but the newest edition found is the
  2021 상반기 edition (`https://www.nts.go.kr/comm/nttFileDownload.do?fileKey=c50718c2e2935c06f3eecec459081084`,
  listed at `https://www.nts.go.kr/nts/na/ntt/selectNttInfo.do?nttSn=1295164&mi=2207`).
  Its record tables are copied into the appendix below. Whether it changed since 2021 is
  unknown.
- 간이지급명세서(근로소득) is currently **반기** (1–6월분 due 7/31, 7–12월분 due 1/31).
  Monthly filing was deferred to wages paid from 2027-01 (NTS page
  `https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=40678&cntntsId=239032`); no monthly
  layout is published. Monthly is out of scope.

## Goals

1. **원천징수이행상황신고서 screen** (`/payroll/withholding`): pick 귀속연월 and 지급연월
   (or, for 반기 신고, year + 상/하반기). Shows page 1 of 별지 제21호서식 with the same row
   codes and column numbers, filled from confirmed payroll runs. Print view and Excel.
2. **근로소득 간이지급명세서** (`/payroll/simplified-statement`): pick year + 상/하반기.
   Preview table per employee, then download the fixed-length file (`SC<사업자번호 앞7>.<뒤3>`)
   and an Excel of the same rows.
3. Company settings gain what the file needs (see Data).

## Non-goals

- The 원천징수이행상황신고서 electronic file (layout not public).
- 수정신고, 원천징수세액환급신청서, 부표 (pages 4–10 of the form), 소득처분, 연말정산 rows.
- A02 중도퇴사, A03 일용근로, A04–A06 연말정산, 퇴직·사업·기타·연금·이자·배당 rows — acts has no
  data for them. They are shown empty with "이 프로그램에서 계산하지 않음".
- 지방소득세 신고 (위택스) — only its total is shown for reference.
- Monthly 간이지급명세서 (2027), annual 근로소득 지급명세서 (needs 연말정산).
- Filing status tracking, deadlines/reminders, warnings that an already-filed month changed.

## Anti-goals

- Never call the file verified or 홈택스-compatible. The "홈택스 검증 전" label stays on the
  screen and in the download dialog until a real upload succeeds.
- Never put a 주민등록번호 in plain text anywhere except inside the downloaded file.
- Never invent figures for rows acts cannot compute.

## The 신고서 screen (decided)

Source data: confirmed `payroll_runs` and their `payroll_run_lines.result`.

- **Monthly:** a run belongs to the return whose 귀속연월 = `run.yearMonth` and whose
  지급연월 = month of `run.payDate`. One 지급월 can hold several 귀속월 (e.g. a 상여 for an
  earlier month); the screen lists the 귀속/지급 pairs that have confirmed runs and shows one
  form per pair, per the form's rule that each 귀속연월 is reported separately.
- **반기:** 귀속연월 = the half's first month, 지급연월 = its last month (작성방법 4.다);
  includes runs paid in that half. A01 인원 = headcount of the half's last month (작성방법 4.가.1).
- **A01 근로소득 간이세액:** ④ 인원 = distinct employees paid; ⑤ 총지급액 = gross pay including
  비과세, **except** 비과세 items excluded by 소득세법 시행령 제214조제1항제2호의2·제2호의3
  (작성방법 2.라); ⑥ 소득세 등 = withheld 소득세. ⑦ 농어촌특별세 and ⑧ 가산세 are 0.
- **A10 가감계** = A01 for these figures (A02–A04/A06 are empty). **A99 총합계** = A10.
- **⑫ 전월미환급세액** is typed in by the user on the screen (not stored); ⑨ 당월조정환급세액,
  ⑩ 납부세액 and ⑳ 차월이월환급세액 follow 작성방법 3.라.
- **지방소득세** total (sum of `deductions.localTax`) is shown below the form, labelled 위택스 신고용.
- Rows acts cannot compute are drawn empty with "이 프로그램에서 계산하지 않음".

## The 간이지급명세서 file (decided)

- **Which pay:** confirmed runs whose 귀속월 (`run.yearMonth`) lies in the half (근무시기 B10:
  1 = 1–6월, 2 = 7–12월). This deliberately differs from the 반기 신고서, which goes by 지급월:
  the file's half is a **근무시기** (B10's name, and C12/C13 must lie inside it), so a 12월 귀속
  run paid in January belongs to 하반기 in the file and to the next 상반기 신고서. The two
  screens therefore do not cross-check totals. (My call from the layout's wording; if a real
  upload shows 홈택스 expects 지급 basis, this is the rule to change.) With 귀속 basis every
  included employee worked in the half, so the work period never falls outside it.
- **One C record per employee** per continuous work period in the half. Work period =
  max(입사일, half start) – min(퇴사일, half end). (Re-hire with a gap gets separate C records
  per the layout; acts has one 입사/퇴사 per employee, so in practice one record.)
- **C14 급여 등** = sum of `result.taxable` (excludes 비과세 and 인정상여). **C15 인정상여** = 0.
- **C9 내외국인** = 1, **C10 거주자구분** = 1, **C11** = blank — acts has no foreign or
  non-resident employees field; adding one is out of scope (builder: note it in the UI help).
- **Encoding:** EUC-KR (KSC-5601 완성형), every record exactly 190 bytes measured in EUC-KR bytes;
  X fields left-aligned space-padded, 9 fields right-aligned zero-padded. Hangul names must be
  truncated on a character boundary so a 2-byte character is never split.
- **Line ending:** CRLF after each record (my call — the layout does not say).
- **A8 세무프로그램코드** = `9000` (기타프로그램). **A5 제출자 구분** = 2 (법인) or 3 (개인) from the
  company type. **A6** blank. **A4 제출연월일** = download date.
- **File name:** `SC` + 사업자등록번호 digits 1–7 + `.` + digits 8–10 (e.g. `SC1234567.890`).
- **Validation before download** mirrors the layout's 오류기준: RRN valid, name present, counts
  and sums consistent (A14 = number of B; B11 = number of C; B12 = ΣC14), dates inside the half.
  Refuse with a Korean message naming the employee and field.
- Downloading decrypts each 주민등록번호, so it needs `payroll:manage` + verified 2FA and the
  encryption key, and writes one `payroll_audit` row per download (new field value
  `simplified_statement`, employee = each included employee, or a new table — builder's call).

## Data (decided)

Add to `company` (settings page, admin):
- `taxOfficeCode` (세무서코드, 3 digits) — required for the file.
- `businessType` (`corporation` | `individual`).
- `corporateNumber` (법인등록번호, 13 digits, required when corporation).
- `withholdingSemiannual` (boolean, 반기별 납부 승인).
- `hometaxId`, `filingContactDept`, `filingContactName`, `filingContactPhone`.

For an individual business, B8 needs the 대표자 주민등록번호: typed into the download dialog each
time, never stored.

Add to `payroll_items`: `excludeFromTotalPaid` (boolean) — the 비과세 items of 시행령 제214조제1항
제2호의2·제2호의3 that ⑤ 총지급액 leaves out. Checked on law.go.kr (2026-11-01, 시행령 제214조
current through the 2025. 12. 30. revision):
- 제2호의2 lists 법 제12조제3호 가–사, 카, 타, 하, 너, 버, 저목. 식사대 is 러목 → **not excluded**:
  `meal` seeds `false`.
- 제2호의3 lists 시행령 제12조제2호–제4호 and 제8호. 제12조제3호 is 일직료·숙직료·여비 including
  the 자가운전보조금 → **excluded**: `car` seeds `true`.
Other built-in items are taxable, so `false`.

So that ⑤ for a filed month does not drift when item settings change later, the run calc stores
the excluded 비과세 amount on each line: `LineResult.excludedNontaxable` (sum over items with
`excludeFromTotalPaid` of `min(amount, nontaxLimit)`, the same split `calc.ts` already makes).
⑤ = Σ(`gross` − `excludedNontaxable`). Lines computed before this phase have no such field;
for them the screen recomputes it from `amounts` and the current item settings. (My call.)

## Permissions and navigation (decided)

- Both screens need `payroll:manage` (the 신고서 shows payroll totals; the file holds RRNs).
- Two items under the 급여 nav group in `src/lib/nav.ts`: "원천세 신고", "간이지급명세서".
- The 2FA requirement already applies to `payroll:manage` users (manager, admin).

## Left to the builder

- Screen layout details, print CSS, Excel layout.
- Whether the audit is a new enum value or table.
- Tests: pure builders for the 신고서 figures and the fixed-length records (byte lengths in EUC-KR,
  padding, Hangul truncation, sums), plus an e2e that downloads the file and checks its length is
  a multiple of 192 (190 + CRLF) and the record order is A, B, C….

## Appendix — 근로소득 간이지급명세서 layout (2021 상반기 edition)

Types: `X(n)` text, left-aligned, space-padded; `9(n)` number, right-aligned, zero-padded, no sign.
"끝" is the cumulative end position (1-based).

**A 제출자 레코드** (one per file)

| # | 항목 | 형식 | 끝 | 내용 |
|---|---|---|---|---|
| A1 | 레코드 구분 | X(1) | 1 | `A` |
| A2 | 자료구분 | 9(2) | 3 | `77` |
| A3 | 세무서코드 | X(3) | 6 | 제출자 관할 세무서 |
| A4 | 제출연월일 | 9(8) | 14 | YYYYMMDD |
| A5 | 제출자 구분 | 9(1) | 15 | 1 세무대리인 / 2 법인 / 3 개인 |
| A6 | 세무대리인 관리번호 | X(6) | 21 | 세무대리인 아니면 공란 |
| A7 | 홈택스 ID | X(20) | 41 | 홈택스 전자신고 시 필수 |
| A8 | 세무프로그램코드 | X(4) | 45 | 기타 `9000` |
| A9 | 사업자등록번호 | X(10) | 55 | '-' 제거 |
| A10 | 법인명(상호) | X(30) | 85 | |
| A11 | 담당자 부서 | X(30) | 115 | |
| A12 | 담당자 성명 | X(30) | 145 | |
| A13 | 담당자 전화번호 | X(15) | 160 | |
| A14 | 신고의무자수 | 9(5) | 165 | B 레코드 수 |
| A15 | 공란 | X(25) | 190 | |

**B 원천징수의무자별 집계 레코드**

| # | 항목 | 형식 | 끝 | 내용 |
|---|---|---|---|---|
| B1 | 레코드 구분 | X(1) | 1 | `B` |
| B2 | 자료구분 | 9(2) | 3 | `77` |
| B3 | 세무서코드 | X(3) | 6 | 납세지 관할 |
| B4 | 일련번호 | 9(6) | 12 | 1부터 |
| B5 | 상호(법인명) | X(40) | 52 | |
| B6 | 성명(대표자) | X(30) | 82 | |
| B7 | 사업자등록번호 | X(10) | 92 | |
| B8 | 주민(법인)등록번호 | X(13) | 105 | 법인: 법인등록번호 / 개인: 주민등록번호 |
| B9 | 귀속년도 | 9(4) | 109 | |
| B10 | 근무시기 | 9(1) | 110 | 1 상반기 / 2 하반기 |
| B11 | 근로자총인원 | 9(10) | 120 | C 레코드 수 |
| B12 | 과세소득(급여 등 합계) | 9(13) | 133 | ΣC14 |
| B13 | 과세소득(인정상여 합계) | 9(13) | 146 | ΣC15 |
| B14 | 공란 | X(44) | 190 | |

**C 소득자 레코드**

| # | 항목 | 형식 | 끝 | 내용 |
|---|---|---|---|---|
| C1 | 레코드 구분 | X(1) | 1 | `C` |
| C2 | 자료구분 | 9(2) | 3 | `77` |
| C3 | 세무서코드 | X(3) | 6 | = B3 |
| C4 | 일련번호 | 9(7) | 13 | 의무자별 1부터 |
| C5 | 사업자등록번호 | X(10) | 23 | = B7 |
| C6 | 주민등록번호 | X(13) | 36 | |
| C7 | 성명 | X(30) | 66 | |
| C8 | 전화번호 | X(20) | 86 | 공란 |
| C9 | 내·외국인 | X(1) | 87 | 1 내국인 / 9 외국인 |
| C10 | 거주자구분 | X(1) | 88 | 1 거주자 / 2 비거주자 |
| C11 | 거주지국코드 | X(2) | 90 | 거주자: `KR` 또는 공란 |
| C12 | 근무기간 시작 | X(8) | 98 | YYYYMMDD, 반기 안 |
| C13 | 근무기간 종료 | X(8) | 106 | YYYYMMDD, 반기 안 |
| C14 | 급여 등 | 9(13) | 119 | 인정상여·비과세 제외 |
| C15 | 인정상여 | 9(13) | 132 | |
| C16 | 공란 | X(58) | 190 | |

Hangul: 2-byte 완성형 (KSC-5601) or IBM MIXED; acts uses 완성형.
