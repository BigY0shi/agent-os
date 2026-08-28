"use client";

// ── NoteDetail (SPEC-F I3.4) ────────────────────────────────────────────────
// Right slide-over over the SHARED SlideOver shell (components/v2/memory/
// shared — the same drawer ConfigMenu uses; not a second implementation):
// markdown snapshot, source link, labels editor, status buttons, ReplyThread
// and the composer with its @jarvis quick-chip.
//
// Thread states come straight off the row (chunk-1 handoff):
//   pending === true → "Jarvis is thinking…" shimmer
//   error !== null   → red inline (the string already names the agent, rule 11)
//   otherwise        → body
// There is no SSE for replies — the thread is polled with usePollWhileVisible.

import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Archive, ExternalLink, Inbox, Loader2, Sparkles, Star, Trash2, X } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { JARVIS_MENTION, type Note, type NoteStatus, type Reply } from "@/lib/v2/anynotes/types";
import { SlideOver } from "../memory/shared";
import { fmtAgo, inputStyle } from "../integrations/shared";
import { ANYNOTES_ACCENT, STATUS_COLORS, TYPE_META } from "./shared";

/** The Jarvis module accent (Sidebar NAV) — jarvis bubbles wear it. */
const JARVIS_ACCENT = "#22d3ee";

interface Props {
  noteId: string;
  onClose: () => void;
  /** Called whenever the note changes so the grid behind stays in sync. */
  onChanged: () => void;
}

