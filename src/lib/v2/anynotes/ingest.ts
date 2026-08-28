// SPEC-F I2.2 / I4 — Memory V2 ingestion for AnyNotes.
//
// Uses the ONE cross-module seam, ingestFromModule() (CONVENTIONS §4). The
// label taxonomy is confirmed there: 'anynotes' plus the note type, so Jarvis
// can recall "that tweet about X" by label as well as by vector.
//
// NO pending-ingest.jsonl. SPEC-F I2.2 speced one; CONVENTIONS §2 deletes it
// from scope by name ("Deleted from scope: … both pending-*.jsonl files (C3.6,
// F I2.2)") and rules that consumers fail loudly instead of buffering — and
// CONVENTIONS wins where it conflicts with a spec. So:
//   • autoIngest off  → nothing queued, episodeId stays null (the switch working)
//   • enqueue throws  → logged loudly + meta.ingestError set, episodeId null
// Either way the note itself is already durable in SQLite; ingest is additive.
//
// Naming note: the `episode_id` column holds the ingestion_queue id that
// ingestFromModule returns. Memory V2 settles the real episode from that row —
// the queue id is the handle we are given, so it is the honest thing to store.

import { readSettings } from "../../settings";
import { ingestFromModule } from "../memory/queue";
import { patchNote } from "./store";
import type { Note } from "./types";

/** Memory V2's ingest body schema rejects anything shorter than this. */
const MIN_EPISODE_CHARS = 20;

export function autoIngestEnabled(): boolean {
  return readSettings().anynotes?.autoIngest !== false;
}

function noteEpisodeBody(note: Note): string {
  return [note.title, note.url ?? "", note.contentMd]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

export interface IngestOutcome {
  queueId?: string;
  /** Set when nothing was queued, with the honest reason. */
  skipped?: string;
}

/**
 * Queue a captured note into Memory V2 and record the handle on the row.
 * Never throws: an ingest problem must not lose the capture.
 */
export async function ingestNote(note: Note): Promise<IngestOutcome> {
  if (!autoIngestEnabled()) return { skipped: "settings.anynotes.autoIngest is off" };

  const body = noteEpisodeBody(note);
  if (body.length < MIN_EPISODE_CHARS) {
    const skipped = `episode body is ${body.length} chars (Memory V2 requires ${MIN_EPISODE_CHARS})`;
    patchNote(note.id, { meta: { ingestSkipped: skipped } });
    return { skipped };
  }

  try {
    const { queueId } = await ingestFromModule({
      episodeBody: body,
      source: "anynotes",
      sourceURL: note.url ?? undefined,
      labelNames: ["anynotes", note.type],
      metadata: { noteId: note.id, noteType: note.type },
    });
    patchNote(note.id, { episodeId: queueId });
    return { queueId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[anynotes/ingest] enqueue FAILED for note ${note.id}:`, message);
    patchNote(note.id, { meta: { ingestError: message } });
    return { skipped: message };
  }
}

/**
 * Queue a completed user↔jarvis exchange on a note (I4). Same gate, same
 * labels, plus the note's own id in metadata so recall can trace it back.
 */
export async function ingestExchange(
  note: Note,
  userBody: string,
  jarvisBody: string,
): Promise<IngestOutcome> {
  if (!autoIngestEnabled()) return { skipped: "settings.anynotes.autoIngest is off" };

  const body = [
    `Note: ${note.title}${note.url ? ` (${note.url})` : ""}`,
    `User: ${userBody.trim()}`,
    `Jarvis: ${jarvisBody.trim()}`,
  ].join("\n\n");
  if (body.length < MIN_EPISODE_CHARS) {
    return { skipped: `exchange body is ${body.length} chars` };
  }

  try {
    const { queueId } = await ingestFromModule({
      episodeBody: body,
      source: "anynotes",
      sourceURL: note.url ?? undefined,
      labelNames: ["anynotes", note.type],
      metadata: { noteId: note.id, noteType: note.type, kind: "jarvis-exchange" },
    });
    return { queueId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[anynotes/ingest] exchange enqueue FAILED for note ${note.id}:`, message);
    return { skipped: message };
  }
}
