import { z } from "zod";
import { parseWon } from "@/lib/money";
import type { EmployeeInput, EmployeeUpdate } from "./employees";
import type { PayItemInput } from "./items";
import type { PayrollSettingsInput } from "./settings";

export type Parsed<T> = { ok: true; data: T } | { ok: false };

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const flag = (fd: FormData, k: string) => str(fd, k) === "true" || str(fd, k) === "on";
const int = (s: string): number | null => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : null);
/** Empty = 0; otherwise a won amount (commas allowed) or null when invalid. */
const won = (s: string): number | null => (s.trim() === "" ? 0 : parseWon(s));

export const AMOUNT_PREFIX = "amount.";

type Common = Omit<EmployeeInput, "rrn" | "account">;

function common(fd: FormData): Parsed<Common> {
  const siteId = int(str(fd, "siteId"));
  const dept = str(fd, "departmentId").trim();
  const departmentId = dept === "" ? null : int(dept);
  const dependents = int(str(fd, "dependents"));
  const children = int(str(fd, "children"));
  const withholdingRate = int(str(fd, "withholdingRate"));
  const pensionBase = won(str(fd, "pensionBase"));
  const healthBase = won(str(fd, "healthBase"));
  if (
    siteId === null ||
    (dept !== "" && departmentId === null) ||
    dependents === null ||
    children === null ||
    withholdingRate === null ||
    pensionBase === null ||
    healthBase === null
  ) {
    return { ok: false };
  }
  const defaultAmounts: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith(AMOUNT_PREFIX) || typeof v !== "string") continue;
    const n = won(v);
    if (n === null) return { ok: false };
    defaultAmounts[k.slice(AMOUNT_PREFIX.length)] = n;
  }
  return {
    ok: true,
    data: {
      employeeNo: str(fd, "employeeNo"),
      name: str(fd, "name"),
      hiredOn: str(fd, "hiredOn").trim(),
      leftOn: str(fd, "leftOn").trim() || null,
      siteId,
      departmentId,
      isExecutive: flag(fd, "isExecutive"),
      dependents,
      children,
      withholdingRate,
      bank: str(fd, "bank").trim() || null,
      insPension: flag(fd, "insPension"),
      insHealth: flag(fd, "insHealth"),
      insEmployment: flag(fd, "insEmployment"),
      pensionBase,
      healthBase,
      defaultAmounts,
    },
  };
}

export function parseCreateEmployee(fd: FormData): Parsed<EmployeeInput> {
  const c = common(fd);
  if (!c.ok) return c;
  return { ok: true, data: { ...c.data, rrn: str(fd, "rrn"), account: str(fd, "account").trim() || null } };
}

/** A blank 주민등록번호 or account keeps the stored one; `clearAccount` removes the account. */
export function parseUpdateEmployee(fd: FormData): Parsed<{ id: number; input: EmployeeUpdate }> {
  const id = int(str(fd, "id"));
  const c = common(fd);
  if (id === null || !c.ok) return { ok: false };
  const rrn = str(fd, "rrn").trim();
  const account = str(fd, "account").trim();
  const input: EmployeeUpdate = { ...c.data };
  if (rrn) input.rrn = rrn;
  if (flag(fd, "clearAccount")) input.account = null;
  else if (account) input.account = account;
  return { ok: true, data: { id, input } };
}

const itemSchema = z.object({
  code: z.string().max(40),
  name: z.string().max(100),
  taxable: z.boolean(),
  nontaxLimit: z.number().int().nullable(),
  inEmploymentBase: z.boolean(),
  debitAccountCode: z.string().max(10).nullable(),
  sort: z.number().int(),
  isActive: z.boolean(),
});

const settingsSchema = z.object({
  pensionCompanyCode: z.string().max(10),
  insuranceCompanyCode: z.string().max(10),
  withholdingCode: z.string().max(10),
  companyPayableCode: z.string().max(10),
  netPayCode: z.string().max(10),
  executiveCode: z.string().max(10),
  staffCode: z.string().max(10),
  pensionPartnerId: z.number().int().positive().nullable(),
  healthPartnerId: z.number().int().positive().nullable(),
  employmentPartnerId: z.number().int().positive().nullable(),
  taxPartnerId: z.number().int().positive().nullable(),
  localTaxPartnerId: z.number().int().positive().nullable(),
});

function run<T>(schema: z.ZodType<T>, input: unknown): Parsed<T> {
  const r = schema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

export const parsePayItem = (input: unknown): Parsed<PayItemInput> => run(itemSchema, input);
export const parsePayrollSettings = (input: unknown): Parsed<PayrollSettingsInput> => run(settingsSchema, input);
