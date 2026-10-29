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
