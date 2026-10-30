import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { todayInSeoul } from "@/lib/vouchers/dates";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { periodCloses, users, vouchers } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import type { Conn, Tx } from "@/server/vouchers/snapshot";

/**
 * First key of the two-key advisory lock on a month (second key: `monthKey`). Voucher writes take
 * it shared, as the FIRST statement of their transaction, for every month they touch; close and
 * reopen take it exclusive. Distinct from the voucher numbering lock ("vouc").
 */
export const PERIOD_LOCK = 0x70_65_72_64; // "perd"
/**
 * Second key that serialises close/reopen among themselves (taken after the month lock), so a
 * close and a reopen of different months cannot both pass their ordering checks. Never a month
 * key: valid months start at year 0001.
 */
const ADMIN_KEY = -1;

const ERR_PERMISSION = "마감 권한이 없습니다.";
const ERR_INVALID = "입력값이 올바르지 않습니다.";
const ERR_NOT_ENDED = "아직 끝나지 않은 월은 마감할 수 없습니다.";
const ERR_ALREADY = "이미 마감된 월입니다.";
const errEarlier = (month: string) => `이전 월(${month})을 먼저 마감하세요.`;
const errPending = (n: number) => `승인 대기 전표가 ${n}건 있어 마감할 수 없습니다.`;
const ERR_NOT_LATEST = "가장 최근에 마감한 월부터 해제할 수 있습니다.";
const ERR_NOT_CLOSED = "마감되지 않은 월입니다.";
export const closedMonthMessage = (month: string) => `마감된 월(${month})의 전표는 추가·수정·삭제할 수 없습니다.`;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const isMonth = (s: unknown): s is string => typeof s === "string" && MONTH_RE.test(s) && s >= "0001-01";

/** `YYYY-MM` of a `YYYY-MM-DD` date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** `year * 12 + (month - 1)`: the advisory-lock key of a month, ascending with time. */
export function monthKey(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const fromKey = (key: number): string => `${pad(Math.floor(key / 12), 4)}-${pad((key % 12) + 1)}`;
const firstDay = (month: string) => `${month}-01`;
const nextMonthFirstDay = (month: string) => firstDay(fromKey(monthKey(month) + 1));

/**
 * Takes the shared month lock for every distinct month of `dates` (ascending key order, so writers
 * never deadlock each other) and returns the closed-month message for the earliest closed one, or
 * null. Must be the first statement of a voucher-writing transaction. Strings that are not dates
 * are ignored here (the caller's validation rejects them).
 */
export async function assertMonthsOpen(tx: Tx, dates: string[]): Promise<string | null> {
  const months = [...new Set(dates.map(monthOf))].filter(isMonth).sort((a, b) => monthKey(a) - monthKey(b));
  if (months.length === 0) return null;
  for (const m of months) {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${PERIOD_LOCK}::int, ${monthKey(m)}::int)`);
  }
  const rows = await tx
    .select({ month: periodCloses.month })
    .from(periodCloses)
    .where(inArray(periodCloses.month, months));
  const closed = new Set(rows.map((r) => r.month));
  const first = months.find((m) => closed.has(m));
  return first ? closedMonthMessage(first) : null;
}

/** Unlocked read, for UI hints and cheap pre-checks; writes are gated by `assertMonthsOpen`. */
export async function isMonthClosed(db: Conn, month: string): Promise<boolean> {
  if (!isMonth(month)) return false;
  const [row] = await db.select({ month: periodCloses.month }).from(periodCloses).where(eq(periodCloses.month, month));
  return row !== undefined;
}

export type MonthStatus = {
  month: string;
  closed: boolean;
  closedAt: Date | null;
  closedByName: string | null;
  voucherCount: number;
  pendingCount: number;
};

/** The 12 months of the fiscal year starting at `fiscalStart` (YYYY-MM-DD, day ignored). */
export async function listMonthStatus(db: Db, fiscalStart: string): Promise<MonthStatus[]> {
  const startKey = monthKey(monthOf(fiscalStart));
  const months = Array.from({ length: 12 }, (_, i) => fromKey(startKey + i));
  const from = firstDay(months[0]);
  const to = nextMonthFirstDay(months[11]);
  const monthExpr = sql<string>`to_char(${vouchers.date}, 'YYYY-MM')`;
  const [counts, closes] = await Promise.all([
    db
      .select({
        month: monthExpr,
        voucherCount: sql<number>`count(*)::int`,
        pendingCount: sql<number>`(count(*) filter (where ${vouchers.status} = 'pending'))::int`,
      })
      .from(vouchers)
      .where(and(gte(vouchers.date, from), lt(vouchers.date, to)))
      .groupBy(monthExpr),
    db
      .select({ month: periodCloses.month, closedAt: periodCloses.closedAt, closedByName: users.name })
      .from(periodCloses)
      .innerJoin(users, eq(users.id, periodCloses.closedBy))
      .where(inArray(periodCloses.month, months)),
  ]);
  const countBy = new Map(counts.map((c) => [c.month, c]));
  const closeBy = new Map(closes.map((c) => [c.month, c]));
  return months.map((month) => {
    const c = countBy.get(month);
    const p = closeBy.get(month);
    return {
      month,
      closed: p !== undefined,
      closedAt: p?.closedAt ?? null,
      closedByName: p?.closedByName ?? null,
      voucherCount: c?.voucherCount ?? 0,
      pendingCount: c?.pendingCount ?? 0,
    };
  });
}

/** Exclusive lock on the month (blocks and waits out every writer to it), then the close/reopen lock. */
async function lockMonthExclusive(tx: Tx, month: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PERIOD_LOCK}::int, ${monthKey(month)}::int)`);
  await tx.execute(sql`select pg_advisory_xact_lock(${PERIOD_LOCK}::int, ${ADMIN_KEY}::int)`);
}

