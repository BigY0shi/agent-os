// SPEC-F I4.1 — the @jarvis-reply attention source.
//
// CONVENTIONS §5 publishes `attention.flag {kind, severity, title, route,
// dedupeKey}` and names SPEC-F I4.1 as one of its emitters. Chunk 1
// deliberately stopped at `anynote.reply.jarvis {noteId, replyId, ok}` (its
// delta 5), so this module is the whole of the mapping: subscribe to that
// event, translate it, re-emit as attention.flag. H4's generic bridge
// (attention/index.ts) does the upsert — no bespoke collector, no new plumbing
// in the reply worker.
//
// Severity split:
//   ok:true  → info  ("Jarvis answered, go read it")
//   ok:false → warn  (the generation failed; the thread carries the loud
//                     provider error — rule 11 — and this surfaces it on the
//                     homepage instead of leaving it buried in a note)

import { emit, on } from "../events";
import { getNote } from "./store";

declare global {
  // eslint-disable-next-line no-var
  var __agentosAnynotesAttention: { unsubscribe: (() => void) | null } | undefined;
}

function state() {
  if (!globalThis.__agentosAnynotesAttention) {
    globalThis.__agentosAnynotesAttention = { unsubscribe: null };
  }
  return globalThis.__agentosAnynotesAttention;
}

/** Title fragment for a note — falls back to the id when the row is gone. */
function noteLabel(noteId: string): string {
  try {
    const note = getNote(noteId);
    const title = note?.title?.trim();
    if (title) return title.length > 70 ? `${title.slice(0, 69)}…` : title;
  } catch {
    // A read failure must never take down the bus handler; the id still
    // identifies the note honestly.
  }
  return noteId;
}

/** Boot-wired singleton (boot.ts ensureV2), idempotent. */
export function ensureAnynotesAttention(): void {
  const s = state();
  if (s.unsubscribe) return;

  s.unsubscribe = on("anynote.reply.jarvis", (event) => {
    const p = event.payload as { noteId?: unknown; replyId?: unknown; ok?: unknown };
    const noteId = typeof p.noteId === "string" ? p.noteId : "";
    const replyId = typeof p.replyId === "string" ? p.replyId : "";
    if (!noteId || !replyId) {
      console.warn("[anynotes/attention] anynote.reply.jarvis missing noteId/replyId — ignored:", p);
      return;
    }
    const ok = p.ok === true;
    try {
      emit(
        "attention.flag",
        {
          kind: ok ? "anynote.reply" : "anynote.reply.failed",
          severity: ok ? "info" : "warn",
          title: ok
            ? `Jarvis replied on “${noteLabel(noteId)}”`
            : `Jarvis reply failed on “${noteLabel(noteId)}”`,
          // Deep link the AnyNotes page opens the detail slide-over from.
          route: `/anynotes?note=${noteId}`,
          dedupeKey: `anynote-reply:${replyId}`,
          noteId,
          replyId,
        },
        "anynotes",
      );
    } catch (err) {
      console.error("[anynotes/attention] attention.flag emit failed:", err);
    }
  });
}

/** Smoke teardown: drop the bus subscription. */
export function stopAnynotesAttentionForTests(): void {
  const s = state();
  s.unsubscribe?.();
  globalThis.__agentosAnynotesAttention = undefined;
}
