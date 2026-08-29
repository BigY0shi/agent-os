// SPEC-F I1.1 — client-safe AnyNotes shapes. NO node imports in this file
// (agentsTypes.ts convention): components import from here, servers import the
// store.

export type NoteType = "tweet" | "article" | "video" | "screenshot" | "text";
export type NoteStatus = "inbox" | "kept" | "archived";
export type ReplyAuthor = "user" | "jarvis";

export const NOTE_TYPES: readonly NoteType[] = [
  "tweet",
  "article",
  "video",
  "screenshot",
  "text",
];
export const NOTE_STATUSES: readonly NoteStatus[] = ["inbox", "kept", "archived"];

export function isNoteType(v: unknown): v is NoteType {
  return typeof v === "string" && (NOTE_TYPES as readonly string[]).includes(v);
}
export function isNoteStatus(v: unknown): v is NoteStatus {
  return typeof v === "string" && (NOTE_STATUSES as readonly string[]).includes(v);
}

/** How the snapshot in content_md was produced — meta.captureMode. */
export type CaptureMode = "oembed" | "readability" | "opengraph" | "user" | "fallback";

export interface Note {
  id: string;
  url: string | null;
  type: NoteType;
  title: string;
  author: string | null;
  site: string | null;
  contentMd: string;
  /** Relative filename under the anynotes media dir — served by /api/anynotes/media/[file]. */
  mediaPath: string | null;
  /** Remote thumbnail (oEmbed / og:image). Display-only, never fetched server-side. */
  thumbUrl: string | null;
  status: NoteStatus;
  labels: string[];
  meta: Record<string, unknown>;
  /** Memory V2 ingestion_queue id once queued (I2.2). null = not ingested. */
  episodeId: string | null;
  capturedAt: string;
  updatedAt: string | null;
}

export interface Reply {
  id: string;
  noteId: string;
  author: ReplyAuthor;
  body: string;
  /** true = a jarvis reply is queued / being generated. */
  pending: boolean;
  /** Loud failure surface (rule 11) — a failed generation lands here, not silence. */
  error: string | null;
  createdAt: string;
}

/**
 * The @jarvis trigger. Deliberately NOT global: a /g/ regex carries lastIndex
 * across calls and would alternate true/false on the same input.
 */
export const JARVIS_MENTION = /@jarvis\b/i;

export function mentionsJarvis(body: string): boolean {
  return JARVIS_MENTION.test(body);
}
