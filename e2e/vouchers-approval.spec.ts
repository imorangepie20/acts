import { test, expect, type Page } from "@playwright/test";

// Changes the company approval setting, so it runs in the serial `settings-serial-approval` project.
test.describe.configure({ mode: "serial" });

async function setApproval(page: Page, on: boolean) {
  await page.goto("/admin/company");
  const sw = page.getByRole("switch", { name: "전표 승인 사용" });
  if ((await sw.isChecked()) === on) return;
  await sw.click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.").first()).toBeVisible();
  await page.reload();
  if (on) await expect(page.getByRole("switch", { name: "전표 승인 사용" })).toBeChecked();
  else await expect(page.getByRole("switch", { name: "전표 승인 사용" })).not.toBeChecked();
}

async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
  await expect(search).toHaveCount(0);
}

/** Creates a cash expense voucher and opens it from the list. */
async function createVoucher(page: Page, desc: string) {
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "101");
  await page.getByLabel("합계").fill("5000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();
  await page.goto(`/vouchers?q=${encodeURIComponent(desc)}`);
  const row = page.getByRole("row", { name: new RegExp(desc) });
  await expect(row).toHaveCount(1);
  return row;
}

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const page = await ctx.newPage();
  await setApproval(page, false);
  await ctx.close();
});

test("전표 승인: 대기 → 배너 → 승인 / 반려 → 승인 해제 시 자동 승인", async ({ page }) => {
  const ts = Date.now();
  await setApproval(page, true);

  // create → pending, banner, approve
  const a = `E2E 승인 ${ts}`;
  const rowA = await createVoucher(page, a);
  await expect(rowA.getByRole("cell", { name: "승인 대기", exact: true })).toBeVisible();
  const banner = page.getByRole("link", { name: /^승인 대기 \d+건$/ });
  await expect(banner).toBeVisible();
  expect(Number((await banner.innerText()).match(/\d+/)![0])).toBeGreaterThanOrEqual(1);
  await rowA.click();
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("승인되었습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "반려" })).toHaveCount(0);
  await expect(page.getByText("승인", { exact: true }).first()).toBeVisible();

  // create → reject with reason
  const b = `E2E 반려 ${ts}`;
  const rowB = await createVoucher(page, b);
  await rowB.click();
  await page.getByRole("button", { name: "반려", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "반려하기" })).toBeDisabled();
  await dlg.getByLabel("사유").fill("증빙 누락");
  await dlg.getByRole("button", { name: "반려하기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "증빙 누락" })).toBeVisible();

  // a pending voucher is auto-approved when approval is switched off
  const c = `E2E 자동 ${ts}`;
  await createVoucher(page, c);
  await setApproval(page, false);
  await page.goto(`/vouchers?q=${encodeURIComponent(c)}`);
  await expect(page.getByRole("row", { name: new RegExp(c) }).getByRole("cell", { name: "승인", exact: true })).toBeVisible();
  await page.goto(`/vouchers?q=${encodeURIComponent(b)}`);
  await expect(page.getByRole("row", { name: new RegExp(b) }).getByRole("cell", { name: "반려", exact: true })).toBeVisible();
});
