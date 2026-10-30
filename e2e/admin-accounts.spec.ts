import { test, expect } from "@playwright/test";

test("계정과목: 표준 계정 목록, 추가(구분 자동 선택), 숨김", async ({ page }) => {
  await page.goto("/admin/accounts");
  await expect(page.getByRole("row", { name: /103 보통예금/ })).toBeVisible();

  const name = "E2E 회의비";
  let added = false;
  for (let i = 0; i < 20 && !added; i++) {
    // 850..898: outside the standard chart; retry on collisions so re-runs pass
    const code = String(850 + Math.floor(Math.random() * 49));
    await page.getByRole("button", { name: "계정 추가" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("코드").fill(code);
    await expect(dlg.getByLabel("구분", { exact: true })).toHaveValue("sga");
    await dlg.getByLabel("계정명").fill(name);
    await dlg.getByRole("button", { name: "추가" }).click();
    const dup = dlg.getByRole("alert").filter({ hasText: "이미 사용 중인 계정코드입니다." });
    const row = page.getByRole("row", { name: new RegExp(`${code} ${name}`) });
    await expect(dup.or(row)).toBeVisible();
    if (await dup.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
    } else {
      added = true;
      await expect(row).toContainText("판매비와관리비");
      await row.getByRole("button", { name: "수정" }).click();
      await page.getByRole("dialog").getByRole("switch", { name: "사용" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "저장" }).click();
      await expect(page.getByRole("row", { name: new RegExp(`${code} ${name}`) })).toContainText("숨김");
    }
  }
  expect(added).toBe(true);
});

test("계정과목: 수정 창에 대시보드 구분 선택이 있다", async ({ page }) => {
  await page.goto("/admin/accounts");
  await page.getByRole("row", { name: /103 보통예금/ }).getByRole("button", { name: "수정" }).click();
  const sel = page.getByRole("dialog").getByLabel("대시보드 구분");
  await expect(sel).toHaveValue("cash");
  await expect(sel.locator("option")).toHaveText(["없음", "현금·예금", "받을 돈", "줄 돈"]);
});
