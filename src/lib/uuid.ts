const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical 8-4-4-4-12 hex uuid (any case, no surrounding whitespace). */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
