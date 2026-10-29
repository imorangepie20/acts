import { test as setup, expect } from "@playwright/test";

setup("관리자 로그인", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(process.env.ADMIN_EMAIL ?? "");
  await page.getByLabel("비밀번호", { exact: true }).fill(process.env.ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
