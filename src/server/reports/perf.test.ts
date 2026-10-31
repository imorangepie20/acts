import { appendFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createSession } from "@/server/auth/service";
import { accounts, partners, sites, users } from "@/server/db/schema";
import { getTestDb, resetDb, seedReference } from "../../../tests/helpers/db";
import { getAccountLedger, getJournal } from "./ledgers";
import { getBalanceSheet, getIncomeStatement, getTrialBalance } from "./service";

/**
 * Spec §7 performance check: 200,000 posted vouchers / 500,000 lines in one fiscal year.
 * Opt-in only: `PERF=1 pnpm test src/server/reports/perf.test.ts`. Leaves acts_test empty.
 * `PERF_KEEP=1` keeps the data and logs a session token instead, for timing the ledger page
 * against a production server started with DATABASE_URL=$DATABASE_URL_TEST (reset acts_test afterwards).
 */
const db = getTestDb();
const VOUCHERS = 200_000;
const F = { from: "2026-01-01", to: "2026-12-31", siteId: null, departmentId: null, hidePayroll: false };

/** Prints a result line; also appends it to $PERF_LOG when set (vitest may swallow console output). */
function log(line: string): void {
  console.log(line);
  if (process.env.PERF_LOG) appendFileSync(process.env.PERF_LOG, `${line}
`);
}

async function median(label: string, fn: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  log(`[perf] ${label}: median ${times[1].toFixed(0)} ms (runs ${times.map((t) => t.toFixed(0)).join(", ")})`);
  return times[1];
}

async function seed(): Promise<number> {
  await resetDb(db);
  await seedReference(db);
  const [u] = await db
    .insert(users)
    .values({ email: "perf@test.kr", name: "perf", role: "admin", passwordHash: "x" })
    .returning({ id: users.id });
  await db.insert(sites).values({ name: "제2현장" });
  const siteIds = (await db.select({ id: sites.id }).from(sites)).map((s) => s.id);
  const partnerIds = (
    await db
      .insert(partners)
      .values(Array.from({ length: 50 }, (_, i) => ({ name: `거래처${String(i + 1).padStart(2, "0")}` })))
      .returning({ id: partners.id })
  ).map((p) => p.id);
  const all = await db.select({ id: accounts.id, code: accounts.code }).from(accounts);
  const byCode = new Map(all.map((a) => [a.code, a.id]));
  const cash = byCode.get("103")!;
  const withPartner = [byCode.get("108")!, byCode.get("251")!];
  // 29 counter accounts (30 with 103): 108, 251 and 27 others picked deterministically from the chart.
  const rest = all
    .filter((a) => !["103", "108", "251"].includes(a.code))
    .sort((a, b) => ((Number(a.code) * 7919) % 101) - ((Number(b.code) * 7919) % 101) || a.code.localeCompare(b.code))
    .slice(0, 27)
    .map((a) => a.id);
  const others = [...withPartner, ...rest];
  const arr = (xs: number[]) => sql.raw(`array[${xs.join(",")}]::int[]`);

  // Voucher i: date = Jan 1 + (i % 365), no = i / 365 + 1 (unique per date).
  await db.execute(sql`
    insert into vouchers (date, no, entry_type, description, status, created_by, updated_by, approved_by, approved_at)
    select date '2026-01-01' + (i % 365), i / 365 + 1, 'general', 'perf ' || i, 'approved', ${u.id}, ${u.id}, ${u.id}, now()
    from generate_series(0, ${VOUCHERS - 1}) i`);
  // Even i: 2 lines (103 vs. a counter account). Odd i: 3 lines (103 twice vs. one counter account).
  // => 500,000 lines, 300,000 (60%) on 103. Lines alternate between the two sites.
  await db.execute(sql`
    insert into voucher_lines (voucher_id, line_no, account_id, side, amount, partner_id, site_id, description)
    select v.id, l.line_no, l.account_id, l.side::line_side, l.amount,
           case when l.account_id = any(${arr(withPartner)}) then (${arr(partnerIds)})[1 + x.i % 50] end,
           (${arr(siteIds)})[1 + x.i % 2], ''
    from vouchers v
    cross join lateral (select ((v.no - 1) * 365 + (v.date - date '2026-01-01')) as i) x
    cross join lateral (select ((x.i % 997) + 1) * 1000 as a, (${arr(others)})[1 + x.i % 29] as other) p
    cross join lateral (values
      (1, ${cash}, case when x.i % 4 = 0 or x.i % 2 = 1 then 'debit' else 'credit' end, p.a),
      (2, p.other, case when x.i % 4 = 0 then 'credit' when x.i % 2 = 0 then 'debit' else 'credit' end,
          case when x.i % 2 = 1 then p.a * 3 else p.a end),
      (3, ${cash}, 'debit', p.a * 2)
    ) l(line_no, account_id, side, amount)
    where l.line_no < 3 or x.i % 2 = 1`);
  await db.execute(sql`analyze vouchers`);
  await db.execute(sql`analyze voucher_lines`);
  return cash;
}

