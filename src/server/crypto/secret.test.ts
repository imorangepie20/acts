import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hmacSecret,
  keyedHash,
  MissingEncryptionKeyError,
} from "./secret";

const KEY = process.env.PAYROLL_ENCRYPTION_KEY;
afterEach(() => {
  process.env.PAYROLL_ENCRYPTION_KEY = KEY;
});

describe("secret", () => {
  it("round trips", () => {
    const c = encryptSecret("900101-1234568");
    expect(c.startsWith("v1:")).toBe(true);
    expect(decryptSecret(c)).toBe("900101-1234568");
  });
  it("differs per encryption", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("throws on tampered ciphertext", () => {
    const p = encryptSecret("hello").split(":");
    const ct = Buffer.from(p[3], "base64");
    ct[0] ^= 1;
    p[3] = ct.toString("base64");
    expect(() => decryptSecret(p.join(":"))).toThrow();
  });
  it("hmac is deterministic and input-specific", () => {
    expect(hmacSecret("a")).toBe(hmacSecret("a"));
    expect(hmacSecret("a")).not.toBe(hmacSecret("b"));
    expect(hmacSecret("a")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("throws when the key is unset", () => {
    delete process.env.PAYROLL_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow("PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.");
  });
  it("throws MissingEncryptionKeyError when the key is unset", () => {
    delete process.env.PAYROLL_ENCRYPTION_KEY;
    expect(() => keyedHash("totp-recovery", "x")).toThrow(MissingEncryptionKeyError);
  });
  it("keyedHash uses a per-label subkey", () => {
    expect(keyedHash("totp-recovery", "a")).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedHash("totp-recovery", "a")).toBe(keyedHash("totp-recovery", "a"));
    expect(keyedHash("totp-recovery", "a")).not.toBe(hmacSecret("a"));
    expect(keyedHash("rrn-index", "a")).toBe(hmacSecret("a"));
  });
});
