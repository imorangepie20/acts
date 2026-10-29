import { describe, expect, it } from "vitest";
import { ACCOUNT_GROUPS, isBalanceSheetGroup, isPnlGroup, normalSideOf, suggestGroup } from "./accounts";

it("suggests group from Douzone ranges", () => {
  expect(suggestGroup("103")).toBe("current_asset");
  expect(suggestGroup("212")).toBe("noncurrent_asset");
  expect(suggestGroup("255")).toBe("current_liability");
  expect(suggestGroup("813")).toBe("sga");
  expect(suggestGroup("951")).toBe("non_operating_expense");
  expect(suggestGroup("998")).toBe("income_tax");
  expect(suggestGroup("099")).toBeNull();
  expect(suggestGroup("ab")).toBeNull();
});
it("normal side", () => {
  expect(normalSideOf("sga")).toBe("debit");
  expect(normalSideOf("revenue")).toBe("credit");
});

describe("pnl/bs split", () => {
  it("puts every group in exactly one set", () => {
    for (const g of ACCOUNT_GROUPS) expect(isPnlGroup(g) !== isBalanceSheetGroup(g)).toBe(true);
  });
});
