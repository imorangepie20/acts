import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

// One 정기 급여 대장 for 귀속월 2026-02 paid 2026-02-25. Like payroll.spec, the spec removes any
// leftover 2026-02 정기 run before and after, makes its own employee (unique 사번, 2021-born
// 주민등록번호 without check digit) and retires that employee instead of deleting it.
test.describe.configure({ mode: "serial" });

const MONTH = "2026-02";
const PAY_DATE = "2026-02-25";
const stamp = String(Date.now()).slice(-6);
const EMP_NO = `E2E${stamp}`;
const RRN = `210315-3${stamp}`;
const RRN_DIGITS = RRN.replace("-", "");
const BUSINESS_NUMBER = "220-81-62517"; // the valid number admin.spec also leaves on the company

const runRow = (page: Page) => page.getByRole("row").filter({ hasText: MONTH }).filter({ hasText: "정기" });

/** Opens the leftover 2026-02 정기 run, if any, cancels its confirm and deletes it. */
async function cleanupRun(page: Page) {
  await page.goto("/payroll/runs?year=2026");
  await expect(page.getByRole("heading", { name: "급여 대장" })).toBeVisible();
  if ((await runRow(page).count()) === 0) return;
  await runRow(page).getByRole("link", { name: MONTH }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\/[0-9a-f-]{36}$/);
  const cancel = page.getByRole("button", { name: "확정 취소", exact: true });
  if ((await cancel.count()) > 0) {
    await cancel.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "확정 취소", exact: true }).click();
    await expect(page.getByRole("button", { name: "확정", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/payroll\/runs(\?year=\d{4})?$/);
  await expect(runRow(page)).toHaveCount(0);
}

// Fills a won input once the form has hydrated (the handler adds the thousands separators).
async function fillWon(page: Page, label: string, digits: string, shown: string) {
  const input = page.getByLabel(label, { exact: true });
  await expect(async () => {
    await input.fill(digits);
    await expect(input).toHaveValue(shown, { timeout: 1000 });
  }).toPass();
}

// td order of a 신고서 row: 소득구분, 코드, ④ 인원, ⑤ 총지급액, ⑥ 소득세, ⑦, ⑧, ⑨ 조정환급, ⑩ 소득세, ⑪.
async function cellNum(row: Locator, i: number): Promise<number> {
  return Number((await row.locator("td").nth(i).innerText()).replace(/[^\d]/g, "") || "0");
}

let employeeId = "";

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  await cleanupRun(await ctx.newPage());
  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const page = await ctx.newPage();
  await cleanupRun(page);
  if (employeeId) {
    await page.goto(`/payroll/employees/${employeeId}`);
    await page.getByLabel("퇴사일", { exact: true }).fill("2025-12-31");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("저장했습니다.").first()).toBeVisible();
  }
  await ctx.close();
});

test("회사 신고 정보, 사원, 정기 대장 확정", async ({ page }) => {
  // 1. Company filing fields (a corporation, so no 대표자 주민등록번호 is needed for the file).
  await page.goto("/admin/company");
  await page.getByLabel("사업자등록번호").fill(BUSINESS_NUMBER);
  await page.getByLabel("대표자", { exact: true }).fill("김대표");
  await page.getByLabel("세무서코드").fill("123");
  await page.getByLabel("사업자 유형").selectOption("corporation");
  await page.getByLabel("법인등록번호").fill("1101111234567");
  await page.getByLabel("홈택스 ID").fill("acts-e2e");
  await page.getByLabel("담당자 부서").fill("경리팀");
  await page.getByLabel("담당자 성명").fill("박담당");
  await page.getByLabel("담당자 전화번호").fill("02-1234-5678");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.").first()).toBeVisible();

  // 2. Employee.
  await page.goto("/payroll/employees/new");
  await fillWon(page, "기본급", "3000000", "3,000,000");
  await fillWon(page, "식대", "200000", "200,000");
  await fillWon(page, "국민연금 기준소득월액", "3000000", "3,000,000");
  await fillWon(page, "건강보험 보수월액", "3000000", "3,000,000");
  await page.getByLabel("사번", { exact: true }).fill(EMP_NO);
  await page.getByLabel("이름", { exact: true }).fill("홍길동");
  await page.locator("#emp-rrn").fill(RRN);
  await page.getByLabel("입사일", { exact: true }).fill("2025-01-01");
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await expect(page).toHaveURL(/\/payroll\/employees\/\d+$/);
  employeeId = page.url().split("/").pop()!;

  // 3. 정기 run for 2026-02, confirmed.
  await page.goto("/payroll/runs?year=2026");
  await page.getByRole("button", { name: "새 대장", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("종류").selectOption("regular");
  await dlg.getByLabel("귀속월").fill(MONTH);
  await dlg.getByLabel("지급일").fill(PAY_DATE);
  await dlg.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel(`${EMP_NO} 기본급`, { exact: true })).toHaveValue("3,000,000");
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정 취소", exact: true })).toBeVisible();
});

test("원천징수이행상황신고서: A01 집계와 ⑫ 전월 미환급세액", async ({ page }) => {
  const base = `/payroll/withholding?mode=monthly&attr=${MONTH}&pay=${MONTH}`;
  await page.goto(`${base}&refund=0`);
  await expect(page.getByRole("heading", { name: "원천세 신고" })).toBeVisible();
  const a01 = page.locator('[data-row="A01"]');
  const a10 = page.locator('[data-row="A10"]');
  const people = await cellNum(a01, 2);
  const tax = await cellNum(a01, 4);
  expect(people).toBeGreaterThanOrEqual(1);
  expect(tax).toBeGreaterThan(1000);
  expect(await cellNum(a10, 8)).toBe(tax); // ⑩ with no ⑫
  await expect(page.getByText("이 프로그램에서 계산하지 않음").first()).toBeVisible();

  await page.goto(`${base}&refund=1000`);
  await expect(page.getByLabel("⑫ 전월 미환급세액 (원)")).toHaveValue("1000");
  expect(await cellNum(a10, 7)).toBe(1000); // ⑨
  expect(await cellNum(a10, 8)).toBe(tax - 1000); // ⑩ changed

  // A month with no confirmed run shows the empty message.
  await page.goto("/payroll/withholding?mode=monthly&pay=2031-01&refund=0");
  await expect(page.getByText("이 지급연월에 확정된 급여 대장이 없습니다.")).toBeVisible();
});

test("간이지급명세서: 미리보기와 파일 내려받기", async ({ page }) => {
  await page.goto("/payroll/simplified-statement?year=2026&half=1");
  await expect(page.getByRole("heading", { name: "근로소득 간이지급명세서" })).toBeVisible();
  await expect(page.getByText(/홈택스 검증 전/).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "홍길동" }).first()).toBeVisible();
  expect(await page.content()).not.toContain(RRN_DIGITS.slice(6));

  await page.getByRole("button", { name: "파일 내려받기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/홈택스 검증 전/)).toBeVisible();
  // The form posts to a new tab (target=_blank); the download event fires on that popup page.
  // The form posts to a new tab (target=_blank). Chromium opens the popup, then reports the attachment
  // as a download of the opener page and closes the popup, so assert both.
  const popupPromise = page.context().waitForEvent("page");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "내려받기", exact: true }).click(),
  ]);
  await popupPromise;

  expect(download.suggestedFilename()).toMatch(/^SC\d{7}\.\d{3}$/);
  expect(download.suggestedFilename()).toBe("SC2208162.517");
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.length % 192).toBe(0);
  expect(String.fromCharCode(bytes[0])).toBe("A");
});
