"use client";

// ── AnyNotesView (SPEC-F I3.3) — the /anynotes page shell ───────────────────
// header (count chips + rule-16 gear) → CaptureBox → filter row → masonry grid
// → NoteDetail slide-over. Polls GET /api/anynotes every 4s through
// usePollWhileVisible (SPEC-F §6). Status counts come from the route's
// server-computed `counts` — never re-derived from the visible page.
//
// Two URL params, both handled here:
//   ?capture=<url> — the Opera bookmarklet: auto-capture, then scrub the param
//   ?note=<id>     — deep link into the detail drawer (the route the I4.1
//                    attention.flag and the anynotes-recent widget both use)

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, StickyNote } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import {
  NOTE_STATUSES,
  NOTE_TYPES,
  type Note,
  type NoteStatus,
  type NoteType,
} from "@/lib/v2/anynotes/types";
import { EmptyState, StatusChip, inputStyle } from "../integrations/shared";
import AnyNotesSettings from "./AnyNotesSettings";
import CaptureBox from "./CaptureBox";
import NoteCard from "./NoteCard";
import NoteDetail from "./NoteDetail";
import { ANYNOTES_ACCENT, STATUS_COLORS, TYPE_META } from "./shared";

type StatusFilter = NoteStatus | "all";

interface ListResponse {
  notes: Note[];
  counts: Record<NoteStatus, number>;
  replyCounts: Record<string, number>;
}

export default function AnyNotesView() {
  const router = useRouter();
  const params = useSearchParams();
  const captureParam = params.get("capture");
  const noteParam = params.get("note");

  const [notes, setNotes] = useState<Note[] | null>(null);
  const [counts, setCounts] = useState<Record<NoteStatus, number>>({ inbox: 0, kept: 0, archived: 0 });
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);

  const [status, setStatus] = useState<StatusFilter>("inbox");
  const [type, setType] = useState<NoteType | "">("");
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    const sp = new URLSearchParams({ status, limit: "120" });
    if (type) sp.set("type", type);
    if (label) sp.set("label", label);
    if (q.trim()) sp.set("q", q.trim());
    try {
      const res = await fetch(`/api/anynotes?${sp.toString()}`, { cache: "no-store" });
      const j = (await res.json()) as Partial<ListResponse>;
      if (Array.isArray(j.notes)) {
        setNotes(j.notes);
        if (j.counts) setCounts(j.counts);
        setReplyCounts(j.replyCounts ?? {});
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, [status, type, label, q]);

  usePollWhileVisible(refresh, 4000, [status, type, label, q]);

  useJarvisPageContext({
    route: "/anynotes",
    title: "AnyNotes",
    summary:
      "Captured notes — tweets, articles, videos, screenshots and text, each with an @jarvis reply thread. " +
      `${counts.inbox} in the inbox, ${counts.kept} kept, ${counts.archived} archived.`,
  });

  /** Label options come from what is actually on the loaded notes — no
   *  invented taxonomy, and the current filter always stays selectable. */
  const labelOptions = useMemo(() => {
    const set = new Set<string>(label ? [label] : []);
    for (const n of notes ?? []) for (const l of n.labels) set.add(l);
    return [...set].sort();
  }, [notes, label]);

  async function setNoteStatus(id: string, next: NoteStatus) {
    await fetch(`/api/anynotes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    await refresh();
  }

  function openNote(id: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("note", id);
    else sp.delete("note");
    router.replace(sp.toString() ? `/anynotes?${sp.toString()}` : "/anynotes", { scroll: false });
  }

  function clearCaptureParam() {
    const sp = new URLSearchParams(params.toString());
    sp.delete("capture");
    router.replace(sp.toString() ? `/anynotes?${sp.toString()}` : "/anynotes", { scroll: false });
    void refresh();
  }

  return (
    <div className="px-6 py-5 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[17px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            <StickyNote size={18} style={{ color: ANYNOTES_ACCENT }} /> AnyNotes
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Capture anything — a tweet, an article, a video, a screenshot, a thought — then talk to
            Jarvis about it in the note&apos;s own thread.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {NOTE_STATUSES.map((s) => (
            <StatusChip key={s} color={STATUS_COLORS[s]}>
              {s} {counts[s]}
            </StatusChip>
          ))}
          <ConfigMenu title="AnyNotes settings" accent={ANYNOTES_ACCENT}>
            <AnyNotesSettings />
          </ConfigMenu>
        </div>
      </div>

      <CaptureBox
        onCaptured={(id) => {
          void refresh();
          openNote(id);
        }}
        pendingCapture={captureParam}
        onPendingConsumed={clearCaptureParam}
      />

      {/* filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
          {(["inbox", "kept", "archived", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="px-2.5 h-7 text-[11.5px] transition"
              style={{
                background: status === s ? `${ANYNOTES_ACCENT}1a` : "transparent",
                color: status === s ? ANYNOTES_ACCENT : "var(--fg-dim, #9aa)",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {NOTE_TYPES.map((t) => {
            const m = TYPE_META[t];
            const on = type === t;
            return (
              <button
                key={t}
                onClick={() => setType(on ? "" : t)}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-full text-[11px] transition"
                style={{
                  border: `1px solid ${on ? m.color : "var(--panel-border, #2a2436)"}`,
                  color: on ? m.color : "var(--fg-dim, #9aa)",
                  background: on ? `${m.color}14` : "transparent",
                }}
              >
                <m.Icon size={11} /> {m.label}
              </button>
            );
          })}
        </div>

        <select
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="text-[11.5px] rounded-md px-2 h-7 outline-none"
          style={inputStyle}
          aria-label="Filter by label"
        >
          <option value="">all labels</option>
          {labelOptions.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <div className="inline-flex items-center gap-1.5 ml-auto">
          <Search size={13} style={{ color: "var(--fg-dimmer, #6b6478)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search title, text, url"
            className="text-[11.5px] rounded-md px-2 h-7 outline-none w-[200px]"
            style={inputStyle}
          />
        </div>
      </div>

      {/* masonry grid — CSS columns, 1-4 responsive (SPEC-F §6) */}
      {notes === null ? (
        <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {failed ? "AnyNotes API unreachable" : "loading…"}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<StickyNote size={20} />}
          title={q || type || label ? "No notes match these filters" : "Nothing captured yet"}
          hint="Paste a URL above, drop or paste a screenshot anywhere in the capture box, or open the bookmarklet to capture the page you are reading."
        />
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-3">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              replyCount={replyCounts[n.id] ?? 0}
              onOpen={() => openNote(n.id)}
              onStatus={(s) => void setNoteStatus(n.id, s)}
            />
          ))}
        </div>
      )}

      {noteParam && (
        <NoteDetail noteId={noteParam} onClose={() => openNote(null)} onChanged={() => void refresh()} />
      )}
    </div>
  );
}
