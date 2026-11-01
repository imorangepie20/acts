import { expect, test } from "@playwright/test";

const SECTIONS = ["월별 손익 추이", "현금 흐름 추이", "납부·지급 일정", "부가세 예상액", "채권·채무 분석", "비용 구성", "재무상태 요약"];

test("executive dashboard shows the KPIs, every section and the as-of header", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(page.getByText("마감 기준")).toBeVisible();
  const kpis = page.getByRole("region", { name: "핵심 지표" });
  await expect(kpis.getByText("누적 매출액")).toBeVisible();
  await expect(kpis.getByText("누적 영업이익")).toBeVisible();
  await expect(kpis.getByText(/^\d{1,2}월 매출액 \(최근 완료월\)$/)).toBeVisible();
  await expect(kpis.getByText("현금·예금 잔액")).toBeVisible();
  await expect(kpis.getByText("받을 돈 (미수금)")).toBeVisible();
  await expect(kpis.getByText("줄 돈 (미지급금)")).toBeVisible();
  for (const s of SECTIONS) await expect(page.getByText(s, { exact: true })).toBeVisible();
  await expect(page.locator("[data-slot=chart]")).toHaveCount(2);
});

test("the as-of date comes from the to parameter and the last whole month links to its income statement", async ({ page }) => {
  await page.goto("/overview?to=2020-05-31");
  await expect(page.getByText("2020-05-31 마감 기준")).toBeVisible();
  await page.getByRole("link", { name: /5월 매출액 \(최근 완료월\)/ }).click();
  await expect(page).toHaveURL(/income-statement\?.*from=2020-05-01.*to=2020-05-31/);
});

test("mid-month the last whole month is the previous one, and YTD links span the fiscal year", async ({ page }) => {
  await page.goto("/overview?to=2020-06-15");
  await expect(page.getByText("5월 매출액 (최근 완료월)")).toBeVisible();
  await page.getByRole("link", { name: /누적 매출액/ }).click();
  await expect(page).toHaveURL(/income-statement\?.*from=2020-01-01.*to=2020-06-15/);
});
