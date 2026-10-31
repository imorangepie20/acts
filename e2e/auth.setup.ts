import { test as setup, expect } from "@playwright/test";
import { login } from "./helpers/login";

setup("관리자 로그인", async ({ page }) => {
  await login(page, process.env.ADMIN_EMAIL ?? "", process.env.ADMIN_PASSWORD ?? "");
  await expect(page).toHaveURL(/\/overview/);
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
