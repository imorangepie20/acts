import { z } from "zod";
import { ACCOUNT_GROUPS } from "@/lib/accounts";

const group = z.enum(ACCOUNT_GROUPS);
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
});
const updateSchema = z.object({
  id,
  name: z.string(),
  group,
  requiresPartner: flag,
  isActive: flag,
});

export const parseCreateAccount = (fd: FormData) => run(createSchema, fd);
export const parseUpdateAccount = (fd: FormData) => run(updateSchema, fd);
