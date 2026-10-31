export type RrnResult = { ok: true; digits: string } | { ok: false };

const WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];

/** Birth dates from 2020-10-01 get a random last digit, so the check digit no longer applies. */
const RANDOM_CHECK_FROM = "2020-10-01";

export function validateRrn(s: string): RrnResult {
  const m = /^(\d{6})-?(\d{7})$/.exec(s.trim());
  if (!m) return { ok: false };
  const digits = m[1] + m[2];
  const g = Number(digits[6]);
  if (g < 1 || g > 8) return { ok: false };
  const century = g <= 2 || g === 5 || g === 6 ? 1900 : 2000;
  const y = century + Number(digits.slice(0, 2));
  const mo = Number(digits.slice(2, 4));
  const d = Number(digits.slice(4, 6));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false };
  }
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (iso < RANDOM_CHECK_FROM) {
    const sum = WEIGHTS.reduce((a, w, i) => a + w * Number(digits[i]), 0);
    let check = (11 - (sum % 11)) % 10;
    if (g >= 5) check = (check + 2) % 10; // 외국인등록번호
    if (check !== Number(digits[12])) return { ok: false };
  }
  return { ok: true, digits };
}

export function maskRrn(digits: string): string {
  return `${digits.slice(0, 6)}-${digits[6]}******`;
}

export function maskAccount(s: string): string {
  return `***-****-${s.replace(/\D/g, "").slice(-4)}`;
}
