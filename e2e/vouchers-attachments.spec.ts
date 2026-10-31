import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const RECEIPT = "e2e/fixtures/receipt.png";

async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
  await expect(search).toHaveCount(0);
}

/** Creates a cash expense voucher and opens its detail page. */
async function openNewVoucher(page: Page, desc: string) {
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "101");
  await page.getByLabel("합계").fill("5000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();
  await page.goto(`/vouchers?q=${encodeURIComponent(desc)}`);
  const row = page.getByRole("row", { name: new RegExp(desc) });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
}

test("증빙 첨부: 업로드 → 미리보기 → 로그아웃 시 차단 → 삭제", async ({ page, browser, baseURL }) => {
  await openNewVoucher(page, `E2E 증빙 ${Date.now()}`);

  await expect(page.getByRole("heading", { name: "증빙", exact: true })).toBeVisible();
  await expect(page.getByText("첨부된 증빙이 없습니다.")).toBeVisible();
  await page.getByLabel("증빙 파일 첨부").setInputFiles(RECEIPT);
  await expect(page.getByText("첨부되었습니다.")).toBeVisible();

  const files = page.getByRole("list", { name: "증빙" });
  await expect(files.getByRole("listitem")).toHaveCount(1);
  await expect(files.getByRole("listitem")).toContainText("receipt.png");
  await expect(page.getByText("첨부 추가")).toBeVisible();

  const link = files.getByRole("link", { name: "receipt.png 미리보기" });
  await expect(link).toHaveAttribute("target", "_blank");
  const href = (await link.getAttribute("href"))!;
  expect(href).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/);

  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-disposition"]).toBe("inline; filename*=UTF-8''receipt.png");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(Buffer.from(await res.body()).equals(readFileSync(RECEIPT))).toBe(true);

  // logged out: no file
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const r = await anon.request.get(new URL(href, baseURL).toString(), { maxRedirects: 0 });
    expect(r.headers()["content-type"] ?? "").not.toContain("image/");
    expect([302, 303, 307, 308, 401, 403, 404]).toContain(r.status());
    if (r.status() >= 300 && r.status() < 400) expect(r.headers()["location"]).toContain("/login");
  } finally {
    await anon.close();
  }

  // remove
  await files.getByRole("button", { name: "receipt.png 삭제" }).click();
  await expect(page.getByText("첨부파일이 삭제되었습니다.")).toBeVisible();
  await expect(page.getByText("첨부된 증빙이 없습니다.")).toBeVisible();
  await expect(page.getByText("첨부 삭제")).toBeVisible();
  expect((await page.request.get(href)).status()).toBe(404);
});

test("증빙 첨부: 10MB에 가까운 파일도 업로드된다", async ({ page }) => {
  await openNewVoucher(page, `E2E 큰 증빙 ${Date.now()}`);
  // PNG signature + padding at exactly the 10MB cap (allowed), so the multipart body is over 10MB.
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  await page.getByLabel("증빙 파일 첨부").setInputFiles({ name: "big-photo.png", mimeType: "image/png", buffer });
  await expect(page.getByText("첨부되었습니다.")).toBeVisible({ timeout: 20_000 });
  const files = page.getByRole("list", { name: "증빙" });
  await expect(files.getByRole("listitem")).toContainText("big-photo.png");

  await files.getByRole("button", { name: "big-photo.png 삭제" }).click();
  await expect(page.getByText("첨부된 증빙이 없습니다.")).toBeVisible();
});
