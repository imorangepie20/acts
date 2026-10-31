import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bonusIncomeTax, bonusPeriod } from "@/lib/payroll/bonus";
import { computeLine, splitTaxable } from "@/lib/payroll/calc";
import { maskAccount, maskRrn } from "@/lib/payroll/rrn";
import { SETTING_CODE_FIELDS, SETTING_LABELS, type SettingCodeField } from "@/lib/payroll/settings";
import type {
  BonusBasis,
  DeductionKey,
  ItemDef,
  LineResult,
  Rates,
  RunLineSnapshot,
  WithholdingTable,
} from "@/lib/payroll/types";
import { buildPayrollVoucher, payrollDescription } from "@/lib/payroll/voucher";
import { MAX_WON } from "@/lib/money";
import { isUuid } from "@/lib/uuid";
import type { VoucherStatus } from "@/lib/vouchers/types";
import type { SessionUser } from "@/server/auth/service";
import { assertMonthsOpen } from "@/server/closing/periods";
import { decryptSecret } from "@/server/crypto/secret";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  accounts,
  departments,
  employees,
  payrollItems,
  payrollRunLines,
  payrollRuns,
  payrollSettings,
  sites,
  users,
  vouchers,
} from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import {
  deletePayrollVoucher,
  ERR_CONFLICT,
  isVoucherDate,
  loadVat,
  writePayrollVoucher,
} from "@/server/vouchers/service";
import type { Conn, Tx } from "@/server/vouchers/snapshot";
import { canManagePayroll, ERR_FORBIDDEN, listItems, type PayItemRow } from "./items";
import { loadRates, loadWithholdingTable } from "./rates";

export type RunType = "regular" | "bonus";
export type RunStatus = "draft" | "confirmed";

export type RunInput = {
  type: RunType;
  /** 귀속 연월, YYYY-MM. */
  yearMonth: string;
  /** 지급일, YYYY-MM-DD: the voucher date and the 간이세액표 date. */
  payDate: string;
  /** 상여 지급대상기간 (YYYY-MM), both or neither; ignored for 정기 runs. */
  bonusFrom?: string | null;
  bonusTo?: string | null;
};

export type RunLineChange = {
  employeeId: number;
  /** Merged into the line's amounts. */
  amounts?: Record<string, number>;
  /** A number sets the override, `null` clears it. */
  overrides?: Partial<Record<DeductionKey, number | null>>;
};

export type RunLineView = {
  employeeId: number;
  amounts: Record<string, number>;
  overrides: Partial<Record<DeductionKey, number>>;
  result: LineResult;
  snapshot: RunLineSnapshot;
};

export type RunDetail = {
  id: string;
  type: RunType;
  yearMonth: string;
  payDate: string;
  bonusFrom: string | null;
  bonusTo: string | null;
  status: RunStatus;
  version: number;
  voucherId: string | null;
  voucherNo: number | null;
  /** For the banner: a `rejected` voucher shows its reason. */
  voucherStatus: VoucherStatus | null;
  voucherRejectReason: string | null;
  createdByName: string;
  confirmedByName: string | null;
  confirmedAt: Date | null;
  /** Active items, plus inactive ones a line still has an amount for. */
  items: PayItemRow[];
  /** Ordered by 사번. */
  lines: RunLineView[];
};

export type RunRow = {
  id: string;
  type: RunType;
  yearMonth: string;
  payDate: string;
  status: RunStatus;
  employeeCount: number;
  gross: number;
  netPay: number;
  voucherStatus: VoucherStatus | null;
};

