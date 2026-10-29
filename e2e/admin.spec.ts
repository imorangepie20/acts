import { test, expect } from "@playwright/test";

test("관리자가 실무자를 만들고, 실무자는 설정 메뉴에 접근할 수 없다", async ({ page, browser }) => {
  const email = `e2e-staff-${Date.now()}@acts.kr`;
  const password = "staff-pass-1234";

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "사용자 추가" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("이메일").fill(email);
  await dlg.getByLabel("이름").fill("E2E 실무자");
  await dlg.getByLabel("역할").selectOption("staff");
  await dlg.getByLabel("초기 비밀번호").fill(password);
  await dlg.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const staff = await ctx.newPage();
  await staff.goto("/login");
  await staff.getByLabel("이메일", { exact: true }).fill(email);
  await staff.getByLabel("비밀번호", { exact: true }).fill(password);
  await staff.getByRole("button", { name: "로그인" }).click();
  await expect(staff).toHaveURL(/\/vouchers/);
  await expect(staff.getByText("설정", { exact: true })).toHaveCount(0);

  await staff.goto("/admin/users");
  await expect(staff).toHaveURL(/\/vouchers/);
  await ctx.close();
});
