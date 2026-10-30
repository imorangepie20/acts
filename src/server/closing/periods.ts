import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { todayInSeoul } from "@/lib/vouchers/dates";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { periodCloses, users, vouchers } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import type { Conn, Tx } from "@/server/vouchers/snapshot";

/**
 * First key of the global period advisory lock `(PERIOD_LOCK, 0)`. Voucher writes take it shared,
 * as the FIRST statement of their transaction; close and reopen take it exclusive. One key, not one
 * per month: a close moves the watermark for every earlier month too (see `assertMonthsOpen`).
 * Distinct from the voucher numbering lock ("vouc").
 */
export const PERIOD_LOCK = 0x70_65_72_64; // "perd"
const PERIOD_KEY = 0;

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

/** `year * 12 + (month - 1)`: month arithmetic, ascending with time. */
export function monthKey(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const fromKey = (key: number): string => `${pad(Math.floor(key / 12), 4)}-${pad((key % 12) + 1)}`;
const firstDay = (month: string) => `${month}-01`;
const nextMonthFirstDay = (month: string) => firstDay(fromKey(monthKey(month) + 1));

/** Latest explicitly closed month, or null. Every month up to and including it counts as closed. */
async function watermark(conn: Conn): Promise<string | null> {
  const [row] = await conn.select({ month: sql<string | null>`max(${periodCloses.month})` }).from(periodCloses);
  return row?.month ?? null;
}

/**
 * Month close is a watermark: a month is closed when any `period_closes` row is at or after it
 * ("closed through M"), so a write into an earlier empty month cannot move figures as of M.
 *
 * Takes the shared period lock (must be the first statement of a voucher-writing transaction) and
 * returns the closed-month message for the earliest month of `dates` that is closed, or null.
 * Strings that are not dates are ignored here (the caller's validation rejects them).
 */
export async function assertMonthsOpen(tx: Tx, dates: string[]): Promise<string | null> {
  const months = [...new Set(dates.map(monthOf))].filter(isMonth).sort();
  if (months.length === 0) return null;
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${PERIOD_LOCK}::int, ${PERIOD_KEY}::int)`);
  const through = await watermark(tx);
  const first = through === null ? undefined : months.find((m) => m <= through);
  return first ? closedMonthMessage(first) : null;
}

/** Unlocked read (watermark), for UI hints and cheap pre-checks; writes are gated by `assertMonthsOpen`. */
export async function isMonthClosed(db: Conn, month: string): Promise<boolean> {
  if (!isMonth(month)) return false;
  const through = await watermark(db);
  return through !== null && month <= through;
}

export type MonthStatus = {
  month: string;
  /** At or before the latest explicit close (the watermark). */
  closed: boolean;
  /** The latest explicit close: the only month that can be reopened. */
  reopenable: boolean;
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
  const [counts, closes, through] = await Promise.all([
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
    watermark(db),
  ]);
  const countBy = new Map(counts.map((c) => [c.month, c]));
  const closeBy = new Map(closes.map((c) => [c.month, c]));
  return months.map((month) => {
    const c = countBy.get(month);
    const p = closeBy.get(month);
    return {
      month,
      closed: through !== null && month <= through,
      reopenable: month === through,
      closedAt: p?.closedAt ?? null,
      closedByName: p?.closedByName ?? null,
      voucherCount: c?.voucherCount ?? 0,
      pendingCount: c?.pendingCount ?? 0,
    };
  });
}

/**
 * Exclusive period lock: waits out every in-flight voucher write and blocks new ones until commit.
 * Taken by close, reopen and saveOpening (which moves the cut-off every voucher write checks).
 */
export async function lockPeriodsExclusive(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PERIOD_LOCK}::int, ${PERIOD_KEY}::int)`);
}

export async function closeMonth(db: Db, actor: SessionUser, month: string): Promise<Result> {
  if (!can(actor.role, "period:close")) return fail(ERR_PERMISSION);
  if (!isMonth(month)) return fail(ERR_INVALID);
  if (month >= monthOf(todayInSeoul())) return fail(ERR_NOT_ENDED);
  return db.transaction(async (tx) => {
    await lockPeriodsExclusive(tx);
    // Every statement below runs after the lock, so (READ COMMITTED) it sees every writer that
    // committed before it, and no voucher write can start until this commits.
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
    await lockPeriodsExclusive(tx);
    const through = await watermark(tx);
    if (through === null || month > through) return fail(ERR_NOT_CLOSED);
    if (month < through) return fail(ERR_NOT_LATEST);
    await tx.delete(periodCloses).where(eq(periodCloses.month, month));
    return ok();
  });
}
