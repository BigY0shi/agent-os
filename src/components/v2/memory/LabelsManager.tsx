"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Tag, X } from "lucide-react";
import { EmptyState, MEMORY_ACCENT, inputStyle, type LabelRow } from "./shared";

// ── LabelsManager (SPEC-A A8.4) ──────────────────────────────────────────────
// CRUD over /api/v2/memory/labels (GET incl. episodeCount / POST / PATCH).
// Labels are never deleted (append-never-destroy) — only renamed/recolored.
// The list itself is owned by MemoryView (shared with EpisodeBrowser chips);
// this component edits and asks the parent to reload.

interface Draft { name: string; description: string; color: string }

const EMPTY_DRAFT: Draft = { name: "", description: "", color: "#22d3ee" };

export default function LabelsManager({ labels, onChanged }: { labels: LabelRow[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startAdd() {
    setAdding(true); setEditingId(null); setDraft(EMPTY_DRAFT); setErr(null);
  }
  function startEdit(l: LabelRow) {
    setEditingId(l.id); setAdding(false);
    setDraft({ name: l.name, description: l.description ?? "", color: l.color });
    setErr(null);
  }

  async function submit() {
    if (!draft.name.trim()) { setErr("name is required"); return; }
    setBusy(true); setErr(null);
    try {
      const isEdit = editingId !== null;
      const r = await fetch("/api/v2/memory/labels", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { id: editingId, name: draft.name.trim(), description: draft.description.trim() || null, color: draft.color }
            : { name: draft.name.trim(), description: draft.description.trim() || null, color: draft.color },
        ),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error ?? `save failed (${r.status})`); return; }
      setAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT);
      onChanged();
    } catch { setErr("server unreachable"); }
    finally { setBusy(false); }
  }

  const form = (
    <div className="rounded-lg p-3 mb-3 flex flex-wrap items-end gap-2.5"
      style={{ border: `1px solid ${MEMORY_ACCENT}44`, background: "var(--panel, rgba(255,255,255,0.02))" }}>
      <label className="block">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>name</span>
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="h-7 w-[160px] rounded-md px-2 text-[12px] outline-none" style={inputStyle} autoFocus />
      </label>
      <label className="block flex-1 min-w-[200px]">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>description</span>
        <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="what belongs under this label (the router reads this)"
          className="h-7 w-full rounded-md px-2 text-[12px] outline-none" style={inputStyle} />
      </label>
      <label className="block">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.15em] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>color</span>
        <input type="color" value={draft.color} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
          className="h-7 w-10 rounded-md cursor-pointer" style={{ ...inputStyle, padding: 2 }} />
      </label>
      <div className="flex items-center gap-1.5">
        <button onClick={submit} disabled={busy}
          className="inline-flex items-center gap-1 px-3 h-7 rounded-md text-[11.5px] font-semibold disabled:opacity-50"
          style={{ background: MEMORY_ACCENT, color: "#04222a" }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {editingId ? "Save" : "Create"}
        </button>
        <button onClick={() => { setAdding(false); setEditingId(null); }}
          className="p-1.5 rounded-md" style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
          aria-label="Cancel">
          <X size={12} />
        </button>
      </div>
      {err && <div className="w-full text-[11px]" style={{ color: "#f87171" }}>{err}</div>}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Labels route recall and group episodes. Never deleted — rename or recolor instead.
        </span>
        {!adding && editingId === null && (
          <button onClick={startAdd}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium"
            style={{ border: `1px solid ${MEMORY_ACCENT}55`, color: MEMORY_ACCENT }}>
            <Plus size={12} /> New label
          </button>
        )}
      </div>

      {adding && form}

      {labels.length === 0 && !adding ? (
        <EmptyState icon={<Tag size={22} />} title="No labels yet"
          hint="Ingestion auto-creates labels as topics emerge; you can also seed them here to steer routing." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {labels.map((l) =>
            editingId === l.id ? (
              <div key={l.id}>{form}</div>
            ) : (
              <div key={l.id} className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}66` }} />
                <span className="text-[12.5px] font-medium shrink-0" style={{ color: "var(--fg, #e8e2f0)" }}>{l.name}</span>
                <span className="text-[11.5px] truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{l.description}</span>
                <span className="ml-auto font-mono text-[10.5px] shrink-0" style={{ color: "var(--fg-dim, #9aa)" }}>
                  {l.episodeCount ?? 0} episode{(l.episodeCount ?? 0) === 1 ? "" : "s"}
                </span>
                <button onClick={() => startEdit(l)} className="p-1 rounded shrink-0 hover:opacity-80"
                  style={{ color: "var(--fg-dimmer, #6b6478)" }} aria-label={`Edit ${l.name}`}>
                  <Pencil size={12} />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
