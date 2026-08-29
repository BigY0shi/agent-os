"use client";

// SPEC-E F4.3 — HarnessLibrary. Slide-over over /api/v2/harnesses: harness
// cards + editor (structured fields for preamble/loop/phases + a raw-JSON
// toggle, validate-on-save — the route's 400 shape errors are surfaced).
// Builtins are editable-but-NOT-deletable (DELETE → 409, surfaced); user rows
// "delete" = exile ({exiled:true} in the definition JSON — the row stays and
// the "show exiled" toggle lists it via ?includeExiled=1).

import { useCallback, useEffect, useState } from "react";
import { Wrench, X, Plus, Loader2, Braces, AlertTriangle } from "lucide-react";
import { AGENTS_ACCENT } from "./shared";

type HarnessKind = "loop" | "oneshot" | "council" | "custom";

interface HarnessDef {
  systemPreamble: string;
  loop?: { maxIterations: number; stopWhen: string; reviewPrompt?: string };
  phases?: { name: string; prompt: string; gate?: "approval" | "none" }[];
  pollCadenceSec?: number;
  notes?: string;
  exiled?: boolean;
}

interface HarnessRow {
  id: string;
  name: string;
  description: string;
  kind: HarnessKind;
  definition: HarnessDef;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const KINDS: HarnessKind[] = ["oneshot", "loop", "council", "custom"];

export default function HarnessLibrary({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<HarnessRow[]>([]);
  const [showExiled, setShowExiled] = useState(false);
  const [editing, setEditing] = useState<HarnessRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await fetch(`/api/v2/harnesses${showExiled ? "?includeExiled=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(j.harnesses)) setRows(j.harnesses);
    } catch { /* server asleep */ }
  }, [showExiled]);

  useEffect(() => { void load(); }, [load]);

  async function exile(row: HarnessRow) {
    setError(null);
    if (!confirm(`Exile harness "${row.name}"? The row stays in the library (recoverable via "show exiled").`)) return;
    const r = await fetch("/api/v2/harnesses", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error ?? `exile failed (${r.status})`); // builtin → 409 surfaced
    else { void load(); onChanged?.(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-2xl h-full overflow-y-auto border-l p-5 space-y-4"
        style={{ borderColor: `${AGENTS_ACCENT}33`, background: "rgba(12,14,22,0.99)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium flex items-center gap-2" style={{ color: "var(--fg)" }}>
            <Wrench size={16} style={{ color: AGENTS_ACCENT }} /> Harness library
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
              <input type="checkbox" checked={showExiled} onChange={(e) => setShowExiled(e.target.checked)} /> show exiled
            </label>
            <button onClick={() => { setEditing("new"); setError(null); }}
              className="px-2.5 h-8 rounded-lg border text-[12px] flex items-center gap-1" style={{ borderColor: `${AGENTS_ACCENT}55`, color: AGENTS_ACCENT }}>
              <Plus size={12} /> New harness
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--fg-dim)" }}><X size={15} /></button>
          </div>
        </div>
        <p className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>
          Harnesses are pure data (rule 17): a system preamble plus optional loop or phase scaffolding, injected at run
          start into whichever provider the agent uses. Builtins are editable but never deletable; user rows exile instead of dropping.
        </p>
        {error && (
          <div className="rounded-lg border px-3 py-2 text-[12px] text-rose-300 flex items-center gap-2" style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.06)" }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="space-y-2">
          {rows.map((h) => (
            <div key={h.id} className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)", opacity: h.definition.exiled ? 0.55 : 1 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-medium" style={{ color: "var(--fg)" }}>{h.name}</span>
                <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ borderColor: `${AGENTS_ACCENT}44`, color: AGENTS_ACCENT }}>{h.kind}</span>
                {h.builtin && <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>builtin</span>}
                {h.definition.exiled && <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border text-rose-300" style={{ borderColor: "rgba(248,113,113,0.4)" }}>exiled</span>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => { setEditing(h); setError(null); }} className="text-[11px]" style={{ color: AGENTS_ACCENT }}>Edit</button>
                  {!h.builtin && !h.definition.exiled && (
                    <button onClick={() => void exile(h)} className="text-[11px] text-rose-300/70 hover:text-rose-300">Exile</button>
                  )}
                </span>
              </div>
              {h.description && <div className="text-[12px] mt-1" style={{ color: "var(--fg-dim)" }}>{h.description}</div>}
              <div className="text-[10.5px] font-mono mt-1.5" style={{ color: "var(--fg-dimmer)" }}>
                {h.definition.loop ? `loop · max ${h.definition.loop.maxIterations} · stop on "${h.definition.loop.stopWhen}"`
                  : h.definition.phases ? `phases · ${h.definition.phases.map((p) => p.name + (p.gate === "approval" ? "⏸" : "")).join(" → ")}`
                  : "single pass"}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No harnesses yet.</div>}
        </div>

        {editing && (
          <HarnessEditor
            row={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); void load(); onChanged?.(); }}
          />
        )}
      </div>
    </div>
  );
}

// ---- editor ---------------------------------------------------------------

function HarnessEditor({ row, onClose, onSaved }: { row: HarnessRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [kind, setKind] = useState<HarnessKind>(row?.kind ?? "custom");
  const [preamble, setPreamble] = useState(row?.definition.systemPreamble ?? "");
  const [structure, setStructure] = useState<"none" | "loop" | "phases">(
    row?.definition.loop ? "loop" : row?.definition.phases ? "phases" : "none",
  );
  const [loopMax, setLoopMax] = useState(String(row?.definition.loop?.maxIterations ?? 5));
  const [loopStop, setLoopStop] = useState(row?.definition.loop?.stopWhen ?? "LOOP-COMPLETE");
  const [loopReview, setLoopReview] = useState(row?.definition.loop?.reviewPrompt ?? "");
  const [phases, setPhases] = useState<{ name: string; prompt: string; gate: "approval" | "none" }[]>(
    row?.definition.phases?.map((p) => ({ name: p.name, prompt: p.prompt, gate: p.gate ?? "none" })) ?? [{ name: "plan", prompt: "", gate: "none" }],
  );
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function buildDefinition(): HarnessDef | { error: string } {
    if (rawMode) {
      try {
        const parsed = JSON.parse(rawJson) as HarnessDef;
        return parsed;
      } catch (e) {
        return { error: `raw JSON does not parse: ${String((e as Error).message)}` };
      }
    }
    const def: HarnessDef = { systemPreamble: preamble };
    if (structure === "loop") {
      const max = parseInt(loopMax, 10);
      def.loop = { maxIterations: Number.isFinite(max) ? max : 5, stopWhen: loopStop, ...(loopReview.trim() ? { reviewPrompt: loopReview } : {}) };
    } else if (structure === "phases") {
      def.phases = phases.map((p) => ({ name: p.name, prompt: p.prompt, gate: p.gate }));
    }
    return def;
  }

  function toRaw() {
    const def = buildDefinition();
    if ("error" in def) { setErr(def.error); return; }
    setRawJson(JSON.stringify(def, null, 2));
    setRawMode(true);
  }

  async function save() {
    setErr(null);
    const definition = buildDefinition();
    if ("error" in definition) { setErr(definition.error); return; }
    setBusy(true);
    try {
      const r = row
        ? await fetch("/api/v2/harnesses", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id, name, description, kind, definition }) })
        : await fetch("/api/v2/harnesses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, kind, definition }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? `save failed (${r.status})`); // validateHarnessDef errors surface here
      else onSaved();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: `${AGENTS_ACCENT}44`, background: "rgba(0,0,0,0.3)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>
          {row ? `Edit — ${row.name}${row.builtin ? " (builtin)" : ""}` : "New harness"}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => (rawMode ? setRawMode(false) : toRaw())} title="Toggle raw JSON"
            className="px-2 h-7 rounded-md border text-[11px] flex items-center gap-1" style={{ borderColor: "var(--panel-border)", color: rawMode ? AGENTS_ACCENT : "var(--fg-dim)" }}>
            <Braces size={11} /> {rawMode ? "structured" : "raw JSON"}
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: "var(--fg-dim)" }}><X size={13} /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
          className="bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as HarnessKind)}
          className="bg-black/30 border rounded-lg px-2.5 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (one line)"
        className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />

      {rawMode ? (
        <textarea value={rawJson} onChange={(e) => setRawJson(e.target.value)} rows={12} spellCheck={false}
          className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[11.5px] outline-none resize-y font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
      ) : (
        <>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: "var(--fg-dimmer)" }}>System preamble</div>
            <textarea value={preamble} onChange={(e) => setPreamble(e.target.value)} rows={6}
              placeholder="Operating rules prepended to the agent's system.md at run start."
              className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12px] outline-none resize-y font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          </div>
          <div className="flex gap-1.5">
            {(["none", "loop", "phases"] as const).map((s) => (
              <button key={s} onClick={() => setStructure(s)}
                className="flex-1 h-8 rounded-lg border text-[11.5px] transition"
                style={{ borderColor: structure === s ? AGENTS_ACCENT : "var(--panel-border)", color: structure === s ? AGENTS_ACCENT : "var(--fg-dim)" }}>
                {s === "none" ? "single pass" : s}
              </button>
            ))}
          </div>
          {structure === "loop" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2.5">
                <input value={loopMax} onChange={(e) => setLoopMax(e.target.value)} placeholder="Max iterations (1-50)"
                  className="bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                <input value={loopStop} onChange={(e) => setLoopStop(e.target.value)} placeholder='Stop marker — e.g. "LOOP-COMPLETE"'
                  className="bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
              </div>
              <textarea value={loopReview} onChange={(e) => setLoopReview(e.target.value)} rows={2} placeholder="Review prompt between iterations (optional)"
                className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            </div>
          )}
          {structure === "phases" && (
            <div className="space-y-2">
              {phases.map((p, i) => (
                <div key={i} className="rounded-lg border p-2.5 space-y-1.5" style={{ borderColor: "var(--panel-border)" }}>
                  <div className="flex items-center gap-2">
                    <input value={p.name} onChange={(e) => setPhases((l) => l.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} placeholder="Phase name"
                      className="flex-1 bg-black/30 border rounded-lg px-2.5 h-8 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                    <label className="flex items-center gap-1 text-[11px] cursor-pointer" style={{ color: "var(--fg-dim)" }} title="Park on the approval queue before this phase runs">
                      <input type="checkbox" checked={p.gate === "approval"}
                        onChange={(e) => setPhases((l) => l.map((x, xi) => xi === i ? { ...x, gate: e.target.checked ? "approval" : "none" } : x))} /> gate
                    </label>
                    <button onClick={() => setPhases((l) => l.filter((_, xi) => xi !== i))} disabled={phases.length <= 1}
                      className="p-1 rounded hover:bg-rose-500/15 text-rose-300/70 disabled:opacity-30"><X size={12} /></button>
                  </div>
                  <textarea value={p.prompt} onChange={(e) => setPhases((l) => l.map((x, xi) => xi === i ? { ...x, prompt: e.target.value } : x))} rows={2} placeholder="Phase prompt"
                    className="w-full bg-black/30 border rounded-lg px-2.5 py-1.5 text-[12px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                </div>
              ))}
              <button onClick={() => setPhases((l) => [...l, { name: "", prompt: "", gate: "none" }])}
                className="px-2.5 h-7 rounded-md border text-[11px]" style={{ borderColor: `${AGENTS_ACCENT}44`, color: AGENTS_ACCENT }}>+ phase</button>
            </div>
          )}
        </>
      )}

      {err && <div className="text-[12px] text-rose-300">{err}</div>}
      <button onClick={() => void save()} disabled={busy || !name.trim()}
        className="w-full h-9 rounded-lg border text-[12.5px] disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT, background: "rgba(167,139,250,0.10)" }}>
        {busy && <Loader2 size={13} className="animate-spin" />} Save harness
      </button>
    </div>
  );
}
