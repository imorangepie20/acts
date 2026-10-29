export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T = void>(value?: T): Result<T> => ({ ok: true, value: value as T });
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
