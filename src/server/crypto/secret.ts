import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/** Read on every call so a missing key fails only the caller, not unrelated pages. */
function masterKey(): Buffer {
  const raw = process.env.PAYROLL_ENCRYPTION_KEY;
  if (!raw) throw new Error("PAYROLL_ENCRYPTION_KEY가 설정되지 않았습니다.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PAYROLL_ENCRYPTION_KEY는 base64 32바이트여야 합니다.");
  return key;
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
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** Deterministic lookup index (e.g. duplicate 주민등록번호), keyed with a label-derived subkey. */
export function hmacSecret(plain: string): string {
  const sub = Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), "rrn-index", 32));
  return createHmac("sha256", sub).update(plain).digest("hex");
}
