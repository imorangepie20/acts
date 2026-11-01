import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSimpleVoucher, type TradeInput } from "@/lib/vouchers/simple";
import { getVatAccountIds } from "@/server/accounts/service";
import type { SessionUser } from "@/server/auth/service";
import { accounts, partners, sites, users, voucherImports, vouchers } from "@/server/db/schema";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { loadVatEntries } from "./entries";

const db = getTestDb();
let acc: Record<string, number>;
let assetId: number;
let staff: SessionUser;
let siteId: number;
let partnerId: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db.insert(users).values({ email: "s@test.kr", name: "s", role: "staff", passwordHash: "x" }).returning({ id: users.id });
  staff = { id: u.id, email: "s@test.kr", name: "s", role: "staff" };
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
  const all = await db.select({ id: accounts.id, code: accounts.code, group: accounts.group }).from(accounts);
  acc = Object.fromEntries(all.map((a) => [a.code, a.id]));
  assetId = all.filter((a) => a.group === "noncurrent_asset").sort((a, b) => a.code.localeCompare(b.code))[0].id;
  [{ id: partnerId }] = await db.insert(partners).values({ name: "협력사", businessNumber: "123-45-67890" }).returning({ id: partners.id });
});

async function make(over: Partial<TradeInput>): Promise<string> {
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

describe("loadVatEntries", () => {
  it("reads posted purchase/sale vouchers only", async () => {
    await make({});
    await make({ type: "sale", date: "2026-10-02" });
    const pending = await make({ type: "sale", date: "2026-10-03" });
    await db.update(vouchers).set({ status: "pending" }).where(eq(vouchers.id, pending));
    await make({ date: "2026-11-05" }); // out of range
    // a general voucher
    const g = await createVoucher(db, staff, {
      date: "2026-10-04", description: "g", entryType: "general", kind: "general", partnerId: null, evidenceType: "none", vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null,
      lines: [
        { accountId: acc["811"], side: "debit", amount: 50, partnerId: null, siteId, departmentId: null, description: "" },
        { accountId: acc["251"], side: "credit", amount: 50, partnerId, siteId, departmentId: null, description: "" },
      ],
    });
    if (!g.ok) throw new Error(g.error);
    const e = await loadVatEntries(db, "2026-10-01", "2026-10-31");
    expect(e.map((x) => x.entryType).sort()).toEqual(["purchase", "sale"]);
    const [first] = await db.select({ id: vouchers.id, no: vouchers.no }).from(vouchers).where(eq(vouchers.id, e[0].voucherId));
    expect(first).toBeDefined();
    expect(e[0]).toMatchObject({ date: "2026-10-01", voucherNo: `20261001-${String(first.no).padStart(4, "0")}` });
    expect(e[0]).toMatchObject({ businessNumber: "1234567890", partnerName: "협력사", partnerKey: "1234567890", cardNo: null, paperTaxInvoice: false, unregisteredCard: false });
  });

  it("fixedAsset follows the main line, not the counter account", async () => {
    await make({ date: "2026-10-01", counterAccountId: assetId }); // expense main, asset counter
    await make({ date: "2026-10-02", mainAccountId: assetId }); // asset main
    await make({ date: "2026-10-03", mainAccountId: assetId, supplyAmount: -400, vatAmount: -40 }); // 수정·취소분
    await make({ date: "2026-10-04", supplyAmount: -400, vatAmount: -40, counterAccountId: assetId });
    await make({ type: "sale", date: "2026-10-05" });
    const e = await loadVatEntries(db, "2026-10-01", "2026-10-31");
    expect(e.map((x) => x.fixedAsset)).toEqual([false, true, true, false, false]);
  });

  it("uses import meta for name, business number and card no", async () => {
    const id = await make({ evidenceType: "card", vatDeductible: false, counterAccountId: acc["253"] });
    await db.insert(voucherImports).values({
      importKey: "c1", voucherId: id, source: "card",
      meta: { approvalNo: "1", merchantName: "맛집", merchantBusinessNumber: "111-11-11111", cardNo: "1234-****" },
    });
    const bad = await make({ date: "2026-10-02", partnerId: null, counterAccountId: acc["101"] });
    void bad;
    const e = await loadVatEntries(db, "2026-10-01", "2026-10-31");
    expect(e[0]).toMatchObject({ partnerName: "맛집", businessNumber: "1111111111", partnerKey: "1111111111", cardNo: "1234-****" });
    expect(e[1]).toMatchObject({ businessNumber: null, partnerKey: "none", partnerName: null });
  });

  it("keys a partner without a valid business number by id", async () => {
    await db.update(partners).set({ businessNumber: "12-3" }).where(eq(partners.id, partnerId));
    const [e] = (await make({}), await loadVatEntries(db, "2026-10-01", "2026-10-31"));
    expect(e).toMatchObject({ businessNumber: null, partnerKey: `p:${partnerId}` });
  });
});
