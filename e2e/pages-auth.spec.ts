import { test, expect } from "@playwright/test";

const authPages = [
  { href: "/login", mark: "로그인" },
  { href: "/register", mark: "Create account" },
  { href: "/forgot-password", mark: "Send reset link" },
  { href: "/reset-password", mark: "Reset password" },
  { href: "/verify", mark: "Verify" },
];

for (const p of authPages) {
  test(`${p.href} renders the auth form`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(p.href);
    expect(res?.status(), `status ${p.href}`).toBeLessThan(400);
    await expect(page.getByRole("button", { name: p.mark }).first()).toBeVisible();
    expect(errors, `pageerrors on ${p.href}`).toEqual([]);
  });
}

test("login page shows Korean email/password fields and no sign-up links", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
});
