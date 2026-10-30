import { test, expect, type Page } from "@playwright/test";

/** Opens an account/partner picker by its label and picks the first match for `query`. */
async function pick(page: Page, label: string, query: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill(query);
  await search.press("Enter");
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(query);
}

test("전표: 매입·비용 입력 → 목록 → 수정 이력 → 삭제", async ({ page }) => {
  const ts = Date.now();
  const desc = `E2E 점심 ${ts}`;
  const partner = `E2E카드 ${ts}`;

  await page.goto("/vouchers/new");
  await expect(page.getByRole("tab", { name: "매입·비용" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("적요").fill(desc);
  await pick(page, "계정", "811");
  await expect(page.getByRole("combobox", { name: "계정", exact: true })).toContainText("811 복리후생비");
  await pick(page, "결제 계정", "253");
  await expect(page.getByRole("combobox", { name: "결제 계정" })).toContainText("253 미지급금");

  // new partner inline
  await page.getByRole("combobox", { name: "거래처" }).click();
  await page.getByPlaceholder("거래처명 또는 사업자등록번호").fill(partner);
  await page.getByRole("option", { name: /새 거래처 추가/ }).click();
  const quick = page.getByRole("dialog", { name: "새 거래처 추가" });
  await expect(quick.getByLabel("거래처명")).toHaveValue(partner);
  await quick.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("combobox", { name: "거래처" })).toContainText(partner);

  await expect(page.getByLabel("증빙")).toHaveValue("card");
  await page.getByLabel("합계").fill("10000");
  await expect(page.getByLabel("합계")).toHaveValue("10,000");
  await expect(page.getByLabel("공급가액")).toHaveValue("9,091");
  await expect(page.getByLabel("부가세")).toHaveValue("909");

  const preview = page.getByRole("table", { name: "분개 미리보기" });
  await expect(preview.getByRole("row", { name: /135 부가세대급금/ })).toContainText("909");
  await expect(preview.getByRole("row", { name: /253 미지급금/ })).toContainText("10,000");

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();
  // form resets but stays on the tab
  await expect(page.getByLabel("적요")).toHaveValue("");
  await expect(page.getByRole("tab", { name: "매입·비용" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`/vouchers?q=${encodeURIComponent(desc)}`);
  const row = page.getByRole("row", { name: new RegExp(desc) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("10,000");
  await expect(row).toContainText(partner);
  await expect(row.getByRole("cell", { name: "승인", exact: true })).toBeVisible();

  // detail → edit
  await row.click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /전표 \d{8}-\d{4}/ })).toBeVisible();
  await page.getByRole("button", { name: "수정" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByRole("tab", { name: "매입·비용" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "매출" })).toBeDisabled();
  await expect(page.getByLabel("합계")).toHaveValue("10,000");
  const edited = `${desc} 회식`;
  await page.getByLabel("적요").fill(edited);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`적요: ${desc} → ${edited}`)).toBeVisible();

  // delete
  await page.getByRole("button", { name: "삭제" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).click();
  await expect(page).toHaveURL(/\/vouchers$/);
  await page.goto(`/vouchers?q=${encodeURIComponent(desc)}`);
  await expect(page.getByRole("row", { name: new RegExp(desc) })).toHaveCount(0);
});

test("일반 전표: 차액이 있으면 저장할 수 없다", async ({ page }) => {
  await page.goto("/vouchers/new");
  await page.getByRole("tab", { name: "일반 전표" }).click();
  await pick(page, "1행 계정", "811");
  await page.getByLabel("1행 차변").fill("1000");
  await pick(page, "2행 계정", "101");
  await page.getByLabel("2행 대변").fill("900");
  await expect(page.getByLabel("차액")).toHaveText("100");
  await expect(page.getByRole("button", { name: "저장" })).toBeDisabled();
});

test("결산 전표: 입력 후 구분 필터로 조회", async ({ page }) => {
  const desc = `E2E 감가상각 ${Date.now()}`;
  await page.goto("/vouchers/new");
  await page.getByRole("tab", { name: "일반 전표" }).click();
  await page.getByLabel("적요", { exact: true }).fill(desc);
  await pick(page, "1행 계정", "818");
  await page.getByLabel("1행 차변").fill("50000");
  await pick(page, "2행 계정", "213");
  await page.getByLabel("2행 대변").fill("50000");
  await expect(page.getByText("세무사 결산 수정 내역(감가상각·대손·미지급비용·법인세 등)을 입력할 때 켭니다.")).toBeVisible();
  await page.getByRole("switch", { name: "결산 전표" }).click();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  await page.goto("/vouchers");
  await page.getByLabel("구분").selectOption("closing");
  await page.getByLabel("검색").fill(desc);
  await page.getByRole("button", { name: "조회" }).click();
  const row = page.getByRole("row", { name: new RegExp(desc) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("결산");

  await page.getByLabel("구분").selectOption("general");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.getByRole("row", { name: new RegExp(desc) })).toHaveCount(0);

  await page.goto(`/vouchers?kind=closing&q=${encodeURIComponent(desc)}`);
  await page.getByRole("row", { name: new RegExp(desc) }).click();
  await expect(page).toHaveURL(/\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByText("구분", { exact: true })).toBeVisible();
  await expect(page.getByText("결산", { exact: true })).toBeVisible();
});

test("계정 추천: 같은 거래처의 이전 계정이 칩으로 나온다", async ({ page }) => {
  const partner = `E2E추천 ${Date.now()}`;

  await page.goto("/vouchers/new");
  await pick(page, "계정", "811");
  await pick(page, "결제 계정", "253");
  await page.getByRole("combobox", { name: "거래처" }).click();
  await page.getByPlaceholder("거래처명 또는 사업자등록번호").fill(partner);
  await page.getByRole("option", { name: /새 거래처 추가/ }).click();
  await page.getByRole("dialog", { name: "새 거래처 추가" }).getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("combobox", { name: "거래처" })).toContainText(partner);
  await page.getByLabel("합계").fill("10000");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장되었습니다.")).toBeVisible();

  // a fresh purchase: picking the same partner suggests the account used before
  await page.goto("/vouchers/new");
  await page.getByRole("combobox", { name: "거래처" }).click();
  await page.getByPlaceholder("거래처명 또는 사업자등록번호").fill(partner);
  await page.getByRole("option").filter({ hasText: partner }).filter({ hasNotText: "새 거래처 추가" }).click();
  await expect(page.getByRole("combobox", { name: "거래처" })).toContainText(partner);
  const chip = page.getByRole("group", { name: "추천 계정" }).getByRole("button", { name: "811 복리후생비" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole("combobox", { name: "계정", exact: true })).toContainText("811 복리후생비");
  await expect(chip).toHaveCount(0);
});
