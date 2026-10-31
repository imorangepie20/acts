import { eq, inArray } from "drizzle-orm";
import type { SessionUser } from "@/server/auth/service";
import type { Db } from "@/server/db/client";
import { accounts, partners, payrollSettings } from "@/server/db/schema";
import { fail, ok, type Result } from "@/server/result";
import {
  SETTING_CODE_FIELDS,
  SETTING_LABELS,
  SETTING_PARTNER_FIELDS,
  type PayrollSettingsInput,
} from "@/lib/payroll/settings";
import { canManagePayroll, ERR_FORBIDDEN } from "./items";

export type { PayrollSettingsInput };

export type PayrollSettings = PayrollSettingsInput & {
  /** Names of the chosen partners, for the pickers. */
  partners: { id: number; name: string }[];
};

const ERR_PARTNER = "거래처를 찾을 수 없습니다.";
const errAccount = (label: string) => `${label} 계정을 찾을 수 없거나 사용하지 않는 계정입니다.`;

export async function getPayrollSettings(db: Db): Promise<PayrollSettings> {
  const read = () => db.select().from(payrollSettings).where(eq(payrollSettings.id, 1));
  let [s] = await read();
  if (!s) {
    // The seed creates the row; recreate it with the column defaults if it is missing.
    await db.insert(payrollSettings).values({ id: 1 }).onConflictDoNothing();
    [s] = await read();
  }
  const value = Object.fromEntries([
    ...SETTING_CODE_FIELDS.map((k) => [k, s[k]]),
    ...SETTING_PARTNER_FIELDS.map((k) => [k, s[k] ?? null]),
  ]) as PayrollSettingsInput;
  const ids = SETTING_PARTNER_FIELDS.map((k) => value[k]).filter((v): v is number => v !== null);
  const found = ids.length
    ? await db.select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, ids))
    : [];
  return { ...value, partners: found };
}

/** Codes must exist and be active now; Task 8's confirm re-checks them. */
export async function savePayrollSettings(db: Db, actor: SessionUser, s: PayrollSettingsInput): Promise<Result> {
  if (!canManagePayroll(actor)) return fail(ERR_FORBIDDEN);
  const codes = SETTING_CODE_FIELDS.map((k) => s[k].trim());
  const active = await db
    .select({ code: accounts.code, isActive: accounts.isActive })
    .from(accounts)
    .where(inArray(accounts.code, codes));
  const activeCodes = new Set(active.filter((a) => a.isActive).map((a) => a.code));
  for (const k of SETTING_CODE_FIELDS) {
    if (!activeCodes.has(s[k].trim())) return fail(errAccount(SETTING_LABELS[k]));
  }
  const ids = SETTING_PARTNER_FIELDS.map((k) => s[k]).filter((v): v is number => v !== null);
  if (ids.length) {
    const found = await db.select({ id: partners.id }).from(partners).where(inArray(partners.id, ids));
    if (new Set(found.map((p) => p.id)).size !== new Set(ids).size) return fail(ERR_PARTNER);
  }
  const values = {
    ...Object.fromEntries(SETTING_CODE_FIELDS.map((k) => [k, s[k].trim()])),
    ...Object.fromEntries(SETTING_PARTNER_FIELDS.map((k) => [k, s[k]])),
  } as PayrollSettingsInput;
  await db
    .insert(payrollSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: payrollSettings.id, set: values });
  return ok();
}
