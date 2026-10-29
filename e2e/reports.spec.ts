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

test("거래처별 원장: 계정별 거래처 요약에서 거래처를 눌러 원장을 본다", async ({ page }) => {
  const ts = Date.now();
  const partner = `E2E원장처 ${ts}`;
  await page.goto("/vouchers/new");
  await page.getByLabel("적요").fill(`E2E 거래처원장 ${ts}`);
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "253");
  await page.getByRole("combobox", { name: "거래처" }).click();
  await page.getByPlaceholder("거래처명 또는 사업자등록번호").fill(partner);
  await page.getByRole("option", { name: /새 거래처 추가/ }).click();
  await page.getByRole("dialog", { name: "새 거래처 추가" }).getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("combobox", { name: "거래처" })).toContainText(partner);
  await page.getByLabel("합계").fill("4000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/ledgers/partners");
  await expect(page.getByRole("heading", { name: "거래처별 원장" })).toBeVisible();
  await pick(page, "계정과목", "253");
  await expect(page).toHaveURL(/account=\d+/);
  await expect(page.getByRole("columnheader", { name: "거래처" })).toBeVisible();
  await expect(rowNamed(page, "합계")).toBeVisible();
  await page.getByRole("link", { name: partner, exact: true }).click();
  await expect(page).toHaveURL(/partner=\d+/);
  await expect(page.getByRole("cell", { name: "이월", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: partner })).toBeVisible();
  await page.getByRole("link", { name: "전체 거래처" }).click();
  await expect(page).not.toHaveURL(/partner=/);
  await expect(page.getByRole("link", { name: partner, exact: true })).toBeVisible();

  // a non-requiresPartner account (811) also lists the partner on its lines
  const before = page.url();
  await pick(page, "계정과목", "811");
  await expect.poll(() => page.url()).not.toBe(before);
  await expect(page.getByRole("link", { name: partner, exact: true })).toBeVisible();
});
