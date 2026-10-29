import { fail, ok, type Result } from "@/server/result";

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

export function normalizeBusinessNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function isValidBusinessNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * WEIGHTS[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

export function formatBusinessNumber(digits: string): string {
  return /^\d{10}$/.test(digits)
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : digits;
}

export const ERR_BUSINESS_NUMBER = "사업자등록번호가 올바르지 않습니다.";

/** Optional business number: blank -> null; otherwise digits-only and checksum-valid. */
export function cleanBusinessNumber(raw: string | null | undefined): Result<string | null> {
  const text = raw?.trim();
  if (!text) return ok(null);
  if (/[^\d\s-]/.test(text)) return fail(ERR_BUSINESS_NUMBER);
  const digits = normalizeBusinessNumber(text);
  return isValidBusinessNumber(digits) ? ok(digits) : fail(ERR_BUSINESS_NUMBER);
}
