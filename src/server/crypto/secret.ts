import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/** The key is not configured; callers that can show a page message catch exactly this class. */
export class MissingEncryptionKeyError extends Error {
  constructor() {
    super("PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.");
    this.name = "MissingEncryptionKeyError";
  }
}

/** The key is set but unusable (not 32 bytes of base64). Subclass, so every missing-key guard catches it. */
export class InvalidEncryptionKeyError extends MissingEncryptionKeyError {
  constructor() {
    super();
    this.message = "PAYROLL_ENCRYPTION_KEY가 올바르지 않습니다. 32바이트 키를 base64로 설정하세요.";
    this.name = "InvalidEncryptionKeyError";
  }
}

/** Read on every call so a missing key fails only the caller, not unrelated pages. */
function masterKey(): Buffer {
  const raw = process.env.PAYROLL_ENCRYPTION_KEY;
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new InvalidEncryptionKeyError();
  return key;
}

/** Throws MissingEncryptionKeyError (or InvalidEncryptionKeyError) when the key is not usable. */
export function assertEncryptionKey(): void {
  masterKey();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("알 수 없는 암호문 형식입니다.");
  const ivBytes = Buffer.from(iv, "base64");
  const tagBytes = Buffer.from(tag, "base64");
  if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error("알 수 없는 암호문 형식입니다.");
  const d = createDecipheriv("aes-256-gcm", masterKey(), ivBytes, { authTagLength: 16 });
  d.setAuthTag(tagBytes);
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** Keyed HMAC-SHA256 (hex) with a subkey derived from the master key for this label only. */
export function keyedHash(label: string, plain: string): string {
  const sub = Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), label, 32));
  return createHmac("sha256", sub).update(plain).digest("hex");
}

/** Deterministic lookup index (e.g. duplicate 주민등록번호), keyed with a label-derived subkey. */
export function hmacSecret(plain: string): string {
  return keyedHash("rrn-index", plain);
}
