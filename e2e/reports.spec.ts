import { test, expect, type Page } from "@playwright/test";

async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
  await expect(search).toHaveCount(0);
}

test("합계잔액시산표: 전표 입력 후 합계 행이 보이고 차액 안내가 없다", async ({ page }) => {
  const desc = `E2E 시산표 ${Date.now()}`;
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "101");
  await page.getByLabel("합계").fill("5000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/reports/trial-balance");
  await expect(page.getByRole("heading", { name: "합계잔액시산표" })).toBeVisible();
  await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: "합계", exact: true }) })).toBeVisible();
  await expect(page.getByText("차액")).toHaveCount(0);
});

const rowNamed = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });

test("손익계산서: 당기순이익 행과 비교 기간 헤더가 보인다", async ({ page }) => {
  await page.goto("/reports/income-statement?from=2026-01-01&to=2026-12-31");
  await expect(page.getByRole("heading", { name: "손익계산서" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "당기 (2026-01-01 ~ 2026-12-31)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "전기 (2025-01-01 ~ 2025-12-31)" })).toBeVisible();
  for (const label of ["Ⅰ. 매출액", "Ⅲ. 매출총이익", "Ⅴ. 영업이익", "Ⅹ. 당기순이익"]) {
    await expect(rowNamed(page, label)).toBeVisible();
  }
});

test("재무상태표: 자산총계와 부채와자본총계가 같다", async ({ page }) => {
  const desc = `E2E 재무상태표 ${Date.now()}`;
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "101");
  await page.getByLabel("합계").fill("7000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/reports/balance-sheet");
  await expect(page.getByRole("heading", { name: "재무상태표" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^전기말 \(\d{4}-\d{2}-\d{2}\)$/ })).toBeVisible();
  const assets = rowNamed(page, "자산총계");
  const le = rowNamed(page, "부채와자본총계");
  await expect(assets).toBeVisible();
  await expect(le).toBeVisible();
  for (const col of [1, 2]) {
    const a = await assets.getByRole("cell").nth(col).innerText();
    const b = await le.getByRole("cell").nth(col).innerText();
    expect(a).toMatch(/\d/);
    expect(a).toBe(b);
  }
  await expect(page.getByText("차액")).toHaveCount(0);
});

test("분개장·계정별 원장: 전표가 분개장에 보이고 103 원장에 이월·월계가 보인다", async ({ page }) => {
  const desc = `E2E 원장 ${Date.now()}`;
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "103");
  await page.getByLabel("합계").fill("3000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/ledgers/journal");
  await expect(page.getByRole("heading", { name: "분개장" })).toBeVisible();
  await expect(page.getByRole("cell", { name: desc, exact: true }).first()).toBeVisible();
  await expect(rowNamed(page, "합계")).toBeVisible();

  await page.goto("/ledgers/accounts");
  await expect(page.getByText("계정과목을 선택하세요.")).toBeVisible();
  await pick(page, "계정과목", "103");
  await expect(page).toHaveURL(/account=\d+/);
  await expect(page.getByRole("cell", { name: "이월", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^월계/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "누계", exact: true }).first()).toBeVisible();
});
