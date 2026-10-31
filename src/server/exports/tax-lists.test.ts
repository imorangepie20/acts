import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { buildSimpleVoucher, type TradeInput } from "@/lib/vouchers/simple";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { accounts, partners, sites, users, voucherImports, vouchers } from "@/server/db/schema";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { buildTaxListSpecs, exportPermission } from "./specs";
import { listCardPurchases, listTaxInvoices } from "./tax-lists";
import { renderWorkbook } from "./xlsx";

const db = getTestDb();
let acc: Record<string, number>;
let staff: SessionUser;
let siteId: number;
let partnerId: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "s", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  staff = { id: u.id, email: "s@test.kr", name: "s", role: "staff" };
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  acc = Object.fromEntries((await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]));
  [{ id: partnerId }] = await db
    .insert(partners)
    .values({ name: "협력사", businessNumber: "1234567890" })
    .returning({ id: partners.id });
});

type Over = Partial<TradeInput>;

async function make(over: Over): Promise<string> {
  const sale = over.type === "sale";
  const b = buildSimpleVoucher(
    {
      type: "purchase", date: "2026-10-01", description: "t",
      mainAccountId: acc[sale ? "401" : "811"], counterAccountId: acc[sale ? "108" : "251"],
      partnerId, siteId, departmentId: null,
      evidenceType: "tax_invoice", vatType: "taxable", vatDeductible: true, supplyAmount: 1000, vatAmount: 100,
      ...over,
    },
    await getVatAccountIds(db),
  );
  if (!b.ok) throw new Error(b.error);
  const r = await createVoucher(db, staff, b.value);
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}
const setStatus = (id: string, status: "pending" | "rejected") =>
  db.update(vouchers).set({ status }).where(eq(vouchers.id, id));

describe("listTaxInvoices", () => {
  it("lists only posted vouchers, with partner fields and total", async () => {
    await make({});
    await setStatus(await make({ date: "2026-10-02" }), "pending");
    await setStatus(await make({ date: "2026-10-03" }), "rejected");
    const rows = await listTaxInvoices(db, "2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "매입", evidence: "세금계산서", partnerName: "협력사", businessNumber: "123-45-67890",
      supplyAmount: 1000, vatAmount: 100, total: 1100, approvalNo: null,
    });
    expect(rows[0].siteName).not.toBe("");
  });

  it("shows the imported approval number and prefers import meta", async () => {
    const id = await make({ type: "sale", evidenceType: "invoice", vatType: "exempt", vatAmount: 0 });
    await db.insert(voucherImports).values({
      importKey: "k1", voucherId: id, source: "tax_invoice",
      meta: { approvalNo: "2026-AAA", merchantName: "원본상호", merchantBusinessNumber: "9876543210", cardNo: null },
    });
    const [r] = await listTaxInvoices(db, "2026-10-01", "2026-10-31");
    expect(r).toMatchObject({ direction: "매출", evidence: "계산서", approvalNo: "2026-AAA", partnerName: "원본상호", businessNumber: "987-65-43210" });
  });
});

describe("listCardPurchases", () => {
  it("lists the imported merchant, not the card-company partner", async () => {
    const id = await make({ evidenceType: "card", vatDeductible: false, counterAccountId: acc["253"] });
    await db.insert(voucherImports).values({
      importKey: "c1", voucherId: id, source: "card",
      meta: { approvalNo: "123", merchantName: "맛집", merchantBusinessNumber: "1111111111", cardNo: "1234-****" },
    });
    await make({ date: "2026-10-04" }); // tax invoice: not a card row
    const rows = await listCardPurchases(db, "2026-10-01", "2026-10-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evidence: "신용카드", merchantName: "맛집", merchantBusinessNumber: "111-11-11111", cardNo: "1234-****", deductible: false });
  });
});

describe("workbooks and permissions", () => {
  it("renders tax invoices as 매출/매입 sheets with 합계 rows", async () => {
    await make({});
    const specs = await buildTaxListSpecs(db, "tax-invoices", "2026-10-01", "2026-10-31");
    expect(specs[0].fileName).toBe("세금계산서_2026-10-01_2026-10-31");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderWorkbook(specs)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["매출", "매입"]);
    const last = (n: number) => specs[n].rows[specs[n].rows.length - 1];
    expect(last(0)).toMatchObject({ partnerName: "합계", supplyAmount: 0 });
    expect(last(1)).toMatchObject({ partnerName: "합계", supplyAmount: 1000, vatAmount: 100, total: 1100 });
  });

  it("card sheet shows 공제/불공제", async () => {
    await make({ evidenceType: "card", vatDeductible: false });
    const [s] = await buildTaxListSpecs(db, "card-purchases", "2026-10-01", "2026-10-31");
    expect(s.title).toBe("카드·현금영수증 매입");
    expect(s.rows[0].deductible).toBe("불공제");
  });

  it("tax keys need export:tax, which executive lacks", () => {
    expect(exportPermission("tax-invoices")).toBe("export:tax");
    expect(exportPermission("card-purchases")).toBe("export:tax");
    expect(exportPermission("journal")).toBe("ledger:view");
    expect(can("executive", exportPermission("tax-invoices"))).toBe(false);
    expect(can("staff", exportPermission("tax-invoices"))).toBe(true);
  });
});