const ERR_NOT_FOUND = "급여 대장을 찾을 수 없습니다.";
const ERR_TYPE = "대장 종류가 올바르지 않습니다.";
const ERR_MONTH = "귀속 연월을 YYYY-MM으로 입력하세요.";
const ERR_PAY_DATE = "지급일이 올바르지 않습니다.";
const ERR_BONUS_PERIOD = "지급대상기간은 시작 월과 끝 월을 함께 YYYY-MM으로 입력하고, 시작이 끝보다 늦지 않아야 합니다.";
const ERR_NOT_DRAFT = "확정된 급여 대장은 고칠 수 없습니다. 먼저 확정을 취소하세요.";
const ERR_NOT_CONFIRMED = "확정된 급여 대장이 아닙니다.";
const ERR_EMPTY = "급여 대장에 사원이 없습니다.";
const ERR_AMOUNT = "금액은 0 이상의 원 단위 정수로 입력하세요.";
const ERR_ITEM = "없는 급여 항목이 있습니다.";
const ERR_OVERRIDE = "공제 항목이 올바르지 않습니다.";
const ERR_LINE = "급여 대장에 없는 사원입니다.";
const ERR_EMPLOYEE = "사원을 찾을 수 없습니다.";
const ERR_ALREADY_IN = "이미 급여 대장에 있는 사원입니다.";
const ERR_SETTINGS = "급여 설정이 없습니다. 급여 설정을 저장하세요.";
const errDuplicate = (yearMonth: string) => {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${y}년 ${m}월 정기 급여 대장이 이미 있습니다.`;
};
const errAccount = (label: string) => `급여 설정의 ${label} 계정을 사용할 수 없습니다. 급여 설정에서 계정을 다시 고르세요.`;
const errPartner = (code: string, name: string) =>
  `${code} ${name} 계정은 거래처가 필요합니다. 급여 설정에서 기관 거래처를 지정하세요.`;
const errNegativeNet = (name: string) => `${name}의 실지급액이 0원보다 적습니다. 공제액을 확인하세요.`;

const DEDUCTION_KEYS: readonly DeductionKey[] = ["pension", "health", "ltc", "employment", "incomeTax", "localTax"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
const isAmount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_WON;

type RunHead = {
  id: string;
  type: RunType;
  yearMonth: string;
  payDate: string;
  bonusFrom: string | null;
  bonusTo: string | null;
};
type StoredRun = typeof payrollRuns.$inferSelect;

/** Items (all, active or not: a stored amount always counts), the 귀속월 rates and the 지급일 table. */
type Ctx = { items: (ItemDef & { isActive: boolean; debitAccountCode: string | null })[]; rates: Rates; table: WithholdingTable };

async function loadCtx(conn: Conn, run: Pick<RunHead, "yearMonth" | "payDate">): Promise<Result<Ctx>> {
  let rates: Rates;
  let table: WithholdingTable;
  try {
    rates = await loadRates(conn, `${run.yearMonth}-01`);
    table = await loadWithholdingTable(conn, run.payDate);
  } catch (e) {
    // "<date> 기준 … 요율이 없습니다." — no secrets in these messages.
    return fail(e instanceof Error ? e.message : String(e));
  }
  const items = await conn
    .select({
      code: payrollItems.code,
      name: payrollItems.name,
      taxable: payrollItems.taxable,
      nontaxLimit: payrollItems.nontaxLimit,
      inEmploymentBase: payrollItems.inEmploymentBase,
      isActive: payrollItems.isActive,
      debitAccountCode: payrollItems.debitAccountCode,
    })
    .from(payrollItems)
    .orderBy(asc(payrollItems.sort), asc(payrollItems.code));
  return ok({ items, rates, table });
}

type Facts = Omit<RunLineSnapshot, "rates" | "calculated" | "bonus">;

/** Current employee facts, masked; the plain 주민등록번호 is decrypted only to mask it. */
async function loadFacts(conn: Conn, ids: number[]): Promise<Map<number, Facts>> {
  if (ids.length === 0) return new Map();
  const rows = await conn
    .select({ e: employees, siteName: sites.name, departmentName: departments.name })
    .from(employees)
    .innerJoin(sites, eq(sites.id, employees.siteId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(inArray(employees.id, ids));
  return new Map(
    rows.map(({ e, siteName, departmentName }) => [
      e.id,
      {
        employeeNo: e.employeeNo,
        name: e.name,
        rrnMasked: maskRrn(decryptSecret(e.rrnEnc)),
        hiredOn: e.hiredOn,
        leftOn: e.leftOn,
        isExecutive: e.isExecutive,
        siteId: e.siteId,
        siteName,
        departmentId: e.departmentId,
        departmentName,
        bank: e.bank,
        accountMasked: e.accountLast4 ? maskAccount(e.accountLast4) : null,
        calc: {
          dependents: e.dependents,
          children: e.children,
          withholdingRate: e.withholdingRate as 80 | 100 | 120,
          insPension: e.insPension,
          insHealth: e.insHealth,
          insEmployment: e.insEmployment,
          pensionBase: e.pensionBase,
          healthBase: e.healthBase,
        },
      },
    ]),
  );
}

const factsOf = ({ rates: _r, calculated: _c, bonus: _b, ...facts }: RunLineSnapshot): Facts => {
  void _r;
  void _c;
  void _b;
  return facts;
};

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const ymOf = (i: number) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;

/**
 * The 지급대상기간 basis per employee for a bonus run (소득세법 제136조, 시행령 제194조).
 * - With a period on the run: that period.
 * - Without: from the month after an earlier 상여 paid to the employee in the same year (the latest
 *   confirmed one before this pay date), else from January; through the pay month.
 * Then the employee's confirmed 정기 runs whose 귀속월 is in the period give the 과세 급여 and the
 * 소득세 already withheld.
 */
async function bonusBases(conn: Conn, run: RunHead, ids: number[]): Promise<Map<number, BonusBasis>> {
  const out = new Map<number, BonusBasis>();
  if (run.type !== "bonus" || ids.length === 0) return out;
  const periods = new Map<number, { from: string; to: string; months: number }>();
  if (run.bonusFrom !== null && run.bonusTo !== null) {
    const p = bonusPeriod(run.payDate, run.bonusFrom, run.bonusTo);
    for (const id of ids) periods.set(id, p);
  } else {
    const payMonth = run.payDate.slice(0, 7);
    const earlier = await conn
      .select({ employeeId: payrollRunLines.employeeId, payDate: payrollRuns.payDate, result: payrollRunLines.result })
      .from(payrollRunLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
      .where(
        and(
          eq(payrollRuns.type, "bonus"),
          eq(payrollRuns.status, "confirmed"),
          ne(payrollRuns.id, run.id),
          gte(payrollRuns.payDate, `${run.payDate.slice(0, 4)}-01-01`),
          lt(payrollRuns.payDate, run.payDate),
          inArray(payrollRunLines.employeeId, ids),
        ),
      );
    const lastPaid = new Map<number, string>();
    for (const r of earlier) {
      if ((r.result.gross ?? 0) <= 0) continue; // a zero line paid no 상여
      const prev = lastPaid.get(r.employeeId);
      if (prev === undefined || r.payDate > prev) lastPaid.set(r.employeeId, r.payDate);
    }
    for (const id of ids) {
      const prev = lastPaid.get(id);
      if (prev === undefined) {
        periods.set(id, bonusPeriod(run.payDate, null, null));
      } else {
        // An earlier 상여 in the pay month itself leaves a one-month period (the pay month).
        const from = ymOf(Math.min(monthIndex(prev) + 1, monthIndex(payMonth)));
        periods.set(id, bonusPeriod(run.payDate, from, payMonth));
      }
    }
  }
  const all = [...periods.values()];
  const minFrom = all.reduce((m, p) => (p.from < m ? p.from : m), all[0].from);
  const maxTo = all.reduce((m, p) => (p.to > m ? p.to : m), all[0].to);
  const regular = await conn
    .select({ employeeId: payrollRunLines.employeeId, yearMonth: payrollRuns.yearMonth, result: payrollRunLines.result })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .where(
      and(
        eq(payrollRuns.type, "regular"),
        eq(payrollRuns.status, "confirmed"),
        gte(payrollRuns.yearMonth, minFrom),
        lte(payrollRuns.yearMonth, maxTo),
        inArray(payrollRunLines.employeeId, ids),
      ),
    );
  for (const id of ids) {
    const p = periods.get(id)!;
    let regularTaxable = 0;
    let withheld = 0;
    for (const r of regular) {
      if (r.employeeId !== id || r.yearMonth < p.from || r.yearMonth > p.to) continue;
      regularTaxable += r.result.taxable;
      withheld += r.result.deductions.incomeTax;
    }
    out.set(id, { ...p, regularTaxable, withheld });
  }
  return out;
}

type LineInput = {
  employeeId: number;
  amounts: Record<string, number>;
  overrides: Partial<Record<DeductionKey, number>>;
  facts: Facts;
  rates: Rates;
};
type Computed = LineInput & { result: LineResult; snapshot: RunLineSnapshot };

async function computeLines(conn: Conn, run: RunHead, ctx: Ctx, lines: LineInput[]): Promise<Computed[]> {
  const bases = await bonusBases(
    conn,
    run,
    lines.map((l) => l.employeeId),
  );
  return lines.map((l) => {
    const bonus = run.type === "bonus" ? bases.get(l.employeeId)! : null;
    let bonusTax: number | undefined;
    if (bonus) {
      const taxable = splitTaxable(ctx.items, l.amounts).taxable;
      bonusTax =
        taxable === 0
          ? 0
          : bonusIncomeTax({
              table: ctx.table,
              bonusTaxable: taxable,
              periodRegularTaxable: bonus.regularTaxable,
              periodWithheld: bonus.withheld,
              months: bonus.months,
              dependents: l.facts.calc.dependents,
              children: l.facts.calc.children,
              withholdingRate: l.facts.calc.withholdingRate,
            });
    }
    const base = {
      items: ctx.items,
      amounts: l.amounts,
      employee: l.facts.calc,
      rates: l.rates,
      table: ctx.table,
      type: run.type,
      bonusTax,
    };
    const calculated = computeLine(base).deductions;
    const result = computeLine({ ...base, overrides: l.overrides });
    return { ...l, result, snapshot: { ...l.facts, rates: l.rates, calculated, bonus } };
  });
}

/** Lines from fresh employee rows and the run's current rates. */
async function freshLines(
  conn: Conn,
  ctx: Ctx,
  inputs: { employeeId: number; amounts: Record<string, number>; overrides: Partial<Record<DeductionKey, number>> }[],
): Promise<Result<LineInput[]>> {
  const facts = await loadFacts(
    conn,
    inputs.map((i) => i.employeeId),
  );
  const out: LineInput[] = [];
  for (const i of inputs) {
    const f = facts.get(i.employeeId);
    if (!f) return fail(ERR_EMPLOYEE);
    out.push({ ...i, facts: f, rates: ctx.rates });
  }
  return ok(out);
}

/**
 * Prefill amounts: the employee's latest confirmed run of the same type, else the employee's
 * default amounts; 상여 runs start at 0. Only active items with a positive amount are copied.
 */
async function prefillAmounts(conn: Conn, type: RunType, ids: number[], ctx: Ctx): Promise<Map<number, Record<string, number>>> {
  const out = new Map<number, Record<string, number>>(ids.map((id) => [id, {}]));
  if (type === "bonus" || ids.length === 0) return out;
  const active = new Set(ctx.items.filter((i) => i.isActive).map((i) => i.code));
  const keep = (a: Record<string, number>) =>
    Object.fromEntries(Object.entries(a).filter(([code, v]) => active.has(code) && isAmount(v) && v > 0));
  const defaults = await conn
    .select({ id: employees.id, amounts: employees.defaultAmounts })
    .from(employees)
    .where(inArray(employees.id, ids));
  for (const d of defaults) out.set(d.id, keep(d.amounts));
  const latest = await conn
    .selectDistinctOn([payrollRunLines.employeeId], {
      employeeId: payrollRunLines.employeeId,
      amounts: payrollRunLines.amounts,
    })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .where(
      and(
        eq(payrollRuns.type, type),
        eq(payrollRuns.status, "confirmed"),
        inArray(payrollRunLines.employeeId, ids),
      ),
    )
    .orderBy(payrollRunLines.employeeId, desc(payrollRuns.yearMonth), desc(payrollRuns.payDate));
  for (const l of latest) out.set(l.employeeId, keep(l.amounts));
  return out;
}

const lineValues = (c: Computed) => ({
  amounts: c.amounts,
  overrides: c.overrides,
  result: c.result,
  snapshot: c.snapshot,
});

async function saveLines(tx: Tx, runId: string, lines: Computed[]): Promise<void> {
  for (const c of lines) {
    await tx
      .update(payrollRunLines)
      .set(lineValues(c))
      .where(and(eq(payrollRunLines.runId, runId), eq(payrollRunLines.employeeId, c.employeeId)));
  }
}

/** Locks the run row (FOR UPDATE) and checks the version. */
async function lockRun(tx: Tx, runId: string, version: number): Promise<Result<StoredRun>> {
  if (!isUuid(runId)) return fail(ERR_NOT_FOUND);
  const [r] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
  if (!r) return fail(ERR_NOT_FOUND);
  if (r.version !== version) return fail(ERR_CONFLICT);
  return ok(r);
}

async function lockDraft(tx: Tx, runId: string, version: number): Promise<Result<StoredRun>> {
  const r = await lockRun(tx, runId, version);
  if (!r.ok) return r;
  return r.value.status === "draft" ? r : fail(ERR_NOT_DRAFT);
}

async function bump(tx: Tx, runId: string): Promise<void> {
  await tx
    .update(payrollRuns)
    .set({ version: sql`${payrollRuns.version} + 1`, updatedAt: sql`now()` })
    .where(eq(payrollRuns.id, runId));
}

async function storedLines(conn: Conn, runId: string) {
  return conn.select().from(payrollRunLines).where(eq(payrollRunLines.runId, runId));
}

const fromStored = (l: typeof payrollRunLines.$inferSelect): LineInput => ({
  employeeId: l.employeeId,
  amounts: l.amounts,
  overrides: l.overrides,
  facts: factsOf(l.snapshot),
  rates: l.snapshot.rates,
});

function cleanHead(input: RunInput): Result<Omit<RunHead, "id">> {
  if (input.type !== "regular" && input.type !== "bonus") return fail(ERR_TYPE);
  if (typeof input.yearMonth !== "string" || !MONTH_RE.test(input.yearMonth)) return fail(ERR_MONTH);
  if (typeof input.payDate !== "string" || !isVoucherDate(input.payDate)) return fail(ERR_PAY_DATE);
  let bonusFrom: string | null = null;
  let bonusTo: string | null = null;
  if (input.type === "bonus") {
    bonusFrom = input.bonusFrom || null;
    bonusTo = input.bonusTo || null;
    if ((bonusFrom === null) !== (bonusTo === null)) return fail(ERR_BONUS_PERIOD);
    if (bonusFrom !== null && bonusTo !== null) {
      if (!MONTH_RE.test(bonusFrom) || !MONTH_RE.test(bonusTo) || bonusFrom > bonusTo) return fail(ERR_BONUS_PERIOD);
    }
  }
  return ok({ type: input.type, yearMonth: input.yearMonth, payDate: input.payDate, bonusFrom, bonusTo });
}

/**
 * Creates a draft run with one line per employee employed on any day of the 귀속월
 * (`hired_on <= last day` and `left_on` null or `>= first day`), prefilled and computed.
 */
export async function createRun(db: Db, actor: SessionUser, input: RunInput): Promise<Result<{ id: string }>> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  const h = cleanHead(input);
  if (!h.ok) return h;
  const head = h.value;
  const ctx = await loadCtx(db, head);
  if (!ctx.ok) return ctx;

  const employed = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        lte(employees.hiredOn, lastDayOf(head.yearMonth)),
        or(isNull(employees.leftOn), gte(employees.leftOn, `${head.yearMonth}-01`)),
      ),
    );
  const ids = employed.map((e) => e.id);
  const amounts = await prefillAmounts(db, head.type, ids, ctx.value);
  const inputs = await freshLines(
    db,
    ctx.value,
    ids.map((employeeId) => ({ employeeId, amounts: amounts.get(employeeId)!, overrides: {} })),
  );
  if (!inputs.ok) return inputs;

  try {
    return await db.transaction(async (tx) => {
      const [{ id }] = await tx
        .insert(payrollRuns)
        .values({ ...head, createdBy: actor.id })
        .returning({ id: payrollRuns.id });
      const computed = await computeLines(tx, { id, ...head }, ctx.value, inputs.value);
      if (computed.length) {
        await tx
          .insert(payrollRunLines)
          .values(computed.map((c) => ({ runId: id, employeeId: c.employeeId, ...lineValues(c) })));
      }
      return ok({ id });
    });
  } catch (e) {
    if (head.type === "regular" && isUniqueViolation(e)) return fail(errDuplicate(head.yearMonth));
    throw e;
  }
}

function cleanChanges(changes: RunLineChange[], itemCodes: Set<string>): Result<Map<number, RunLineChange>> {
  if (!Array.isArray(changes)) return fail(ERR_LINE);
  const merged = new Map<number, RunLineChange>();
  for (const c of changes) {
    if (!c || !Number.isSafeInteger(c.employeeId)) return fail(ERR_LINE);
    for (const [code, v] of Object.entries(c.amounts ?? {})) {
      if (!itemCodes.has(code)) return fail(ERR_ITEM);
      if (!isAmount(v)) return fail(ERR_AMOUNT);
    }
    for (const [key, v] of Object.entries(c.overrides ?? {})) {
      if (!DEDUCTION_KEYS.includes(key as DeductionKey)) return fail(ERR_OVERRIDE);
      if (v !== null && !isAmount(v)) return fail(ERR_AMOUNT);
    }
    const prev = merged.get(c.employeeId);
    merged.set(c.employeeId, {
      employeeId: c.employeeId,
      amounts: { ...prev?.amounts, ...c.amounts },
      overrides: { ...prev?.overrides, ...c.overrides },
    });
  }
  return ok(merged);
}

/**
 * Edits draft lines: amounts merge in, an override number sets it and `null` clears it. Changed
 * lines are recomputed from their snapshot (employee facts and rates as last loaded).
 */
export async function updateRunLines(
  db: Db,
  actor: SessionUser,
  runId: string,
  version: number,
  changes: RunLineChange[],
): Promise<Result<{ version: number }>> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    const run = locked.value;
    const ctx = await loadCtx(tx, run);
    if (!ctx.ok) return ctx;
    const cleaned = cleanChanges(changes, new Set(ctx.value.items.map((i) => i.code)));
    if (!cleaned.ok) return cleaned;
    const ids = [...cleaned.value.keys()];
    if (ids.length === 0) return ok({ version });
    const stored = await tx
      .select()
      .from(payrollRunLines)
      .where(and(eq(payrollRunLines.runId, runId), inArray(payrollRunLines.employeeId, ids)));
    if (stored.length !== ids.length) return fail(ERR_LINE);

    const inputs = stored.map((s) => {
      const change = cleaned.value.get(s.employeeId)!;
      const l = fromStored(s);
      const overrides: Partial<Record<DeductionKey, number>> = { ...l.overrides };
      for (const [k, v] of Object.entries(change.overrides ?? {}) as [DeductionKey, number | null][]) {
        if (v === null) delete overrides[k];
        else overrides[k] = v;
      }
      return { ...l, amounts: { ...l.amounts, ...change.amounts }, overrides };
    });
    await saveLines(tx, runId, await computeLines(tx, run, ctx.value, inputs));
    await bump(tx, runId);
    return ok({ version: version + 1 });
  });
}

/** Adds an employee to a draft run (any employee: 귀속월 employment is the prefill rule only). */
export async function addEmployeeToRun(
  db: Db,
  actor: SessionUser,
  runId: string,
  version: number,
  employeeId: number,
): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!Number.isSafeInteger(employeeId)) return fail(ERR_EMPLOYEE);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    const run = locked.value;
    const [exists] = await tx
      .select({ id: payrollRunLines.employeeId })
      .from(payrollRunLines)
      .where(and(eq(payrollRunLines.runId, runId), eq(payrollRunLines.employeeId, employeeId)));
    if (exists) return fail(ERR_ALREADY_IN);
    const ctx = await loadCtx(tx, run);
    if (!ctx.ok) return ctx;
    const amounts = await prefillAmounts(tx, run.type, [employeeId], ctx.value);
    const inputs = await freshLines(tx, ctx.value, [{ employeeId, amounts: amounts.get(employeeId)!, overrides: {} }]);
    if (!inputs.ok) return inputs;
    const [c] = await computeLines(tx, run, ctx.value, inputs.value);
    await tx.insert(payrollRunLines).values({ runId, employeeId, ...lineValues(c) });
    await bump(tx, runId);
    return ok();
  });
}

export async function removeEmployeeFromRun(
  db: Db,
  actor: SessionUser,
  runId: string,
  version: number,
  employeeId: number,
): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!Number.isSafeInteger(employeeId)) return fail(ERR_LINE);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    const gone = await tx
      .delete(payrollRunLines)
      .where(and(eq(payrollRunLines.runId, runId), eq(payrollRunLines.employeeId, employeeId)))
      .returning({ id: payrollRunLines.employeeId });
    if (gone.length === 0) return fail(ERR_LINE);
    await bump(tx, runId);
    return ok();
  });
}

/** Reloads every line's employee facts and the run's rates, keeping amounts and overrides. */
export async function recomputeRun(db: Db, actor: SessionUser, runId: string, version: number): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    const run = locked.value;
    const ctx = await loadCtx(tx, run);
    if (!ctx.ok) return ctx;
    const stored = await storedLines(tx, runId);
    const inputs = await freshLines(
      tx,
      ctx.value,
      stored.map((s) => ({ employeeId: s.employeeId, amounts: s.amounts, overrides: s.overrides })),
    );
    if (!inputs.ok) return inputs;
    await saveLines(tx, runId, await computeLines(tx, run, ctx.value, inputs.value));
    await bump(tx, runId);
    return ok();
  });
}

/** Deletes a draft run and its lines; a confirmed run must be cancelled first. */
export async function deleteRun(db: Db, actor: SessionUser, runId: string, version: number): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, runId));
    return ok();
  });
}

type Mapping = {
  accounts: Parameters<typeof buildPayrollVoucher>[0]["accounts"];
  partners: Parameters<typeof buildPayrollVoucher>[0]["partners"];
  items: { code: string; accountId: number | null }[];
};

/**
 * Resolves the settings' account codes (and the items' own debit accounts) to active accounts, and
 * requires the 기관 partners on the 예수금 / 미지급 accounts that need a partner.
 */
async function resolveMapping(tx: Tx, ctx: Ctx, lines: { amounts: Record<string, number> }[]): Promise<Result<Mapping>> {
  const [s] = await tx.select().from(payrollSettings).where(eq(payrollSettings.id, 1));
  if (!s) return fail(ERR_SETTINGS);
  const used = ctx.items.filter((i) => lines.some((l) => (l.amounts[i.code] ?? 0) > 0));
  const codes = [
    ...SETTING_CODE_FIELDS.map((k) => s[k]),
    ...used.map((i) => i.debitAccountCode).filter((c): c is string => c !== null),
  ];
  const rows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isActive: accounts.isActive,
      requiresPartner: accounts.requiresPartner,
    })
    .from(accounts)
    .where(inArray(accounts.code, codes));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const usable = (code: string) => {
    const a = byCode.get(code);
    return a && a.isActive ? a : null;
  };
  const resolved = {} as Record<SettingCodeField, NonNullable<ReturnType<typeof usable>>>;
  for (const k of SETTING_CODE_FIELDS) {
    const a = usable(s[k]);
    if (!a) return fail(errAccount(SETTING_LABELS[k]));
    resolved[k] = a;
  }
  const itemAccounts = new Map<string, number | null>();
  for (const i of ctx.items) itemAccounts.set(i.code, null);
  for (const i of used) {
    if (i.debitAccountCode === null) continue;
    const a = usable(i.debitAccountCode);
    if (!a) return fail(errAccount(i.name));
    itemAccounts.set(i.code, a.id);
  }

  const partners = {
    pension: s.pensionPartnerId,
    health: s.healthPartnerId,
    employment: s.employmentPartnerId,
    tax: s.taxPartnerId,
    localTax: s.localTaxPartnerId,
  };
  const needs: [NonNullable<ReturnType<typeof usable>>, (keyof typeof partners)[]][] = [
    [resolved.withholdingCode, ["pension", "health", "employment", "tax", "localTax"]],
    [resolved.companyPayableCode, ["pension", "health", "employment"]],
  ];
  for (const [a, keys] of needs) {
    if (a.requiresPartner && keys.some((k) => partners[k] === null)) return fail(errPartner(a.code, a.name));
  }

  return ok({
    accounts: {
      executive: resolved.executiveCode.id,
      staff: resolved.staffCode.id,
      pensionCompany: resolved.pensionCompanyCode.id,
      insuranceCompany: resolved.insuranceCompanyCode.id,
      withholding: resolved.withholdingCode.id,
      companyPayable: resolved.companyPayableCode.id,
      netPay: resolved.netPayCode.id,
    },
    partners,
    items: [...itemAccounts].map(([code, accountId]) => ({ code, accountId })),
  });
}

/**
 * Confirms a draft run and writes its payroll voucher in the same transaction.
 * Lock order: period lock shared (`assertMonthsOpen`) → the run row → company FOR SHARE and
 * numbering (inside `writePayrollVoucher`).
 */
export async function confirmRun(db: Db, actor: SessionUser, runId: string, version: number): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!isUuid(runId)) return fail(ERR_NOT_FOUND);
  // The pay date is fixed at creation; read it first so the period lock is the first statement.
  const [pre] = await db.select({ payDate: payrollRuns.payDate }).from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!pre) return fail(ERR_NOT_FOUND);
  const vat = await loadVat(db);
  return db.transaction(async (tx) => {
    const closed = await assertMonthsOpen(tx, [pre.payDate]);
    if (closed) return fail(closed);
    const locked = await lockDraft(tx, runId, version);
    if (!locked.ok) return locked;
    const run = locked.value;
    if (run.payDate !== pre.payDate) return fail(ERR_CONFLICT);

    const stored = await storedLines(tx, runId);
    if (stored.length === 0) return fail(ERR_EMPTY);
    const ctx = await loadCtx(tx, run);
    if (!ctx.ok) return ctx;
    const mapping = await resolveMapping(tx, ctx.value, stored);
    if (!mapping.ok) return mapping;

    // Recompute every line from its snapshot, so the voucher matches the stored figures exactly.
    const computed = await computeLines(tx, run, ctx.value, stored.map(fromStored));
    const negative = computed.find((c) => c.result.netPay < 0);
    if (negative) return fail(errNegativeNet(negative.facts.name));

    const voucher = buildPayrollVoucher({
      payDate: run.payDate,
      description: payrollDescription(run.type, run.yearMonth),
      lines: computed.map((c) => ({
        employee: {
          isExecutive: c.facts.isExecutive,
          siteId: c.facts.siteId,
          departmentId: c.facts.departmentId,
        },
        amounts: c.amounts,
        result: c.result,
      })),
      ...mapping.value,
    });
    // Nothing is written before this point, so a refused voucher leaves the run untouched.
    const written = await writePayrollVoucher(tx, actor, vat, voucher);
    if (!written.ok) return written;
    await saveLines(tx, runId, computed);
    await tx
      .update(payrollRuns)
      .set({
        status: "confirmed",
        voucherId: written.value.id,
        confirmedBy: actor.id,
        confirmedAt: sql`now()`,
        version: sql`${payrollRuns.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(payrollRuns.id, runId));
    return ok();
  });
}

