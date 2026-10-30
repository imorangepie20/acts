import { beforeEach, describe, expect, it } from "vitest";
import type { LineInput, VoucherInput } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { accounts, sites, users } from "@/server/db/schema";
import { createVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { buildSheetSpec } from "./specs";

const db = getTestDb();
let acc: Record<string, number>;
let staff: SessionUser;
let siteId: number;

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
});

const line = (code: string, side: LineInput["side"], amount: number): LineInput => ({
  accountId: acc[code], side, amount, partnerId: null, siteId, departmentId: null, description: "",
});
async function create() {
  const input: VoucherInput = {
    date: "2026-10-01", description: "t", entryType: "general", kind: "general", partnerId: null, evidenceType: "none",
    vatType: null, vatDeductible: null, supplyAmount: null, vatAmount: null,
    lines: [line("811", "debit", 3000), line("101", "credit", 3000)],
  };
  const r = await createVoucher(db, staff, input);
  if (!r.ok) throw new Error(r.error);
}

describe("buildSheetSpec", () => {
  it("trial balance: file name, company meta, numeric rows with codes", async () => {
    await create();
    const s = await buildSheetSpec(db, "trial-balance", { to: "2026-10-30" });
    expect(s).not.toBeNull();
    expect(s!.fileName).toBe("합계잔액시산표_2026-10-30");
    expect(s!.meta[0]).toBe("테스트 회사");
    const row = s!.rows.find((r) => String(r.name).startsWith("101"));
    expect(row).toBeDefined();
    expect(typeof row!.creditTotal).toBe("number");
    expect(row!.creditTotal).toBe(3000);
  });

  it("account ledger without account is null", async () => {
    expect(await buildSheetSpec(db, "account-ledger", {})).toBeNull();
    expect(await buildSheetSpec(db, "partner-ledger", { account: "999999" })).toBeNull();
  });

  it("journal export is not paginated and carries codes", async () => {
    await create();
    const s = await buildSheetSpec(db, "journal", { from: "2026-10-01", to: "2026-10-31" });
    expect(s!.fileName).toBe("분개장_2026-10-01_2026-10-31");
    expect(s!.rows.some((r) => String(r.account).startsWith("811"))).toBe(true);
  });

  it("account ledger file name has code and name", async () => {
    await create();
    const s = await buildSheetSpec(db, "account-ledger", { account: String(acc["101"]), from: "2026-10-01", to: "2026-10-31" });
    expect(s!.fileName).toMatch(/^계정별원장_101.+_2026-10-01_2026-10-31$/);
  });

  it("income statement and balance sheet build", async () => {
    await create();
    const is = await buildSheetSpec(db, "income-statement", { from: "2026-01-01", to: "2026-12-31" });
    expect(is!.fileName).toBe("손익계산서_2026-01-01_2026-12-31");
    const bs = await buildSheetSpec(db, "balance-sheet", { to: "2026-10-30" });
    expect(bs!.fileName).toBe("재무상태표_2026-10-30");
    expect(bs!.rows.length).toBeGreaterThan(0);
  });
});
