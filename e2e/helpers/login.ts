import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { totpCode, totpStep } from "../../src/server/auth/totp";

const STEP_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * The server refuses a code whose 30-second step is not newer than the last one it accepted
 * (replay), and parallel workers may sign in as the same user. So every code is used through
 * here: under a per-user file lock held until `submit` finishes, take the next unused step (the
 * current one, or one ahead, which the server still accepts; wait if even that is too far),
 * record it and submit its code.
 */
export async function withTotpCode(
  email: string,
  secret: string,
  submit: (code: string) => Promise<void>,
): Promise<void> {
  const base = `e2e/.auth/totp-${email.trim().toLowerCase()}`;
  const lock = `${base}.lock`;
  mkdirSync("e2e/.auth", { recursive: true });
  test.info().setTimeout(test.info().timeout + 3 * STEP_MS);
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch {
      // a crashed worker's lock: steal it after 60 s
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { force: true });
      await sleep(100);
    }
  }
  try {
    const stepFile = `${base}.step`;
    const last = existsSync(stepFile) ? Number(readFileSync(stepFile, "utf8")) : -1;
    const step = Math.max(totpStep(new Date()), last + 1);
    // the server accepts step s while its clock is in s-1..s+1
    while (totpStep(new Date()) < step - 1) await sleep(250);
    writeFileSync(stepFile, String(step));
    await submit(totpCode(secret, new Date(step * STEP_MS)));
  } finally {
    rmSync(lock, { force: true });
  }
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
    // a fresh enrolment: forget steps recorded for an earlier secret of this user
    rmSync(`e2e/.auth/totp-${email.trim().toLowerCase()}.step`, { force: true });
    await withTotpCode(email, secret, async (code) => {
      await page.getByLabel("인증 코드").fill(code);
      await page.getByRole("button", { name: "확인" }).click();
      await expect(page.getByRole("list", { name: "복구 코드" })).toBeVisible();
    });
    mkdirSync("e2e/.auth", { recursive: true });
    writeFileSync(totpSecretPath(email), secret);
    await page.getByRole("link", { name: "다음" }).click();
  } else if (path.startsWith("/2fa/verify")) {
    const secret = savedTotpSecret(email);
    await withTotpCode(email, secret, async (code) => {
      await page.getByLabel("인증 코드").fill(code);
      await page.getByRole("button", { name: "확인" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/2fa"));
    });
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/2fa"));
}
