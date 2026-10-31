import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { isValidBusinessNumber } from "@/lib/business-number";
import type { SessionUser } from "@/server/auth/service";
import { getCompany, updateCompany } from "@/server/company/service";
import { accounts, partners, periodCloses, sites, users, voucherImports, voucherLines, vouchers } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { deleteVoucher } from "@/server/vouchers/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { commitImport, previewImport, type CommitRow, type PreviewRow } from "./service";

const db = getTestDb();

const validBn = (seed: number): string => {
  for (let d = 0; d < 10; d++) {
    const bn = String(100000000 + seed * 7).padStart(9, "0") + d;
    if (isValidBusinessNumber(bn)) return bn;
  }
  throw new Error("no bn");
};
const US = validBn(1);
const THEM = validBn(2);
const THEM2 = validBn(3);

const TAX_HEAD = [
  "작성일자", "승인번호", "공급자사업자등록번호", "종사업장번호", "상호", "대표자명",
  "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명",
  "공급가액", "세액", "전자세금계산서종류", "품목명",
];

async function book(rows: (string | number | null)[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** A purchase row: supplier = theirBn, buyer = ourBn. */
const taxRow = (date: string, approvalNo: string, supply: number, item: string, theirBn = THEM, ourBn = US) => [
  date, approvalNo, theirBn, null, "공급사", "김공급", ourBn, null, "구매사", "이구매", supply, supply / 10, "세금계산서", item,
];

const purchaseFile = () =>
  book([
    TAX_HEAD,
    taxRow("2026-10-15", "20261015-1000-a1", 1000000, "철판"),
    taxRow("2026-10-16", "20261016-1000-a2", 500000, "임차료", THEM2),
  ]);

let staff: SessionUser;
let manager: SessionUser;
let acc: Record<string, number>;
let siteId: number;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const mk = async (email: string, role: SessionUser["role"]): Promise<SessionUser> => {
    const [u] = await db.insert(users).values({ email, name: email, role, passwordHash: "x" }).returning({ id: users.id });
    return { id: u.id, email, name: email, role };
  };
  staff = await mk("staff@test.kr", "staff");
  manager = await mk("manager@test.kr", "manager");
  acc = Object.fromEntries((await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]));
  [{ id: siteId }] = await db.select({ id: sites.id }).from(sites);
});

async function setApproval(on: boolean) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, approvalRequired: on }, manager.id);
  if (!r.ok) throw new Error(r.error);
}
async function setOwnBn(bn: string) {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, businessNumber: bn }, manager.id);
  if (!r.ok) throw new Error(r.error);
}
async function openingAt(date: string) {
  await db.insert(vouchers).values({
    date, no: 1, kind: "opening", entryType: "general", status: "approved", createdBy: manager.id, updatedBy: manager.id,
  });
}

async function preview(bytes: Uint8Array, kind: "tax_invoice" | "card" = "tax_invoice", dir: "purchase" | "sale" = "purchase") {
  const r = await previewImport(db, kind, dir, bytes);
  if (!r.ok) throw new Error(r.error);
  return r.value.rows;
}

const toCommit = (r: PreviewRow, over: Partial<CommitRow> = {}): CommitRow => ({
  key: r.key,
  date: r.date!,
  description: r.description,
  mainAccountId: acc["811"],
  deductible: r.deductible,
  partnerId: r.partnerId,
  counterparty: { name: r.counterpartyName, businessNumber: r.counterpartyBusinessNumber, representative: r.representative },
  evidenceType: r.evidenceType,
  vatType: r.vatType,
  supplyAmount: r.supplyAmount,
  vatAmount: r.vatAmount,
  meta: r.meta,
  ...over,
});
const commitInput = (rows: CommitRow[]) => ({
  kind: "tax_invoice" as const,
  direction: "purchase" as const,
  counterAccountId: acc["251"],
  cardPartnerId: null,
  siteId,
  departmentId: null,
  rows,
});
const ALREADY = "이미 불러온 자료입니다.";

