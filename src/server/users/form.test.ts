import { describe, expect, it } from "vitest";
import { parseCreateUser, parseResetPassword, parseUpdateUser } from "./form";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const ID = "0b7e0f6e-3c1e-4d0b-9a55-1f2d3c4b5a69";

describe("user form parsing", () => {
  it("accepts valid update input", () => {
    const r = parseUpdateUser(fd({ id: ID, name: "a", role: "staff", isActive: "false" }));
    expect(r).toEqual({ ok: true, data: { id: ID, name: "a", role: "staff", isActive: false } });
  });

  it.each(["toString", "__proto__", "constructor", "root", ""])("rejects role %j", (role) => {
    expect(parseCreateUser(fd({ email: "a@b.kr", name: "n", role, password: "x" })).ok).toBe(false);
    expect(parseUpdateUser(fd({ id: ID, name: "n", role, isActive: "true" })).ok).toBe(false);
  });

  it("rejects non-uuid id", () => {
    expect(parseUpdateUser(fd({ id: "123", name: "n", role: "staff", isActive: "true" })).ok).toBe(false);
    expect(parseResetPassword(fd({ id: "nope", password: "x" })).ok).toBe(false);
  });

  it("rejects missing or garbage isActive (never deactivates)", () => {
    expect(parseUpdateUser(fd({ id: ID, name: "n", role: "staff" })).ok).toBe(false);
    expect(parseUpdateUser(fd({ id: ID, name: "n", role: "staff", isActive: "yes" })).ok).toBe(false);
  });
});
