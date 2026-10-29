/** True when a Postgres unique violation (23505) is the error or anywhere in its `.cause` chain (drizzle wraps driver errors). */
export function isUniqueViolation(e: unknown): boolean {
  for (let cur = e as { code?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.code === "23505") return true;
  }
  return false;
}
