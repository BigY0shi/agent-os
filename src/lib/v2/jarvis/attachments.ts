import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSettings } from "@/lib/settings";
import { uuid } from "../ids";
import type { JarvisAttachmentRef } from "./conversations";

/**
 * S34 — image attachments for the orb chat (Nexora C6, on Jarvis).
 *
 * One image per message reaches the brain as an image content block. The bytes
 * are stored under the attachments dir (settings.jarvis.chat.attachmentDir,
 * blank = ~/.agentic-os/jarvis/attachments; AGENTIC_OS_JARVIS_DIR redirects it
 * for smokes) and are read back only to build that block. They go nowhere else.
 *
 * Accepted: png, jpeg, webp, decided by MAGIC BYTES, never by the client's
 * filename or declared mime. Size cap: settings.jarvis.chat.attachmentMaxMb
 * (default 4). Anything else is refused with the reason (AttachmentRefused).
 */

export type ImageMime = JarvisAttachmentRef["mime"];

const MAGIC: Array<{ mime: ImageMime; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_CAP = 120;
const DEFAULT_MAX_MB = 4;

export class AttachmentRefused extends Error {
  /** 413 for size, 415 for type, 400 otherwise. */
  status: 400 | 413 | 415;
  constructor(message: string, status: 400 | 413 | 415) {
    super(message);
    this.name = "AttachmentRefused";
    this.status = status;
  }
}

export function attachmentsDir(): string {
  const configured = readSettings().jarvis?.chat?.attachmentDir?.trim();
  if (configured) return path.resolve(configured);
  const base = process.env.AGENTIC_OS_JARVIS_DIR || path.join(os.homedir(), ".agentic-os", "jarvis");
  return path.join(base, "attachments");
}

/** The cap in bytes. A non-number or non-positive setting falls back to the 4 MB default. */
export function attachmentMaxBytes(): number {
  const mb = readSettings().jarvis?.chat?.attachmentMaxMb;
  const n = typeof mb === "number" && Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB;
  return Math.max(1, Math.round(n * 1024 * 1024));
}

/** Which image format the bytes really are, or null. */
export function sniffImage(bytes: Buffer): { mime: ImageMime; ext: string } | null {
  for (const m of MAGIC) if (m.test(bytes)) return { mime: m.mime, ext: m.ext };
  return null;
}

function cleanName(name: string | undefined, ext: string): string {
  const base = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, NAME_CAP);
  return base || `image.${ext}`;
}

/**
 * Validate and store one image. THROWS AttachmentRefused with the reason when the
 * bytes are not a png/jpeg/webp or exceed the cap; the caller turns that into a
 * 413/415 with the message, so the user sees why.
 */
export function storeAttachment(input: { name?: string; bytes: Buffer }): JarvisAttachmentRef {
  const { bytes } = input;
  if (!bytes || bytes.length === 0) throw new AttachmentRefused("empty file", 400);
  const max = attachmentMaxBytes();
  if (bytes.length > max) {
    throw new AttachmentRefused(
      `too large: ${(bytes.length / 1024 / 1024).toFixed(2)} MB, the cap is ${(max / 1024 / 1024).toFixed(2)} MB (Jarvis gear > Attachment size cap)`,
      413,
    );
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new AttachmentRefused("not an image: only png, jpeg and webp are accepted (checked by file bytes, not the name)", 415);
  }
  const dir = attachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = uuid();
  const file = path.join(dir, `${id}.${kind.ext}`);
  fs.writeFileSync(file, bytes);
  return { id, name: cleanName(input.name, kind.ext), mime: kind.mime, bytes: bytes.length };
}

function fileFor(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const dir = attachmentsDir();
  for (const m of MAGIC) {
    const p = path.join(dir, `${id}.${m.ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** The stored ref for an id (re-sniffed from disk), or null when it is not there. */
export function getAttachment(id: string, name?: string): JarvisAttachmentRef | null {
  const file = fileFor(id);
  if (!file) return null;
  const bytes = fs.readFileSync(file);
  const kind = sniffImage(bytes);
  if (!kind) return null;
  return { id, name: cleanName(name, kind.ext), mime: kind.mime, bytes: bytes.length };
}

/** The Anthropic image content block for a stored attachment (base64). THROWS when missing. */
export function imageBlockFor(ref: Pick<JarvisAttachmentRef, "id">): {
  type: "image";
  source: { type: "base64"; media_type: ImageMime; data: string };
} {
  const file = fileFor(ref.id);
  if (!file) throw new Error(`attachment ${ref.id} is not in ${attachmentsDir()}`);
  const bytes = fs.readFileSync(file);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error(`attachment ${ref.id} is not an image any more`);
  return { type: "image", source: { type: "base64", media_type: kind.mime, data: bytes.toString("base64") } };
}
