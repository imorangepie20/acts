import { describe, expect, it } from "vitest";
import { base32Encode, generateTotpSecret, otpauthUrl, totpCode, verifyTotp } from "./totp";

// RFC 6238 Appendix B: SHA-1 seed "12345678901234567890" (ASCII).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("totpCode", () => {
  it("matches the RFC 6238 SHA-1 vectors (last 6 digits)", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(RFC_SECRET, new Date(59_000))).toBe("287082");
    expect(totpCode(RFC_SECRET, new Date(1111111109_000))).toBe("081804");
  });
});

describe("verifyTotp", () => {
  const at = new Date(1111111109_000);
  it("accepts the current, previous and next step", () => {
    expect(verifyTotp(RFC_SECRET, "081804", at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, new Date(at.getTime() - 30_000)), at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, new Date(at.getTime() + 30_000)), at)).toBe(true);
  });

  it("rejects two steps back and malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, new Date(at.getTime() - 60_000)), at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "08180", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", at)).toBe(false);
  });

  it("ignores spaces in the typed code", () => {
    expect(verifyTotp(RFC_SECRET, " 081 804 ", at)).toBe(true);
  });
});

describe("generateTotpSecret / otpauthUrl", () => {
  it("generates a 20-byte base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it("builds an otpauth URL with issuer acts", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "kim@acts.kr");
    expect(url).toBe(
      "otpauth://totp/acts:kim%40acts.kr?secret=JBSWY3DPEHPK3PXP&issuer=acts&algorithm=SHA1&digits=6&period=30",
    );
  });
});
