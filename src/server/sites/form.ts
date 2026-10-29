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

const site = { name: z.string(), businessNumber: text };
const dept = { name: z.string() };

const entries = (fd: FormData) => Object.fromEntries(fd.entries());

export const parseCreateSite = (fd: FormData) => run(z.object(site), entries(fd));
export const parseUpdateSite = (fd: FormData) => run(z.object({ id, ...site, isActive: flag }), entries(fd));
export const parseCreateDepartment = (fd: FormData) => run(z.object(dept), entries(fd));
export const parseUpdateDepartment = (fd: FormData) =>
  run(z.object({ id, ...dept, isActive: flag }), entries(fd));
