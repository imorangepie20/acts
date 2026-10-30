import { z } from "zod";
import { ACCOUNT_GROUPS, DASHBOARD_ROLES } from "@/lib/accounts";

const group = z.enum(ACCOUNT_GROUPS);
// "" (the 없음 option) clears the role.
const role = z.enum([...DASHBOARD_ROLES, ""]).transform((v) => (v === "" ? null : v));
const id = z.coerce.number().int().positive();
// Switches submit "true" when on and nothing when off.
const flag = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "on");

export type Parsed<T> = { ok: true; data: T } | { ok: false };

function run<S extends z.ZodType>(schema: S, fd: FormData): Parsed<z.output<S>> {
  const r = schema.safeParse(Object.fromEntries(fd.entries()));
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

const createSchema = z.object({
  code: z.string(),
  name: z.string(),
  group,
  requiresPartner: flag,
  dashboardRole: role,
});
const updateSchema = z.object({
  id,
  name: z.string(),
  group,
  requiresPartner: flag,
  isActive: flag,
  dashboardRole: role,
});

export const parseCreateAccount = (fd: FormData) => run(createSchema, fd);
export const parseUpdateAccount = (fd: FormData) => run(updateSchema, fd);
