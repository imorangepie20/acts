import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { getCompany, updateCompany } from "@/server/company/service";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { loadVatView } from "./view";

const db = getTestDb();

let actorId: string;

beforeEach(async () => {
  await resetDb(db);
  await seedReference(db);
  [{ id: actorId }] = await db.insert(users).values({ email: "m@test.kr", name: "m", role: "manager", passwordHash: "x" }).returning({ id: users.id });
});
// Other tests share the DB: put the business type back.
afterEach(async () => {
  const c = await getCompany(db);
  await updateCompany(db, { ...c, businessType: "corporation" }, actorId);
});

async function setType(businessType: "corporation" | "individual") {
  const c = await getCompany(db);
  const r = await updateCompany(db, { ...c, businessType }, actorId);
  if (!r.ok) throw new Error(r.error);
}

describe("loadVatView", () => {
  it("defaults from the company business type", async () => {
    await setType("individual");
    const v = await loadVatView(db, { year: "2026", term: "1", kind: "final" });
    expect(v.company.businessType).toBe("individual");
    expect(v.selection.prelimFiled).toBe(false);
    expect(v.period).toEqual({ from: "2026-01-01", to: "2026-06-30" });
  });

  it("a corporation defaults to 예정신고를 했음, so 확정 covers three months", async () => {
    await setType("corporation");
    const v = await loadVatView(db, { year: "2026", term: "2", kind: "final" });
    expect(v.company.businessType).toBe("corporation");
    expect(v.selection.prelimFiled).toBe(true);
    expect(v.period).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("invalid notice falls back to 0 with an error", async () => {
    const v = await loadVatView(db, { year: "2026", term: "1", kind: "final", notice: "abc" });
    expect(v.selection.notice).toBe(0);
    expect(v.selection.errors.notice).toBeTruthy();
  });
});
