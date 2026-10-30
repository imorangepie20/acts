import { describe, expect, it } from "vitest";
import { parseVoucherPayload } from "./form";

const voucher = {
  date: "2026-10-30",
  description: " 회식비 ",
  entryType: "general",
  partnerId: null,
  evidenceType: "none",
  vatType: null,
  vatDeductible: null,
  supplyAmount: null,
  vatAmount: null,
  lines: [
    { accountId: 1, side: "debit", amount: 1000, partnerId: null, siteId: 1, departmentId: null, description: "" },
    { accountId: 2, side: "credit", amount: 1000, partnerId: null, siteId: 1, departmentId: null, description: "" },
  ],
};

describe("parseVoucherPayload", () => {
  it("defaults kind to general and accepts closing", () => {
    const r = parseVoucherPayload({ mode: "general", voucher });
    expect(r.ok && r.data.mode === "general" && r.data.voucher.kind).toBe("general");
    const c = parseVoucherPayload({ mode: "general", voucher: { ...voucher, kind: "closing" } });
    expect(c.ok && c.data.mode === "general" && c.data.voucher.kind).toBe("closing");
  });

  it("rejects kind opening", () => {
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, kind: "opening" } }).ok).toBe(false);
  });

  it("accepts a general voucher and trims descriptions", () => {
    const r = parseVoucherPayload({ mode: "general", voucher });
    expect(r.ok).toBe(true);
    if (r.ok && r.data.mode === "general") expect(r.data.voucher.description).toBe("회식비");
  });

  it("accepts a simple transfer", () => {
    const r = parseVoucherPayload({
      mode: "simple",
      simple: {
        type: "transfer",
        date: "2026-10-30",
        description: "",
        debitAccountId: 1,
        creditAccountId: 2,
        amount: 5000,
        partnerId: null,
        siteId: 1,
        departmentId: null,
        evidenceType: "none",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects bad shapes", () => {
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, entryType: "x" } }).ok).toBe(false);
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, lines: [{ accountId: "1" }] } }).ok).toBe(false);
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, supplyAmount: 1.5 } }).ok).toBe(false);
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, vatAmount: -1 } }).ok).toBe(false);
    expect(parseVoucherPayload({ mode: "general", voucher: { ...voucher, supplyAmount: 1e15 } }).ok).toBe(false);
    expect(parseVoucherPayload({ mode: "other" }).ok).toBe(false);
    expect(parseVoucherPayload(null).ok).toBe(false);
  });
});