describe("imports", () => {
  it("previews a 2-row purchase file as ready with recommendations", async () => {
    const rows = await preview(await purchaseFile());
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[1].recommendations.length).toBeGreaterThan(0); // 임차료 keyword fallback
    expect(rows[0].partnerId).toBeNull();
  });

  it("commits pending vouchers with the 135 split, a new partner and import rows", async () => {
    await setApproval(true);
    const rows = await preview(await purchaseFile());
    const r = await commitImport(db, staff, commitInput(rows.map((x) => toCommit(x))));
    expect(r.failed).toEqual([]);
    expect(r.created).toHaveLength(2);
    expect((await db.select().from(vouchers)).map((v) => v.status)).toEqual(["pending", "pending"]);
    const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, r.created[0].id));
    expect(lines.find((l) => l.accountId === acc["135"])?.amount).toBe(100000);
    expect((await db.select().from(partners)).map((p) => p.businessNumber).sort()).toEqual([THEM, THEM2].sort());
    expect(await db.select().from(voucherImports)).toHaveLength(2);
    expect((await preview(await purchaseFile())).every((x) => x.status === "duplicate" && x.partnerId !== null)).toBe(true);
  });

  it("re-import is flagged and refused", async () => {
    const rows = await preview(await purchaseFile());
    await commitImport(db, staff, commitInput(rows.map((x) => toCommit(x))));
    const again = await preview(await purchaseFile());
    expect(again.map((x) => x.status)).toEqual(["duplicate", "duplicate"]);
    const r = await commitImport(db, staff, commitInput(again.map((x) => toCommit(x))));
    expect(r.created).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual([ALREADY, ALREADY]);
    expect(await db.select().from(vouchers)).toHaveLength(2);
  });

  it("concurrent commit creates one voucher", async () => {
    const [row] = await preview(await purchaseFile());
    const input = commitInput([toCommit(row)]);
    const [a, b] = await Promise.all([commitImport(db, staff, input), commitImport(db, manager, input)]);
    expect(a.created.length + b.created.length).toBe(1);
    expect([...a.failed, ...b.failed].map((f) => f.error)).toEqual([ALREADY]);
    expect(await db.select().from(vouchers)).toHaveLength(1);
  });

  it("deleting an imported voucher makes its row importable again", async () => {
    await setApproval(true);
    const [row] = await preview(await purchaseFile());
    const r = await commitImport(db, staff, commitInput([toCommit(row)]));
    const [v] = await db.select().from(vouchers).where(eq(vouchers.id, r.created[0].id));
    expect((await deleteVoucher(db, staff, v.id, v.version)).ok).toBe(true);
    expect((await preview(await purchaseFile()))[0].status).toBe("ready");
  });

  it("fails a file in the wrong direction when the company number is set", async () => {
    await setOwnBn(US);
    const ours = await book([TAX_HEAD, taxRow("2026-10-15", "S1", 1000, "x", THEM, US)]);
    const notOurs = await book([TAX_HEAD, taxRow("2026-10-15", "S2", 1000, "x", US, THEM)]);
    expect((await previewImport(db, "tax_invoice", "purchase", ours)).ok).toBe(true);
    expect(await previewImport(db, "tax_invoice", "purchase", notOurs)).toEqual({
      ok: false,
      error: "이 파일의 공급받는자가 우리 회사가 아닙니다. 매입·매출 선택을 확인하세요.",
    });
    expect(await previewImport(db, "tax_invoice", "sale", ours)).toEqual({
      ok: false,
      error: "이 파일의 공급자가 우리 회사가 아닙니다. 매입·매출 선택을 확인하세요.",
    });
  });

  it("blocks closed-month rows, rows before the cut-off and inactive partners", async () => {
    await db.insert(periodCloses).values({ month: "2026-08", closedBy: manager.id });
    const rows = await preview(await book([TAX_HEAD, taxRow("2026-08-10", "C1", 1000, "a"), taxRow("2026-10-10", "C2", 1000, "b")]));
    expect(rows.map((r) => r.status)).toEqual(["blocked", "ready"]);
    expect(rows[0].reason).toBe("마감된 월(2026-08)의 전표는 추가·수정·삭제할 수 없습니다.");

    await db.delete(periodCloses);
    await openingAt("2026-01-31");
    const p = await createPartner(db, { name: "휴면사", businessNumber: THEM2, representative: null, phone: null, email: null, memo: null });
    if (!p.ok) throw new Error(p.error);
    await db.update(partners).set({ isActive: false }).where(eq(partners.id, p.value.id));
    const rows2 = await preview(
      await book([
        TAX_HEAD,
        taxRow("2026-01-15", "K1", 1000, "a"),
        taxRow("2026-10-10", "K2", 1000, "b", THEM2),
        taxRow("2026-10-11", "", 1000, "c"),
        taxRow("2026-10-12", "", 1000, "d"),
      ]),
    );
    expect(rows2[0].reason).toBe("기초잔액 기준일(2026-01-31) 이후 날짜만 입력할 수 있습니다.");
    expect(rows2[1].reason).toBe("거래처(휴면사)가 사용 중지 상태입니다.");
    expect([rows2[2].status, rows2[3].status]).toEqual(["blocked", "blocked"]); // blank 승인번호 rows share a key
  });

  it("at commit one bad row fails while the other succeeds", async () => {
    await openingAt("2026-01-31");
    const rows = await preview(await book([TAX_HEAD, taxRow("2026-01-15", "B1", 1000, "a"), taxRow("2026-10-10", "B2", 1000, "b")]));
    const r = await commitImport(db, staff, commitInput(rows.map((x) => toCommit(x))));
    expect(r.created).toHaveLength(1);
    expect(r.failed).toEqual([{ key: rows[0].key, error: "기초잔액 기준일(2026-01-31) 이후 날짜만 입력할 수 있습니다." }]);
  });

  it("imports card rows with merchant meta and the card partner", async () => {
    const p = await createPartner(db, { name: "카드사", businessNumber: null, representative: null, phone: null, email: null, memo: null });
    if (!p.ok) throw new Error(p.error);
    const file = await book([
      ["승인일자", "가맹점명", "이용금액", "카드번호", "승인번호"],
      ["2026-10-15", "스타벅스", "11,000", "1234-5678-9012-3456", "A1"],
    ]);
    const rows = await preview(file, "card");
    expect(rows[0].status).toBe("ready");
    const r = await commitImport(db, staff, {
      kind: "card",
      direction: "purchase",
      counterAccountId: acc["253"],
      cardPartnerId: p.value.id,
      siteId,
      departmentId: null,
      rows: [toCommit(rows[0], { counterparty: null, partnerId: null })],
    });
    expect(r.failed).toEqual([]);
    const [imp] = await db.select().from(voucherImports);
    expect(imp.source).toBe("card");
    expect(imp.meta.merchantName).toBe("스타벅스");
  });
});
