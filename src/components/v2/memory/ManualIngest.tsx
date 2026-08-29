"use client";

import { useRef, useState } from "react";
import { Check, FileUp, Loader2, Send } from "lucide-react";
import { LabelChip, MEMORY_ACCENT, inputStyle, type LabelRow } from "./shared";

// ── ManualIngest (SPEC-A A8.4) ───────────────────────────────────────────────
// Textarea + source/label/session pickers → POST /api/v2/memory/ingest
// {episodeBody≥20, source, sessionId, type?, title?, labelIds?} → 202 {queueId}.
// Dropping (or picking) a .md/.txt file reads it CLIENT-SIDE into the textarea
// and flips type to DOCUMENT. Track progress in the Logs tab.

function newSessionId(): string {
  try { return crypto.randomUUID(); }
  catch { return `manual-${Date.now().toString(36)}`; }
}

export default function ManualIngest({ labels, onQueued }: { labels: LabelRow[]; onQueued?: (queueId: string) => void }) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("manual");
  const [sessionId, setSessionId] = useState(newSessionId);
  const [type, setType] = useState<"CONVERSATION" | "DOCUMENT">("CONVERSATION");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    if (!/\.(md|txt|markdown)$/i.test(file.name)) {
      setErr("only .md / .txt files are read into the textarea");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBody(String(reader.result ?? ""));
      setType("DOCUMENT");
      if (!title) setTitle(file.name.replace(/\.(md|txt|markdown)$/i, ""));
      setErr(null);
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (body.trim().length < 20) { setErr("episode body must be at least 20 characters"); return; }
    setBusy(true); setErr(null); setQueuedId(null);
    try {
      const r = await fetch("/api/v2/memory/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          episodeBody: body,
          source: source.trim() || "manual",
          sessionId: sessionId.trim() || newSessionId(),
          type,
          title: title.trim() || undefined,
          labelIds: labelIds.length ? labelIds : undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 202 && !r.ok) { setErr(typeof j?.error === "string" ? j.error : `ingest failed (${r.status})`); return; }
      const qid = String(j?.queueId ?? "");
      setQueuedId(qid);
      setBody(""); setTitle("");
      setSessionId(newSessionId());
      onQueued?.(qid);
    } catch { setErr("server unreachable"); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readFile(f);
        }}
        className="rounded-lg transition"
        style={{ outline: dragOver ? `2px dashed ${MEMORY_ACCENT}` : "2px dashed transparent", outlineOffset: 2 }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="What should memory remember? Paste a conversation, a decision, a fact… or drop a .md/.txt file here."
          className="w-full rounded-lg p-3 text-[12.5px] leading-relaxed outline-none resize-y"
          style={inputStyle}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2.5 mt-2">
        <label className="block">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="h-7 w-[180px] rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
        </label>
        <label className="block">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>source</span>
          <input value={source} onChange={(e) => setSource(e.target.value)}
            className="h-7 w-[120px] rounded-md px-2 text-[11.5px] outline-none" style={inputStyle} />
        </label>
        <label className="block">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>session</span>
          <input value={sessionId} onChange={(e) => setSessionId(e.target.value)}
            title="Episodes sharing a session are compacted together"
            className="h-7 w-[220px] rounded-md px-2 font-mono text-[10.5px] outline-none" style={inputStyle} />
        </label>
        <label className="block">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>type</span>
          <select value={type} onChange={(e) => setType(e.target.value as "CONVERSATION" | "DOCUMENT")}
            className="h-7 rounded-md px-2 text-[11.5px] outline-none" style={inputStyle}>
            <option value="CONVERSATION">conversation</option>
            <option value="DOCUMENT">document</option>
          </select>
        </label>

        <button
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          <FileUp size={12} /> File…
        </button>
        <input ref={fileRef} type="file" accept=".md,.txt,.markdown" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />

        <button
          onClick={submit}
          disabled={busy || body.trim().length < 20}
          className="ml-auto inline-flex items-center gap-1.5 px-3.5 h-8 rounded-md text-[12px] font-semibold disabled:opacity-40"
          style={{ background: MEMORY_ACCENT, color: "#04222a" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Ingest
        </button>
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.15em] mr-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>labels</span>
          {labels.map((l) => (
            <LabelChip key={l.id} label={{ ...l, episodeCount: undefined }}
              active={labelIds.includes(l.id)}
              onClick={() => setLabelIds((ids) => ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id])} />
          ))}
          <span className="text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>(blank = auto-label)</span>
        </div>
      )}

      {err && <div className="mt-2 text-[11.5px]" style={{ color: "#f87171" }}>{err}</div>}
      {queuedId && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "#34d399" }}>
          <Check size={12} /> Queued <code className="font-mono text-[10.5px]">{queuedId.slice(0, 8)}…</code> — track it in the Logs tab.
        </div>
      )}
    </div>
  );
}
