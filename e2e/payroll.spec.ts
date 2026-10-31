import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";

// One 정기 급여 대장 for 귀속월 2026-01 (rates exist for it). The e2e DB is shared, so the spec cleans
// up any leftover 2026-01 정기 run before and after, creates its own employee per run (unique 사번
// and a 2021-born 주민등록번호, which has no check digit) and finally marks that employee as having
// left before 2026-01 instead of deleting it (there is no employee delete).
test.describe.configure({ mode: "serial" });

const MONTH = "2026-01";
const PAY_DATE = "2026-01-25";
const stamp = String(Date.now()).slice(-6);
const EMP_NO = `E2E${stamp}`;
const RRN = `210315-3${stamp}`;
const RRN_DIGITS = RRN.replace("-", "");
const RRN_MASKED = "210315-3******";

const runRow = (page: Page) => page.getByRole("row").filter({ hasText: MONTH }).filter({ hasText: "정기" });

/** Opens the leftover 2026-01 정기 run, if any, cancels its confirm and deletes it. */
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

let employeeId = "";
let runUrl = "";

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
    // Leaves the employee out of every 2026 run (left before 2026-01) instead of deleting it.
    await page.goto(`/payroll/employees/${employeeId}`);
    await page.getByLabel("퇴사일", { exact: true }).fill("2025-12-31");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("저장했습니다.").first()).toBeVisible();
  }
  await ctx.close();
});

test("사원 등록", async ({ page }) => {
  await page.goto("/payroll/employees/new");
  await fillWon(page, "기본급", "3000000", "3,000,000"); // returns once hydrated
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
});

test("정기 대장: 계산, 소득세 직접 입력, 확정, 명세서, 확정 취소, Excel", async ({ page }) => {
  // 1. A 정기 run for 2026-01 computes 국민연금 4.75% of 3,000,000.
  await page.goto("/payroll/runs?year=2026");
  await page.getByRole("button", { name: "새 대장", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("종류").selectOption("regular");
  await dlg.getByLabel("귀속월").fill(MONTH);
  await dlg.getByLabel("지급일").fill(PAY_DATE);
  await dlg.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\/[0-9a-f-]{36}$/);
  runUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "2026년 1월 정기 급여 대장" })).toBeVisible();
  await expect(page.getByText("재계산", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel(`${EMP_NO} 기본급`, { exact: true })).toHaveValue("3,000,000");
  await expect(page.getByLabel(`${EMP_NO} 국민연금`, { exact: true })).toHaveValue("142,500");

  // 1b. A save from a stale page fails with ERR_CONFLICT and the cell goes back to the stored value.
  const other = await page.context().newPage();
  await other.goto(runUrl);
  const otherBasic = other.getByLabel(`${EMP_NO} 기본급`, { exact: true });
  await expect(otherBasic).toHaveValue("3,000,000");
  await otherBasic.fill("3100000");
  await otherBasic.press("Tab");
  await expect(other.getByRole("row").filter({ hasText: EMP_NO })).toContainText("3,300,000");
  await other.close();
  const meal = page.getByLabel(`${EMP_NO} 식대`, { exact: true });
  await meal.fill("300000");
  await meal.press("Tab");
  await expect(page.getByText("다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.").first()).toBeVisible();
  await expect(meal).toHaveValue("200,000");
  await expect(page.getByLabel(`${EMP_NO} 기본급`, { exact: true })).toHaveValue("3,100,000");

  // 2. Overriding 소득세 marks the cell; the plain 주민등록번호 is never on the page.
  const tax = page.getByLabel(`${EMP_NO} 소득세`, { exact: true });
  await tax.fill("50000");
  await tax.press("Tab");
  await expect(page.getByRole("img", { name: new RegExp(`^${EMP_NO} 소득세 직접 입력`) })).toBeVisible();
  await expect(tax).toHaveValue("50,000");
  await expect(page.getByLabel(`${EMP_NO} 지방소득세`, { exact: true })).toHaveValue("5,000");
  expect(await page.content()).not.toContain(RRN_DIGITS.slice(6));

  // 3. 확정 shows the voucher preview, then writes a 급여 voucher.
  await page.getByRole("button", { name: "확정", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("802 직원급여")).toBeVisible();
  await expect(confirm.getByText("254 예수금")).toBeVisible();
  await confirm.getByRole("button", { name: "확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정 취소", exact: true })).toBeVisible();
  await expect(page.getByLabel(`${EMP_NO} 기본급`, { exact: true })).toHaveCount(0); // read-only now

  const vouchers = `/vouchers?from=${PAY_DATE}&to=${PAY_DATE}&kind=payroll`;
  await page.goto(vouchers);
  await expect(page.getByRole("row").filter({ hasText: "2026년 1월 급여" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "2026년 1월 급여" })).toContainText("급여");

  // 4. The payslip shows the masked 주민등록번호 only.
  await page.goto(`${runUrl}/payslips?employee=${employeeId}`);
  await expect(page.getByText(RRN_MASKED)).toBeVisible();
  await expect(page.getByText("홍길동").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "인쇄/PDF 저장" })).toBeVisible();
  expect(await page.content()).not.toContain(RRN_DIGITS.slice(6));

  // 5. 확정 취소 deletes the voucher.
  await page.goto(runUrl);
  await page.getByRole("button", { name: "확정 취소", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확정 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정", exact: true })).toBeVisible();
  await page.goto(vouchers);
  await expect(page.getByRole("row").filter({ hasText: "2026년 1월 급여" })).toHaveCount(0);

  // 6. The 급여 대장 Excel has the masked 주민등록번호, never the plain one.
  await page.goto(runUrl);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`급여대장_${MONTH}.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  const texts: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.value ?? "")))));
  const all = texts.join("\n");
  expect(all).toContain(RRN_MASKED);
  expect(all).toContain(EMP_NO);
  expect(all).not.toContain(RRN);
  expect(all).not.toContain(RRN_DIGITS);
});