export default function NoteDetail({ noteId, onClose, onChanged }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/anynotes/${noteId}`, { cache: "no-store" });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      const j = (await res.json()) as { note?: Note; replies?: Reply[] };
      if (j.note) setNote(j.note);
      if (Array.isArray(j.replies)) setReplies(j.replies);
    } catch {
      /* offline — keep the last good render */
    }
  }, [noteId]);

  // 4s while the drawer is open; the jarvis worker settles rows out of band.
  usePollWhileVisible(refresh, 4000, [noteId]);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/anynotes/${noteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as { note?: Note; error?: string } | null;
      if (!res.ok) {
        setError(j?.error ?? `update failed (${res.status})`);
        return;
      }
      if (j?.note) setNote(j.note);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/anynotes/${noteId}/replies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(j?.error ?? `reply failed (${res.status})`);
        return;
      }
      setDraft("");
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function exile() {
    if (!confirm("Exile this note? It moves to anynotes_exile — recoverable, never destroyed.")) return;
    await fetch(`/api/anynotes/${noteId}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  if (missing) {
    return (
      <SlideOver title="Note not found" accent={ANYNOTES_ACCENT} onClose={onClose} wide>
        <p className="text-[12.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>
          Note <span className="font-mono">{noteId}</span> is not in the live table — it was exiled,
          or the link is stale.
        </p>
      </SlideOver>
    );
  }

  if (!note) {
    return (
      <SlideOver title="Loading…" accent={ANYNOTES_ACCENT} onClose={onClose} wide>
        <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>loading…</div>
      </SlideOver>
    );
  }

  const meta = TYPE_META[note.type];
  const Icon = meta.Icon;

  return (
    <SlideOver
      title={
        <span className="inline-flex items-center gap-2 min-w-0">
          <Icon size={14} style={{ color: meta.color }} className="shrink-0" />
          <span className="truncate">{note.title || "(untitled)"}</span>
        </span>
      }
      accent={ANYNOTES_ACCENT}
      onClose={onClose}
      wide
    >
      {/* source + timestamps */}
      <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        <span style={{ color: STATUS_COLORS[note.status] }}>{note.status}</span>
        <span>· {[note.site, note.author].filter(Boolean).join(" · ") || "no source"}</span>
        <span>· captured {fmtAgo(note.capturedAt)}</span>
        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: ANYNOTES_ACCENT }}
          >
            <ExternalLink size={10} /> open source
          </a>
        )}
      </div>

      {/* status actions + exile */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {(["inbox", "kept", "archived"] as NoteStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => void patch({ status: s })}
            disabled={note.status === s}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] disabled:opacity-100"
            style={{
              border: `1px solid ${note.status === s ? STATUS_COLORS[s] : "var(--panel-border, #2a2436)"}`,
              color: note.status === s ? STATUS_COLORS[s] : "var(--fg-dim, #9aa)",
              background: note.status === s ? `${STATUS_COLORS[s]}14` : "transparent",
            }}
          >
            {s === "inbox" ? <Inbox size={11} /> : s === "kept" ? <Star size={11} /> : <Archive size={11} />}
            {s}
          </button>
        ))}
        <button
          onClick={() => void exile()}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px]"
          style={{ border: "1px solid #f8717155", color: "#f87171" }}
          title="Exile (recoverable — never deleted)"
        >
          <Trash2 size={11} /> Exile
        </button>
      </div>

      {/* labels editor */}
      <div className="mb-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] mb-1.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          labels
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {note.labels.map((l) => (
            <span
              key={l}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px]"
              style={{ color: ANYNOTES_ACCENT, background: `${ANYNOTES_ACCENT}14`, border: `1px solid ${ANYNOTES_ACCENT}44` }}
            >
              {l}
              <button
                aria-label={`Remove label ${l}`}
                onClick={() => void patch({ labels: note.labels.filter((x) => x !== l) })}
                style={{ color: "var(--fg-dimmer, #6b6478)" }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = labelDraft.trim();
              if (!v || note.labels.includes(v)) return;
              void patch({ labels: [...note.labels, v] });
              setLabelDraft("");
            }}
            placeholder="+ label"
            className="text-[11.5px] rounded-md px-2 h-6 outline-none w-[110px]"
            style={inputStyle}
          />
        </div>
      </div>

      {/* snapshot */}
      {note.mediaPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/anynotes/media/${note.mediaPath}`}
          alt={note.title || "screenshot"}
          className="w-full rounded-lg mb-3"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        />
      )}
      {note.contentMd.trim() ? (
        <div
          className="rounded-lg px-3 py-2.5 mb-4 text-[12.5px] leading-relaxed prose-invert max-w-none"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.contentMd}</ReactMarkdown>
        </div>
      ) : (
        !note.mediaPath && (
          <div className="rounded-lg px-3 py-2.5 mb-4 text-[12px]" style={{ border: "1px dashed var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}>
            No snapshot text was captured — only the link.
          </div>
        )
      )}

      {/* thread */}
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        thread
      </div>
      <ReplyThread replies={replies} />

      {/* composer */}
      <div className="mt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Reply… mention @jarvis to get an answer in-thread."
          className="w-full text-[12.5px] rounded-md px-2.5 py-2 outline-none resize-y"
          style={inputStyle}
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => setDraft((d) => (JARVIS_MENTION.test(d) ? d : `@jarvis ${d}`.trimEnd()))}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11.5px]"
            style={{ border: `1px solid ${JARVIS_ACCENT}55`, color: JARVIS_ACCENT, background: `${JARVIS_ACCENT}12` }}
            title="Ask Jarvis about this note"
          >
            <Sparkles size={11} /> @jarvis
          </button>
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
            style={{ background: ANYNOTES_ACCENT, color: "#241703" }}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : null} Reply
          </button>
        </div>
        {error && (
          <div className="mt-2 text-[11.5px]" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}
      </div>
    </SlideOver>
  );
}

export function ReplyThread({ replies }: { replies: Reply[] }) {
  if (replies.length === 0) {
    return (
      <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        No replies yet. Mention @jarvis to start one.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {replies.map((r) => {
        const jarvis = r.author === "jarvis";
        const accent = jarvis ? JARVIS_ACCENT : ANYNOTES_ACCENT;
        return (
          <div
            key={r.id}
            className={`rounded-xl px-3 py-2 max-w-[88%] ${jarvis ? "self-start" : "self-end"}`}
            style={{
              border: `1px solid ${accent}44`,
              background: `${accent}0e`,
            }}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: accent }}>
                {jarvis ? "jarvis" : "you"}
              </span>
              <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {fmtAgo(r.createdAt)}
              </span>
            </div>
            {r.pending ? (
              <div className="flex items-center gap-2 text-[12px] animate-pulse" style={{ color: JARVIS_ACCENT }}>
                <Loader2 size={12} className="animate-spin" /> Jarvis is thinking…
              </div>
            ) : r.error ? (
              <div className="text-[12px] leading-relaxed" style={{ color: "#f87171" }}>
                {r.error}
              </div>
            ) : (
              <div className="text-[12.5px] leading-relaxed prose-invert max-w-none" style={{ color: "var(--fg, #e8e2f0)" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.body}</ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