/**
 * Cancels a confirmed run: deletes its payroll voucher (same rules as a voucher delete: refused in
 * a closed month) and returns the run to draft, in one transaction. A run whose voucher is already
 * gone just goes back to draft.
 * Lock order: period lock shared → the run row → the voucher row.
 */
export async function cancelConfirm(db: Db, actor: SessionUser, runId: string, version: number): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  if (!isUuid(runId)) return fail(ERR_NOT_FOUND);
  const [pre] = await db
    .select({ voucherId: payrollRuns.voucherId, date: vouchers.date })
    .from(payrollRuns)
    .leftJoin(vouchers, eq(vouchers.id, payrollRuns.voucherId))
    .where(eq(payrollRuns.id, runId));
  if (!pre) return fail(ERR_NOT_FOUND);
  return db.transaction(async (tx) => {
    const closed = await assertMonthsOpen(tx, pre.date === null ? [] : [pre.date]);
    if (closed) return fail(closed);
    const locked = await lockRun(tx, runId, version);
    if (!locked.ok) return locked;
    if (locked.value.status !== "confirmed") return fail(ERR_NOT_CONFIRMED);
    const voucherId = locked.value.voucherId;
    if (voucherId !== pre.voucherId) return fail(ERR_CONFLICT);
    if (voucherId !== null) {
      const [v] = await tx.select({ date: vouchers.date }).from(vouchers).where(eq(vouchers.id, voucherId));
      if (v && v.date !== pre.date) return fail(ERR_CONFLICT);
      if (v) {
        const r = await deletePayrollVoucher(tx, actor, voucherId);
        if (!r.ok) return r;
      }
    }
    await tx
      .update(payrollRuns)
      .set({
        status: "draft",
        voucherId: null,
        confirmedBy: null,
        confirmedAt: null,
        version: sql`${payrollRuns.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(payrollRuns.id, runId));
    return ok();
  });
}

const creator = alias(users, "run_creator");
const confirmer = alias(users, "run_confirmer");

export async function getRun(db: Db, runId: string): Promise<RunDetail | null> {
  if (!isUuid(runId)) return null;
  const [row] = await db
    .select({
      r: payrollRuns,
      voucherNo: vouchers.no,
      voucherStatus: vouchers.status,
      voucherRejectReason: vouchers.rejectReason,
      createdByName: creator.name,
      confirmedByName: confirmer.name,
    })
    .from(payrollRuns)
    .innerJoin(creator, eq(creator.id, payrollRuns.createdBy))
    .leftJoin(confirmer, eq(confirmer.id, payrollRuns.confirmedBy))
    .leftJoin(vouchers, eq(vouchers.id, payrollRuns.voucherId))
    .where(eq(payrollRuns.id, runId));
  if (!row) return null;
  const [stored, items] = await Promise.all([storedLines(db, runId), listItems(db)]);
  const lines: RunLineView[] = stored
    .map((l) => ({
      employeeId: l.employeeId,
      amounts: l.amounts,
      overrides: l.overrides,
      result: l.result,
      snapshot: l.snapshot,
    }))
    .sort((a, b) => a.snapshot.employeeNo.localeCompare(b.snapshot.employeeNo) || a.employeeId - b.employeeId);
  const { r } = row;
  return {
    id: r.id,
    type: r.type,
    yearMonth: r.yearMonth,
    payDate: r.payDate,
    bonusFrom: r.bonusFrom,
    bonusTo: r.bonusTo,
    status: r.status,
    version: r.version,
    voucherId: r.voucherId,
    voucherNo: row.voucherNo,
    voucherStatus: row.voucherStatus,
    voucherRejectReason: row.voucherRejectReason,
    createdByName: row.createdByName,
    confirmedByName: row.confirmedByName,
    confirmedAt: r.confirmedAt,
    items: items.filter((i) => i.isActive || lines.some((l) => (l.amounts[i.code] ?? 0) > 0)),
    lines,
  };
}

/** The runs whose 귀속월 is in `year`, newest first. */
export async function listRuns(db: Db, f: { year: number }): Promise<RunRow[]> {
  if (!Number.isInteger(f.year) || f.year < 1000 || f.year > 9999) return [];
  const sumOf = (field: "gross" | "netPay") =>
    sql<number>`(select coalesce(sum((${payrollRunLines.result}->>${field})::bigint), 0) from ${payrollRunLines}
      where ${payrollRunLines.runId} = ${payrollRuns.id})::bigint`.mapWith(Number);
  return db
    .select({
      id: payrollRuns.id,
      type: payrollRuns.type,
      yearMonth: payrollRuns.yearMonth,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
      employeeCount: sql<number>`(select count(*) from ${payrollRunLines}
        where ${payrollRunLines.runId} = ${payrollRuns.id})::int`,
      gross: sumOf("gross"),
      netPay: sumOf("netPay"),
      voucherStatus: vouchers.status,
    })
    .from(payrollRuns)
    .leftJoin(vouchers, eq(vouchers.id, payrollRuns.voucherId))
    .where(like(payrollRuns.yearMonth, `${f.year}-%`))
    .orderBy(desc(payrollRuns.yearMonth), asc(payrollRuns.type), desc(payrollRuns.payDate), asc(payrollRuns.createdAt));
}
