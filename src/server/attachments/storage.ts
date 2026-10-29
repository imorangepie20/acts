import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

const EXT: Record<AttachmentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The file type from its magic bytes; the name and the browser-sent type are never trusted. */
export function sniffType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/**
 * `UPLOAD_DIR`, else `./uploads` (the Docker runner's `/app/uploads` volume). The ignore comments
 * keep Turbopack's file tracing from pulling the whole project into the standalone output.
 */
export function uploadRoot(): string {
  const dir = process.env.UPLOAD_DIR;
  return dir
    ? path.resolve(/*turbopackIgnore: true*/ dir)
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
}

/** Writes the bytes to `<root>/<yyyy>/<mm>/<uuid>.<ext>`; returns the path relative to the root. */
export async function writeStored(bytes: Uint8Array, type: AttachmentType, now = new Date()): Promise<string> {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rel = `${yyyy}/${mm}/${randomUUID()}.${EXT[type]}`;
  const abs = path.join(/*turbopackIgnore: true*/ uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes, { flag: "wx", mode: 0o640 });
  return rel;
}

/** Absolute path of a stored file, or null if `rel` would resolve outside the upload root. */
export function resolveStored(rel: string): string | null {
  const root = uploadRoot();
  const abs = path.resolve(/*turbopackIgnore: true*/ root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * Deletes a stored file. Runs after the database change has committed, so it never throws:
 * a missing file is ignored and any other failure is logged (the file is then an orphan).
 */
export async function removeStored(rel: string): Promise<void> {
  const abs = resolveStored(rel);
  if (!abs) return;
  try {
    await fs.unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("attachment unlink failed", rel, e);
  }
}
