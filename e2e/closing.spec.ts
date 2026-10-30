import { test, expect, type Page } from "@playwright/test";

// Closes and reopens months of fiscal year 2000 (company fiscal start month 1 in the e2e DB), so it
// runs serially in its own project after every other spec. No other spec dates vouchers in 2000.
test.describe.configure({ mode: "serial" });

const FY = "/closing?fy=2000-01-01";

async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
  await expect(search).toHaveCount(0);
}

const monthRow = (page: Page, month: string) => page.getByRole("row").filter({ hasText: month });

/** Runs the row's close / reopen button through its confirm dialog. */
async function monthAction(page: Page, month: string, button: "마감" | "마감 해제") {
  await monthRow(page, month).getByRole("button", { name: button, exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByText(button === "마감" ? "마감되었습니다." : "마감을 해제했습니다.").first()).toBeVisible();
}

test.afterAll(async ({ browser }) => {
  // Leave fiscal year 2000 open for re-runs and other specs: latest closed month first.
  const ctx = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const page = await ctx.newPage();
  for (const month of ["2000-02", "2000-01"]) {
    await page.goto(FY);
    const reopen = monthRow(page, month).getByRole("button", { name: "마감 해제", exact: true });
    if ((await reopen.count()) > 0) await monthAction(page, month, "마감 해제");
  }
  await ctx.close();
});

test("월 마감: 2000-01 → 2000-02 마감, 마감된 월의 전표는 수정할 수 없다", async ({ page }) => {
  const desc = `E2E 마감 ${Date.now()}`;

  // a voucher in 2000-02
  await page.goto("/vouchers/new");
  await pick(page, "계정", "811"); // the pickers only open once the form has hydrated
  await pick(page, "결제 계정", "101");
  await page.getByLabel("날짜").fill("2000-02-15");
  await expect(page.getByLabel("날짜")).toHaveValue("2000-02-15");
  await page.getByLabel("적요").fill(desc);
  await page.getByLabel("합계").fill("5000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto(`/vouchers?from=2000-02-01&to=2000-02-29&q=${encodeURIComponent(desc)}`);
  const row = page.getByRole("row", { name: new RegExp(desc) });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
  const detailUrl = page.url();
  // approval may be on in this DB; a pending voucher would block the close
  const approve = page.getByRole("button", { name: "승인", exact: true });
  if ((await approve.count()) > 0) {
    await approve.click();
    await expect(page.getByText("승인되었습니다.")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "수정" })).toBeVisible();
  await expect(page.getByText("마감됨")).toHaveCount(0);

  // close 2000-01 (may hold the opening voucher), then 2000-02
  await page.goto(FY);
  await expect(page.getByRole("row")).toHaveCount(13);
  await expect(monthRow(page, "2000-02")).toContainText("열림");
  await monthAction(page, "2000-01", "마감");
  await expect(monthRow(page, "2000-01").getByRole("button", { name: "마감 해제", exact: true })).toBeVisible();
  await monthAction(page, "2000-02", "마감");
  const feb = monthRow(page, "2000-02");
  await expect(feb.getByRole("button", { name: "마감 해제", exact: true })).toBeVisible();
  await expect(feb.getByText("마감", { exact: true })).toBeVisible();

  // only the latest closed month can be reopened
  await monthRow(page, "2000-01").getByRole("button", { name: "마감 해제", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "마감 해제", exact: true }).click();
  await expect(page.getByText("가장 최근에 마감한 월부터 해제할 수 있습니다.")).toBeVisible();

  // the voucher is read-only now
  await page.goto(detailUrl);
  await expect(page.getByText("마감됨")).toBeVisible();
  await expect(page.getByRole("button", { name: "수정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "삭제" })).toHaveCount(0);
  await expect(page.getByLabel("증빙 파일 첨부")).toHaveCount(0);
  await page.goto(`${detailUrl}/edit`);
  await expect(page).toHaveURL(detailUrl);
});
