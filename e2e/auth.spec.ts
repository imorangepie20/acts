import { test, expect } from "@playwright/test";
import { login, savedTotpSecret, withTotpCode, wrongTotpCode } from "./helpers/login";

test.use({ storageState: { cookies: [], origins: [] } });

const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";

test.describe("인증", () => {
  test("로그인 없이 /vouchers 접근 시 /login 으로 이동", async ({ page }) => {
    await page.goto("/vouchers");
    await expect(page).toHaveURL(/\/login/);
  });

  test("잘못된 비밀번호는 오류 메시지를 표시", async ({ page }) => {
    await page.goto("/login");
    // nonexistent email so this test can never lock the real admin
    const typed = "nobody@acts.kr";
    await page.getByLabel("이메일", { exact: true }).fill(typed);
    await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password-xyz");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();
    await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(typed);
    await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue("");
  });

  test("관리자 로그인 후 /overview 로 이동, 로그아웃 후 보호됨", async ({ page }) => {
    await login(page, email, password);
    await expect(page).toHaveURL(/\/overview/);

    // /overview does not exist until Task 5; use an existing dashboard page for the menu.
    await page.goto("/components/button");
    await page.getByRole("button", { name: "사용자 메뉴" }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login/);
  });

  test("2단계 인증 코드가 틀리면 오류를 보여 준다", async ({ page }) => {
    const secret = savedTotpSecret(email);
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/2fa\/verify/);

    // the second step guards every page until it is passed
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/2fa\/verify/);

    await page.getByLabel("인증 코드").fill(wrongTotpCode(secret));
    await page.getByRole("button", { name: "확인" }).click();
    await expect(page.getByText("인증 코드가 올바르지 않습니다.")).toBeVisible();
    await expect(page).toHaveURL(/\/2fa\/verify/);

    // the right code clears the failed counter, so this test can never lock the admin
    await withTotpCode(email, secret, async (code) => {
      await page.getByLabel("인증 코드").fill(code);
      await page.getByRole("button", { name: "확인" }).click();
      await expect(page).toHaveURL(/\/overview/);
    });
  });
});
