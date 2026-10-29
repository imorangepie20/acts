import { z } from "zod";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

const roles = Object.keys(ROLE_LABELS) as [Role, ...Role[]];
const role = z.enum(roles);
const id = z.uuid();
const isActive = z.enum(["true", "false"]);

const entries = (fd: FormData) => Object.fromEntries(fd.entries());

export type Parsed<T> = { ok: true; data: T } | { ok: false };

function run<S extends z.ZodType>(schema: S, fd: FormData): Parsed<z.output<S>> {
  const r = schema.safeParse(entries(fd));
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

const createSchema = z.object({
  email: z.string(),
  name: z.string(),
  role,
  password: z.string(),
});
const updateSchema = z.object({
  id,
  name: z.string(),
  role,
  isActive: isActive.transform((v) => v === "true"),
});
const resetSchema = z.object({ id, password: z.string() });

export const parseCreateUser = (fd: FormData) => run(createSchema, fd);
export const parseUpdateUser = (fd: FormData) => run(updateSchema, fd);
export const parseResetPassword = (fd: FormData) => run(resetSchema, fd);
export const isUserId = (v: string) => id.safeParse(v).success;
