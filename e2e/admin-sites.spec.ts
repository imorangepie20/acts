import { test, expect } from "@playwright/test";

test("사업장·부서: 본점 표시, 부서 추가 후 중지", async ({ page }) => {
  await page.goto("/admin/sites");
  await expect(page.getByRole("row", { name: /본점/ })).toBeVisible();

  const name = `E2E부서 ${Date.now()}`;
  await page.getByRole("button", { name: "부서 추가" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("부서명").fill(name);
  await dlg.getByRole("button", { name: "추가" }).click();

  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "수정" }).click();
  await page.getByRole("dialog").getByRole("switch", { name: "사용" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("중지");
});
