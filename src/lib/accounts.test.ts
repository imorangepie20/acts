import { expect, it } from "vitest";
import { normalSideOf, suggestGroup } from "./accounts";

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
