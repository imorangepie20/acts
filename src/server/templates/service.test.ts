import { beforeEach, describe, expect, it } from "vitest";
import { MAX_TEMPLATES, type TemplateBody } from "@/lib/vouchers/templates";
import type { SessionUser } from "@/server/auth/service";
import { accounts, users, voucherTemplates } from "@/server/db/schema";
import { createPartner } from "@/server/partners/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { deleteTemplate, listTemplates, saveTemplate } from "./service";

const db = getTestDb();
let user: SessionUser;
let acc: Record<string, number>;
let partnerId: number;

const trade = (over: Partial<Extract<TemplateBody, { type: "purchase" | "sale" }>> = {}): TemplateBody => ({
  type: "purchase",
  description: "월 임차료",
  mainAccountId: acc["819"],
  counterAccountId: acc["253"],
  partnerId,
  evidenceType: "tax_invoice",
  vatType: "taxable",
  vatDeductible: true,
  supplyAmount: 1_000_000,
  vatAmount: 100_000,
  ...over,
});

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db
    .insert(users)
    .values({ email: "s@test.kr", name: "직원", role: "staff", passwordHash: "x" })
    .returning({ id: users.id });
  user = { id: u.id, email: "s@test.kr", name: "직원", role: "staff" };
  acc = Object.fromEntries(
    (await db.select({ id: accounts.id, code: accounts.code }).from(accounts)).map((a) => [a.code, a.id]),
  );
  const p = await createPartner(db, {
    name: "건물주",
    businessNumber: null,
    representative: null,
    phone: null,
    email: null,
    memo: null,
  });
  if (!p.ok) throw new Error(p.error);
  partnerId = p.value.id;
});

describe("templates", () => {
  it("round-trips the three body types", async () => {
    const bodies: TemplateBody[] = [
      trade(),
      {
        type: "transfer",
        description: "이체",
        debitAccountId: acc["103"],
        creditAccountId: acc["101"],
        partnerId: null,
        evidenceType: "none",
        amount: null,
      },
      {
        type: "general",
        description: "분개",
        closing: true,
        lines: [
          { accountId: acc["101"], side: "debit", amount: 500, partnerId, description: "a" },
          { accountId: null, side: "credit", amount: null, partnerId: null, description: "" },
        ],
      },
    ];
    for (const [i, b] of bodies.entries()) {
      const r = await saveTemplate(db, user, `t${i}`, b);
      expect(r.ok).toBe(true);
    }
    const list = await listTemplates(db);
    expect(list.map((t) => t.name)).toEqual(["t0", "t1", "t2"]);
    expect(list.map((t) => t.body)).toEqual(bodies);
    expect(list[0].partners).toEqual([{ id: partnerId, name: "건물주" }]);
    expect(list[1].partners).toEqual([]);
    expect(list[2].partners).toEqual([{ id: partnerId, name: "건물주" }]);
  });

  it("replaces a template saved under the same name", async () => {
    const a = await saveTemplate(db, user, " 월 임차료 ", trade());
    const b = await saveTemplate(db, user, "월 임차료", trade({ supplyAmount: 2_000_000 }));
    expect(a.ok && b.ok && a.value.id === b.value.id).toBe(true);
    const list = await listTemplates(db);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("월 임차료");
    expect(list[0].body).toMatchObject({ supplyAmount: 2_000_000 });
  });

  it("rejects a blank name", async () => {
    expect(await saveTemplate(db, user, "   ", trade())).toEqual({ ok: false, error: "템플릿 이름을 입력하세요." });
  });

  it("rejects unknown account or partner ids", async () => {
    expect((await saveTemplate(db, user, "x", trade({ mainAccountId: 999_999 }))).ok).toBe(false);
    expect((await saveTemplate(db, user, "x", trade({ partnerId: 999_999 }))).ok).toBe(false);
    expect(await listTemplates(db)).toHaveLength(0);
  });

  it("caps new names at 200 but still overwrites at the cap", async () => {
    await db.insert(voucherTemplates).values(
      Array.from({ length: MAX_TEMPLATES }, (_, i) => ({
        name: `n${i}`,
        entryType: "purchase" as const,
        body: trade(),
      })),
    );
    const over = await saveTemplate(db, user, "새 이름", trade());
    expect(over).toEqual({ ok: false, error: "템플릿은 200개까지 저장할 수 있습니다." });
    expect((await saveTemplate(db, user, "n5", trade({ description: "변경" }))).ok).toBe(true);
    expect(await listTemplates(db)).toHaveLength(MAX_TEMPLATES);
  });

  it("deletes a template", async () => {
    const r = await saveTemplate(db, user, "a", trade());
    if (!r.ok) throw new Error(r.error);
    expect((await deleteTemplate(db, r.value.id)).ok).toBe(true);
    expect(await listTemplates(db)).toHaveLength(0);
    expect((await deleteTemplate(db, r.value.id)).ok).toBe(false);
  });
});
