import { expect, test } from "@playwright/test";

test("executive dashboard shows the four figures, the trend and the as-of header", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(page.getByText("마감 기준")).toBeVisible();
  await expect(page.getByText(/^\d{1,2}월 누적 영업이익$/)).toBeVisible();
  await expect(page.getByText("현금·예금 잔액")).toBeVisible();
  await expect(page.getByText("받을 돈 (미수금)")).toBeVisible();
  await expect(page.getByText("줄 돈 (미지급금)")).toBeVisible();
  await expect(page.getByText("월별 손익 추이")).toBeVisible();
  await expect(page.getByText("재무상태 요약")).toBeVisible();
  await expect(page.locator("[data-slot=chart]")).toBeVisible();
});

test("the as-of date comes from the to parameter", async ({ page }) => {
  await page.goto("/overview?to=2020-05-31");
  await expect(page.getByText("2020-05-31 마감 기준")).toBeVisible();
  await expect(page.getByText("5월 누적 영업이익")).toBeVisible();
  await page.getByRole("link", { name: /5월 누적 영업이익/ }).click();
  await expect(page).toHaveURL(/income-statement\?.*from=2020-05-01.*to=2020-05-31/);
});