export async function closeMonth(db: Db, actor: SessionUser, month: string): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!isMonth(month)) return fail(ERR_INVALID);
  if (month >= monthOf(todayInSeoul())) return fail(ERR_NOT_ENDED);
  return db.transaction(async (tx) => {
    await lockMonthExclusive(tx, month);
    // Every statement below runs after the lock, so (READ COMMITTED) it sees every writer that
    // committed before it, and no writer to this month can start until this commits.
    if (await isMonthClosed(tx, month)) return fail(ERR_ALREADY);

    const [earlier] = await tx
      .select({ date: sql<string | null>`min(${vouchers.date})` })
      .from(vouchers)
      .where(
        and(
          lt(vouchers.date, firstDay(month)),
          sql`not exists (select 1 from ${periodCloses}
            where ${periodCloses.month} = to_char(${vouchers.date}, 'YYYY-MM'))`,
        ),
      );
    if (earlier?.date) return fail(errEarlier(monthOf(earlier.date)));

    const [{ pending }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(vouchers)
      .where(
        and(
          eq(vouchers.status, "pending"),
          gte(vouchers.date, firstDay(month)),
          lt(vouchers.date, nextMonthFirstDay(month)),
        ),
      );
    if (pending > 0) return fail(errPending(pending));

    await tx.insert(periodCloses).values({ month, closedBy: actor.id });
    return ok();
  });
}

export async function reopenMonth(db: Db, actor: SessionUser, month: string): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!isMonth(month)) return fail(ERR_INVALID);
  return db.transaction(async (tx) => {
    await lockMonthExclusive(tx, month);
    if (!(await isMonthClosed(tx, month))) return fail(ERR_NOT_CLOSED);
    const [later] = await tx
      .select({ month: periodCloses.month })
      .from(periodCloses)
      .where(gt(periodCloses.month, month))
      .orderBy(asc(periodCloses.month))
      .limit(1);
    if (later) return fail(ERR_NOT_LATEST);
    await tx.delete(periodCloses).where(eq(periodCloses.month, month));
    return ok();
  });
}
