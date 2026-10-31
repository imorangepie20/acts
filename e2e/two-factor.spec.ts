import { test, expect } from "@playwright/test";
import { login, withTotpCode } from "./helpers/login";

test("필수 역할은 프로필에서 2단계 인증을 끌 수 없다", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByText("사용 중", { exact: true })).toBeVisible();
  await expect(page.getByText("이 역할은 2단계 인증을 반드시 써야 하므로 끌 수 없습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "2단계 인증 끄기" })).toHaveCount(0);
});

test("실무자는 프로필에서 2단계 인증을 켜고, 코드를 넣어 끌 수 있다", async ({ page, browser }) => {
  const email = `e2e-2fa-${Date.now()}@acts.kr`;
  const password = "staff-pass-1234";
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "사용자 추가" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("이메일").fill(email);
  await dlg.getByLabel("이름").fill("E2E 2단계");
  await dlg.getByLabel("역할").selectOption("staff");
  await dlg.getByLabel("초기 비밀번호").fill(password);
  await dlg.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const staff = await ctx.newPage();
  await login(staff, email, password);
  await expect(staff).toHaveURL(/\/vouchers/);

  await staff.goto("/profile");
  await expect(staff.getByText("사용 안 함", { exact: true })).toBeVisible();
  await staff.getByRole("link", { name: "2단계 인증 사용" }).click();
  await expect(staff).toHaveURL(/\/2fa\/setup\?voluntary=1/);
  const secret = (await staff.getByTestId("totp-secret").getAttribute("data-secret"))!;
  // a refresh keeps the unconfirmed secret, so an already scanned QR stays valid
  await staff.reload();
  await expect(staff.getByTestId("totp-secret")).toHaveAttribute("data-secret", secret);
  await withTotpCode(email, secret, async (code) => {
    await staff.getByLabel("인증 코드").fill(code);
    await staff.getByRole("button", { name: "확인" }).click();
    await expect(staff.getByRole("list", { name: "복구 코드" })).toBeVisible();
  });
  await staff.getByRole("link", { name: "다음" }).click();
  await expect(staff).toHaveURL(/\/profile/);
  await expect(staff.getByText("사용 중", { exact: true })).toBeVisible();

  await staff.getByRole("button", { name: "2단계 인증 끄기" }).click();
  await withTotpCode(email, secret, async (code) => {
    await staff.getByLabel("인증 코드").fill(code);
    await staff.getByRole("button", { name: "끄기", exact: true }).click();
    await expect(staff.getByText("사용 안 함", { exact: true })).toBeVisible();
  });
  await ctx.close();
});
