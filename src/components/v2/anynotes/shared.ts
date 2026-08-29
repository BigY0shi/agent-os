// ── AnyNotes shared atoms (SPEC-F §6) ───────────────────────────────────────
// CLIENT-SAFE: no server imports, no node imports. Only the things that are
// genuinely AnyNotes-specific live here — everything generic (StatusChip,
// EmptyState, fmtAgo, panelStyle, inputStyle) is imported from
// components/v2/integrations/shared, and the slide-over shell from
// components/v2/memory/shared. Do not fork those.

// lucide dropped the `Twitter` glyph — `Bird` is the stand-in for tweet notes.
import { Bird, FileText, Image as ImageIcon, Newspaper, PlayCircle, type LucideIcon } from "lucide-react";
import type { NoteType } from "@/lib/v2/anynotes/types";

/** SPEC-F §6 accent suggestion for /anynotes. */
export const ANYNOTES_ACCENT = "#e8a33d";

/** Per-type icon + hue, reused by NoteCard, the type pills and NoteDetail. */
export const TYPE_META: Record<NoteType, { label: string; color: string; Icon: LucideIcon }> = {
  tweet: { label: "Tweet", color: "#7dd3fc", Icon: Bird },
  article: { label: "Article", color: "#a3e635", Icon: Newspaper },
  video: { label: "Video", color: "#fb7185", Icon: PlayCircle },
  screenshot: { label: "Screenshot", color: "#c084fc", Icon: ImageIcon },
  text: { label: "Note", color: ANYNOTES_ACCENT, Icon: FileText },
};

/** Status chip hues. Deliberately NOT the five StatusBand hexes — a note's
 *  status is not an agent band and must never look like one (CONVENTIONS §6
 *  keeps that palette single-purpose). */
export const STATUS_COLORS: Record<string, string> = {
  inbox: ANYNOTES_ACCENT,
  kept: "#7dd3a8",
  archived: "#6b7280",
};

/** The one place a note's in-app deep link is built (attention.flag route,
 *  widget cards and the page's own ?note= handling all agree on this shape). */
export function noteHref(id: string): string {
  return `/anynotes?note=${id}`;
}
