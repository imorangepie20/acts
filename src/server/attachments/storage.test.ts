import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, sniffType } from "./storage";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...Buffer.from(x, "latin1")] : [x])));

describe("sniffType", () => {
  it("detects JPEG", () => {
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
  });
  it("detects PNG", () => {
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
  });
  it("detects WEBP", () => {
    expect(sniffType(bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
  });
  it("detects PDF", () => {
    expect(sniffType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
  });
  it("rejects HTML", () => {
    expect(sniffType(bytes("<html><script>alert(1)</script></html>"))).toBeNull();
  });
  it("rejects a PE executable", () => {
    expect(sniffType(bytes("MZ", 0x90, 0, 3, 0))).toBeNull();
  });
  it("rejects RIFF that is not WEBP (e.g. WAV) and truncated headers", () => {
    expect(sniffType(bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt "))).toBeNull();
    expect(sniffType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
  it("caps attachments at 10MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});
