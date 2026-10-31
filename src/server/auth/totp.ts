// RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits). No path aliases or "server-only" here: the e2e
// login helper imports this file to compute codes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("base32 문자가 아닙니다.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForCounter(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, "0");
}

/** The 30-second step number at `at`. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

export function totpCode(secret: string, at: Date): string {
  return codeForCounter(base32Decode(secret), totpStep(at));
}

/**
 * The step whose code matches, checking the current step and one either side (clock drift),
 * or null. Callers use the step to refuse replays.
 */
export function matchTotpStep(secret: string, code: string, at: Date): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const key = base32Decode(secret);
  const c = totpStep(at);
  let match: number | null = null;
  for (const d of [-1, 0, 1]) {
    if (timingSafeEqual(Buffer.from(codeForCounter(key, c + d)), Buffer.from(typed))) match = c + d;
  }
  return match;
}

/** Accepts the current step and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string, at: Date): boolean {
  return matchTotpStep(secret, code, at) !== null;
}

export function otpauthUrl(secret: string, email: string): string {
  const label = `acts:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=acts&algorithm=SHA1&digits=6&period=30`;
}
