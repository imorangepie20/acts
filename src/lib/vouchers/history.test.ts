import { describe, expect, it } from "vitest";
import { describeChanges } from "./history";
import type { LineInput, VoucherSnapshot } from "./types";

const line = (accountId: number, side: LineInput["side"], amount: number, partnerId: number | null = null): LineInput => ({
  accountId,
  side,
  amount,
  partnerId,
  siteId: 1,
  departmentId: null,
  description: "점심",
});

const base: VoucherSnapshot = {
  date: "2026-10-30",
  description: "점심",
  entryType: "transfer",
  kind: "general",
  partnerId: null,
  evidenceType: "card",
  vatType: null,
  vatDeductible: null,
  supplyAmount: null,
  vatAmount: null,
  no: 1,
  status: "approved",
  attachments: [],
  lines: [line(811, "debit", 10_000), line(101, "credit", 10_000)],
};

const names = {
  account: (id: number) => `계정${id}`,
  partner: (id: number | null) => (id === null ? "없음" : id === 7 ? "거래처A" : `거래처${id}`),
};

describe("describeChanges", () => {
  it("returns [] for identical snapshots", () => {
    expect(describeChanges(base, structuredClone(base), names)).toEqual([]);
  });

  it("reports a kind change", () => {
    expect(describeChanges(base, { ...base, kind: "closing" }, names)).toEqual(["구분: 일반 → 결산"]);
  });

  it("treats a snapshot without kind as general", () => {
    const old: Partial<VoucherSnapshot> = { ...base };
    delete old.kind;
    expect(describeChanges(old as VoucherSnapshot, base, names)).toEqual([]);
  });

  it("reports a date change", () => {
    expect(describeChanges(base, { ...base, date: "2026-10-31" }, names)).toEqual([
      "날짜: 2026-10-30 → 2026-10-31",
    ]);
  });

  it("reports a description change without a line change when lines follow the header", () => {
    const next: VoucherSnapshot = {
      ...base,
      description: "회식",
      lines: base.lines.map((l) => ({ ...l, description: "회식" })),
    };
    expect(describeChanges(base, next, names)).toEqual(["적요: 점심 → 회식"]);
  });

  it("reports an amount change as the debit total", () => {
    const next: VoucherSnapshot = {
      ...base,
      lines: [line(811, "debit", 12_000), line(101, "credit", 12_000)],
    };
    expect(describeChanges(base, next, names)).toEqual(["금액: 10,000 → 12,000"]);
  });

  it("reports a partner change by name", () => {
    const next: VoucherSnapshot = {
      ...base,
      partnerId: 7,
      lines: base.lines.map((l) => ({ ...l, partnerId: 7 })),
    };
    expect(describeChanges(base, next, names)).toEqual(["거래처: 없음 → 거래처A"]);
  });

  it("reports a status change with Korean labels", () => {
    expect(describeChanges({ ...base, status: "pending" }, base, names)).toEqual(["상태: 승인 대기 → 승인"]);
  });

  it("reports other line differences as 분개 줄 변경", () => {
    const next: VoucherSnapshot = {
      ...base,
      lines: [line(812, "debit", 10_000), line(101, "credit", 10_000)],
    };
    expect(describeChanges(base, next, names)).toEqual(["분개 줄 변경"]);
  });
});