describe.skipIf(!process.env.PERF)("report performance at 500k lines (spec §7)", () => {
  afterAll(async () => {
    if (!process.env.PERF_KEEP) await resetDb(db);
  }, 120_000);

  it("times each report call (median of 3)", async () => {
    const t0 = performance.now();
    const cash = await seed();
    log(`[perf] seed: ${(performance.now() - t0).toFixed(0)} ms`);

    const [counts] = await db.execute<{ vouchers: number; lines: number; cash: number; unbalanced: number }>(sql`
      select (select count(*) from vouchers)::int as vouchers,
             (select count(*) from voucher_lines)::int as lines,
             (select count(*) from voucher_lines where account_id = ${cash})::int as cash,
             (select count(*) from (
                select voucher_id from voucher_lines group by voucher_id
                having sum(case when side = 'debit' then amount else -amount end) <> 0) u)::int as unbalanced`);
    expect(counts).toEqual({ vouchers: 200_000, lines: 500_000, cash: 300_000, unbalanced: 0 });

    const plan = await db.execute<{ "QUERY PLAN": string }>(sql`
      explain (analyze, buffers)
      select vl.account_id,
             coalesce(sum(case when vl.side = 'debit' then vl.amount else 0 end), 0)::bigint,
             coalesce(sum(case when vl.side = 'credit' then vl.amount else 0 end), 0)::bigint
      from voucher_lines vl inner join vouchers v on v.id = vl.voucher_id
      where v.status in ('approved') and v.date <= '2026-12-31'
      group by vl.account_id order by vl.account_id`);
    log(`[perf] EXPLAIN accountTotals(from=null, to=2026-12-31):\n${plan.map((r) => r["QUERY PLAN"]).join("\n")}`);

    const results = {
      trialBalance: await median("getTrialBalance", () => getTrialBalance(db, F)),
      balanceSheet: await median("getBalanceSheet", () => getBalanceSheet(db, F)),
      incomeStatement: await median("getIncomeStatement", () => getIncomeStatement(db, F)),
      journalPage1: await median("getJournal page 1", () => getJournal(db, F, 1)),
      ledger103: await median("getAccountLedger 103 full year", () => getAccountLedger(db, cash, F)),
      ledger103Page1: await median("getAccountLedger 103 page 1", () => getAccountLedger(db, cash, F, { page: 1 })),
      ledger103LastPage: await median("getAccountLedger 103 page 300 (last)", () =>
        getAccountLedger(db, cash, F, { page: 300 }),
      ),
    };
    const ledger = await getAccountLedger(db, cash, F);
    log(`[perf] ledger 103 rows: ${ledger?.rows.length}`);
    log(`[perf] results ${JSON.stringify(results)}`);
    if (process.env.PERF_KEEP) {
      const [admin] = await db.select({ id: users.id }).from(users);
      log(`[perf] kept data; acts_session=${(await createSession(db, admin.id)).token} account=${cash}`);
    }
  }, 900_000);
});
