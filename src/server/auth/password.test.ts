import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies correct and rejects wrong", async () => {
    const h = await hashPassword("pw-1234");
    expect(await verifyPassword("pw-1234", h)).toBe(true);
    expect(await verifyPassword("pw-12345", h)).toBe(false);
  });
  it("uses random salt", async () => {
    expect(await hashPassword("pw-1234")).not.toBe(await hashPassword("pw-1234"));
  });
});
