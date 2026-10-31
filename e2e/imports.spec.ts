import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

/** Valid business number from a 9-digit prefix (same checksum as src/lib/business-number.ts). */
function bnFrom(prefix9: string): string {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const d = [...prefix9].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  sum += Math.floor((d[8] * 5) / 10);
  return prefix9 + String((10 - (sum % 10)) % 10);
}

const uniq = () => String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 90) + 10);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

async function xlsx(header: string[], rows: (string | number)[][], titleRows = 2): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (let i = 0; i < titleRows; i++) ws.addRow([`홈택스 조회 ${i + 1}`]);
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function companyBn(page: Page): Promise<string> {
  await page.goto("/admin/company");
  return (await page.getByLabel("사업자등록번호").inputValue()).replace(/\D/g, "");
}

test("매입 세금계산서: 일괄 계정 지정 후 전표 생성, 재업로드는 중복", async ({ page }) => {
  const id = uniq();
  const own = (await companyBn(page)) || bnFrom("123456789");
  const nameA = `임포트가${id}`;
  const nameB = `임포트나${id}`;
  const file = await xlsx(
    ["작성일자", "승인번호", "공급자사업자등록번호", "상호", "대표자명", "공급받는자사업자등록번호", "상호", "공급가액", "세액", "품목명"],
    [
      [today(), `A${id}1`, bnFrom(`1${id.slice(0, 8)}`), nameA, "김가", own, "우리", 100000, 10000, "사무용품"],
      [today(), `A${id}2`, bnFrom(`2${id.slice(0, 8)}`), nameB, "김나", own, "우리", 200000, 20000, "소모품"],
    ],
  );

  await page.goto("/imports");
  await page.getByRole("tab", { name: "전자세금계산서" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "purchase.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  });
  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText("업로드 완료 · purchase.xlsx에서 2건을 읽었습니다. 전표로 만들 수 있는 건 2건.")).toBeVisible();
  await expect(page.getByText("새 거래처")).toHaveCount(2);

  const create = page.getByRole("button", { name: /전표 만들기/ });
  await page.getByRole("combobox", { name: "계정 일괄 지정" }).click();
  const search = page.getByPlaceholder("코드 또는 이름으로 검색");
  await search.fill("811");
  await search.press("Enter");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByText("2건을 전표로 만들었습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: "전표 보기" })).toHaveCount(2);

  await page.goto(`/vouchers?q=${encodeURIComponent(nameA)}`);
  await expect(page.getByRole("row").filter({ hasText: nameA }).first()).toBeVisible();
  await page.goto(`/vouchers?q=${encodeURIComponent(nameB)}`);
  await expect(page.getByRole("row").filter({ hasText: nameB }).first()).toBeVisible();

  await page.goto("/imports");
  await page.locator('input[type="file"]').setInputFiles({
    name: "purchase.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  });
  await expect(page.getByText("이미 불러온 자료")).toHaveCount(2);
  await expect(page.getByText("전표로 만들 수 있는 건 0건, 이미 불러온 건 2건.", { exact: false })).toBeVisible();
});

test("카드 사용내역: 봉사료 행은 비활성과 사유가 보인다", async ({ page }) => {
  const id = uniq();
  const file = await xlsx(
    ["승인일자", "가맹점명", "합계", "봉사료", "승인번호", "카드번호"],
    [
      [today(), `식당${id}`, 55000, 5000, `C${id}1`, "1234-5678-9012-3456"],
      [today(), `문구점${id}`, 11000, 0, `C${id}2`, "1234-5678-9012-3456"],
    ],
  );
  await page.goto("/imports");
  await page.getByRole("tab", { name: "카드 사용내역" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "card.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  });
  const blocked = page.getByRole("row").filter({ hasText: `식당${id}` });
  await expect(blocked.getByText("봉사료가 있는 건은 직접 입력하세요.")).toBeVisible();
  await expect(blocked.getByRole("checkbox")).toBeDisabled();
  const ok = page.getByRole("row").filter({ hasText: `문구점${id}` });
  await expect(ok.getByRole("checkbox")).toBeEnabled();
});
