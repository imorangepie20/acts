import { z } from "zod";

const id = z.coerce.number().int().positive();
const text = z.string().default("");
// Switches submit "true" when on and nothing when off.
const flag = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "on");

export type Parsed<T> = { ok: true; data: T } | { ok: false };

function run<S extends z.ZodType>(schema: S, input: unknown): Parsed<z.output<S>> {
  const r = schema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

const fields = {
  name: z.string(),
  businessNumber: text,
  representative: text,
  phone: text,
  email: text,
  memo: text,
};
const createSchema = z.object(fields);
const updateSchema = z.object({ id, ...fields, isActive: flag });
const quickSchema = z.object({ name: z.string(), businessNumber: z.string() });

const entries = (fd: FormData) => Object.fromEntries(fd.entries());

export const parseCreatePartner = (fd: FormData) => run(createSchema, entries(fd));
export const parseUpdatePartner = (fd: FormData) => run(updateSchema, entries(fd));
export const parseQuickPartner = (input: unknown) => run(quickSchema, input);
