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

// Fills a won input once the form has hydrated (the handler adds the thousands separators).
async function fillWon(page: Page, label: string, digits: string, shown: string) {
  const input = page.getByLabel(label, { exact: true });
  await expect(async () => {
    await input.fill(digits);
    await expect(input).toHaveValue(shown, { timeout: 1000 });
  }).toPass();
}

// The opening voucher stays in the e2e DB: its cut-off 2000-01-01 is the 1B date floor, and every
// other voucher (this spec's included) is dated after it. Re-runs replace the same voucher.
test("기초잔액: 2000-01-01 기준 101·331 1,000,000 저장, 다시 저장하면 같은 전표를 바꾼다", async ({ page }) => {
  const list = "/vouchers?from=2000-01-01&to=2000-01-01&kind=opening";
  await page.goto("/closing/opening");
  await expect(page.getByRole("tab", { name: "기초잔액" })).toHaveAttribute("aria-selected", "true");
  await fillWon(page, "101 현금 잔액", "1000000", "1,000,000"); // returns once hydrated
  await fillWon(page, "331 자본금 잔액", "1000000", "1,000,000");
  await page.getByLabel("기준일").fill("2000-01-01");
  await expect(page.getByLabel("기준일")).toHaveValue("2000-01-01");
  const save = page.getByRole("button", { name: "저장", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  // the stored balances come back; an unbalanced edit disables 저장
  await page.reload();
  await expect(page.getByLabel("기준일")).toHaveValue("2000-01-01");
  await expect(page.getByLabel("101 현금 잔액", { exact: true })).toHaveValue("1,000,000");
  await fillWon(page, "101 현금 잔액", "900000", "900,000");
  await expect(save).toBeDisabled();
  await fillWon(page, "101 현금 잔액", "1000000", "1,000,000");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("저장되었습니다.").first()).toBeVisible();

  // still exactly one 기초 voucher, and it is edited only on this screen
  await page.goto(list);
  const row = page.getByRole("row").filter({ hasText: "기초잔액" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("기초");
  await row.click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "기초잔액 화면에서 수정" })).toBeVisible();
  await expect(page.getByRole("button", { name: "수정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "삭제" })).toHaveCount(0);
  await page.goto(`${page.url()}/edit`);
  await expect(page).toHaveURL(/\/closing\/opening$/);
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
  await page.getByRole("button", { name: "저장", exact: true }).click();
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

  // only the latest explicit close offers 마감 해제; 2000-01 stays 마감 without a button
  const jan = monthRow(page, "2000-01");
  await expect(jan.getByText("마감", { exact: true })).toBeVisible();
  await expect(jan.getByRole("button")).toHaveCount(0);

  // the voucher is read-only now
  await page.goto(detailUrl);
  await expect(page.getByText("마감됨")).toBeVisible();
  await expect(page.getByRole("button", { name: "수정" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "삭제" })).toHaveCount(0);
  await expect(page.getByLabel("증빙 파일 첨부")).toHaveCount(0);
  await page.goto(`${detailUrl}/edit`);
  await expect(page).toHaveURL(detailUrl);
});

test("연도 이월: 세무사 금액을 저장하면 시스템과의 차이가 표시된다 (연도 마감은 하지 않는다)", async ({ page }) => {
  await page.goto("/closing/opening?fy=2000-01-01");
  await expect(page.getByRole("tab", { name: "연도 이월" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("회계연도 2000-01-01 ~ 2000-12-31")).toBeVisible();
  await expect(page.getByText("별도의 이월 전표는 만들지 않습니다.")).toBeVisible();

  // far from any real 2000 figure, so the 차이 is non-zero on every re-run
  await fillWon(page, "세무사 자산총계", "123456789", "123,456,789");
  await fillWon(page, "세무사 부채총계", "1000", "1,000");
  await fillWon(page, "세무사 자본총계", "123455789", "123,455,789");
  await fillWon(page, "세무사 당기순이익", "777", "777");
  await page.getByRole("button", { name: "세무사 금액 저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("세무사 자산총계", { exact: true })).toHaveValue("123,456,789");
  const yearRow = (label: string) => page.getByRole("row").filter({ hasText: label });
  for (const label of ["자산총계", "부채총계", "자본총계", "당기순이익"]) {
    const diff = yearRow(label).getByRole("cell").last();
    await expect(diff).not.toHaveText(/^(0|-)$/);
    await expect(diff).toHaveClass(/text-destructive/);
  }

  // not all 12 months are closed, so the year cannot be closed
  await expect(page.getByRole("button", { name: "회계연도 마감", exact: true })).toBeDisabled();
});
