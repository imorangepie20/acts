import { expect, test } from "@playwright/test";

test("세무사 자료 page shows the summary and downloads the zip", async ({ page }) => {
  await page.goto("/exports");
  await expect(page.getByText("매출 세금계산서")).toBeVisible();
  await expect(page.getByText("증빙 파일")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "전체 묶음(zip)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^세무사자료_.*\.zip$/);
});
