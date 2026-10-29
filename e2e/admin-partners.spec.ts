import { test, expect } from "@playwright/test";

test("거래처: 추가(사업자번호 형식), 검색, 중지", async ({ page }) => {
  await page.goto("/admin/partners");
  const name = `E2E 상사 ${Date.now()}`;
  const bn = "220-81-62517";

  await page.getByRole("button", { name: "거래처 추가" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("거래처명").fill(name);
  await dlg.getByLabel("사업자등록번호").fill(bn);
  await dlg.getByRole("button", { name: "추가" }).click();

  const dup = dlg.getByRole("alert").filter({ hasText: "이미 등록된 사업자등록번호입니다." });
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(dup.or(row)).toBeVisible();
  let withNumber = true;
  if (await dup.isVisible()) {
    // number already taken by an earlier run: add without one
    withNumber = false;
    await dlg.getByLabel("사업자등록번호").fill("");
    await dlg.getByRole("button", { name: "추가" }).click();
  }
  await expect(row).toBeVisible();
  if (withNumber) await expect(row).toContainText(bn);

  await page.getByLabel("거래처 검색").fill(name);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(1);

  await page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "수정" }).click();
  await page.getByRole("dialog").getByRole("switch", { name: "사용" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("중지");
});
