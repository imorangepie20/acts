import { test, expect, type Page } from "@playwright/test";
import { formatBusinessNumber } from "../src/lib/business-number";
import { VAT_SOURCE_NOTICE } from "../src/lib/vat/notices";

/** Opens an account picker by its label and picks the first match for `query`. */
async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
  await expect(search).toHaveCount(0); // popover closed before the next picker opens
}

/** A checksum-valid 사업자등록번호 that differs per run. */
function uniqueBusinessNumber(): string {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const body = `9${String(Date.now()).slice(-8)}`;
  const d = [...body].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * weights[i];
  sum += Math.floor((d[8] * 5) / 10);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

test("부가세 신고 자료: 종이 세금계산서 매입이 매입처별 명세와 (10)에 나온다", async ({ page }) => {
  const ts = Date.now();
  const desc = `E2E 부가세 종이 ${ts}`;
  const partner = `E2E종이상사 ${ts}`;
  const bn = uniqueBusinessNumber();

  await page.goto("/vouchers/new");
  await pick(page, "계정", "811"); // the pickers only open once the form has hydrated
  await pick(page, "결제 계정", "101");
  await page.getByLabel("날짜").fill("2003-02-10");
  await expect(page.getByLabel("날짜")).toHaveValue("2003-02-10");
  await page.getByLabel("적요").fill(desc);
  await page.getByRole("combobox", { name: "거래처" }).click();
  await page.getByPlaceholder("거래처명 또는 사업자등록번호").fill(partner);
  await page.getByRole("option", { name: /새 거래처 추가/ }).click();
  const quick = page.getByRole("dialog", { name: "새 거래처 추가" });
  await quick.getByLabel("사업자등록번호").fill(bn);
  await quick.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("combobox", { name: "거래처" })).toContainText(partner);
  await page.getByLabel("증빙").selectOption({ label: "세금계산서" });
  await page.getByLabel("합계").fill("11000");
  await page.getByRole("switch", { name: "종이 세금계산서" }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/exports/vat-return?year=2003&term=1&kind=prelim");
  await expect(page.getByRole("heading", { name: "부가세 신고 자료" })).toBeVisible();
  await expect(page.getByText(VAT_SOURCE_NOTICE)).toBeVisible();

  const detail = page.getByRole("table", { name: "매입처별 전자 외 발급분 명세" });
  await expect(detail.getByRole("row", { name: new RegExp(formatBusinessNumber(bn)) })).toContainText(partner);

  const amount10 = page.locator('tr[data-row="10"] td[data-col="amount"]');
  await expect(amount10).not.toHaveText("0");
  await expect(amount10).toHaveText(/^[\d,]+$/);

  const href = await page.getByRole("button", { name: "Excel" }).getAttribute("href");
  expect(href).toContain("year=2003");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
