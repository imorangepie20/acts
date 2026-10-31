import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { totpCode } from "../../src/server/auth/totp";

/** Each user's TOTP secret, saved when this helper enrols them (e2e/.auth/ is git-ignored). */
export function totpSecretPath(email: string): string {
  return `e2e/.auth/totp-${email.trim().toLowerCase()}.txt`;
}

export function savedTotpSecret(email: string): string {
  const path = totpSecretPath(email);
  if (!existsSync(path)) {
    throw new Error(
      `TOTP secret for ${email} missing; run NEW_PASSWORD=... pnpm admin:reset-password ${email} --reset-2fa`,
    );
  }
  return readFileSync(path, "utf8").trim();
}

/** A 6-digit code that is not valid in the current, previous or next step. */
export function wrongTotpCode(secret: string): string {
  const now = Date.now();
  const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, new Date(now + d))));
  return ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
}

/** Signs in with email + password, then passes /2fa/setup (enrols) or /2fa/verify when shown. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  const path = new URL(page.url()).pathname;
  if (path.startsWith("/2fa/setup")) {
    const secret = await page.getByTestId("totp-secret").getAttribute("data-secret");
    if (!secret) throw new Error("TOTP secret not shown on /2fa/setup");
    await page.getByLabel("인증 코드").fill(totpCode(secret, new Date()));
    await page.getByRole("button", { name: "확인" }).click();
    await expect(page.getByRole("list", { name: "복구 코드" })).toBeVisible();
    mkdirSync("e2e/.auth", { recursive: true });
    writeFileSync(totpSecretPath(email), secret);
    await page.getByRole("link", { name: "다음" }).click();
  } else if (path.startsWith("/2fa/verify")) {
    const secret = savedTotpSecret(email);
    await page.getByLabel("인증 코드").fill(totpCode(secret, new Date()));
    await page.getByRole("button", { name: "확인" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/2fa"));
}
