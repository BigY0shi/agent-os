"use client";

// Idea Engine — validate an idea through the cross-lineage council and read the
// resulting dossier. Phase 1 spine: manual idea in → seat progress → dossier
// archive. The Trend Radar board arrives in Phase 2 and feeds the same spine.

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Telescope, Loader2, Send, X, ShieldAlert, FileText, ChevronRight, Trash2 } from "lucide-react";
import {
  CANDIDATE_COLUMNS, SEAT_LABELS, VERDICT_META,
  type IdeaDossier, type SeatName, type TrendCandidate, type ValidationRun,
} from "@/lib/ideaEngineTypes";
import ModelSettings from "./ModelSettings";

const AMBER = "#f59e0b";

type DossierMeta = Pick<IdeaDossier, "id" | "generated_at" | "identity" | "verdict" | "scores">;

function seatDot(state: string): string {
  return state === "done" ? "#34d399" : state === "running" ? "#22d3ee" : state === "failed" ? "#f87171" : "#5a5d80";
}

function elapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function IdeaEngineView() {
  const [dossiers, setDossiers] = useState<DossierMeta[]>([]);
  const [daily, setDaily] = useState<{ lastRunDate: string | null; dossierId: string | null; candidateTopic: string | null; note: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [idea, setIdea] = useState("");
  // Set when the idea came from a radar card ("Validate ↑") — passed through so the
  // candidate's board status tracks the run. Cleared if the field is emptied.
  const [candId, setCandId] = useState<string | null>(null);
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // watchRun's completion handler needs load(), and load() needs watchRun to
  // resume in-flight runs — a ref breaks the circular useCallback dependency.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const watchRun = useCallback((runId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await (await fetch(`/api/idea-engine/validate?id=${runId}`, { cache: "no-store" })).json();
        if (!j.ok) return;
        setRun(j.run);
        if (j.run.status !== "running") {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          await loadRef.current();
          if (j.run.dossierId) setOpenId(j.run.dossierId);
        }
      } catch { /* transient */ }
    }, 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch("/api/idea-engine/list", { cache: "no-store" })).json();
      if (j.ok) {
        setDossiers(j.dossiers); setRunning(j.running); setDaily(j.daily ?? null);
        // A run is in flight that this page isn't watching (reload mid-run, or
        // the daily loop started it) — adopt it so the live panel shows.
        if (j.active) {
          setRun((r) => (r && r.id === j.active.id ? r : j.active));
          if (!pollRef.current) watchRun(j.active.id);
        }
      }
    } catch { /* empty state covers it */ }
  }, [watchRun]);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function validate() {
    const text = idea.trim();
    if (!text || running) return;
    setErr(null);
    try {
      const j = await (await fetch("/api/idea-engine/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: text, candidateId: candId ?? undefined }),
      })).json();
      if (!j.ok) { setErr(j.error || "could not start"); return; }
      setRunning(true);
      setRun({ id: j.runId, idea: text, status: "running", seats: {}, startedAt: Date.now() });
      watchRun(j.runId);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="max-w-[1200px] mx-auto p-6">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", color: AMBER }}>
          <Telescope size={18} />
        </div>
        <h1 className="text-xl font-semibold">Idea Engine</h1>
        <span className="text-[12px] text-white/40">{dossiers.length} dossiers</span>
        <div className="ml-auto">
          <ModelSettings section="ideaEngine" title="Idea Engine settings" accent={AMBER}
            fields={[
              { key: "researchModel", label: "Research + judge (claude)", placeholder: "claude-sonnet-5", hint: "Web-capable seats: pain miner, market mapper, verdict judge." },
              { key: "writerModel", label: "Dossier writer", placeholder: "blank = pinned CLAUDE_MODEL", hint: "Assembles the final dossier." },
              { key: "sizingAgent", label: "Sizing seat agent", placeholder: "claude", hint: "Evidence-only sizing. claude, codex, cursor, pi, hermes, or kimi (Ollama Cloud)." },
              { key: "clusterAgent", label: "Radar clustering agent", placeholder: "claude", hint: "Groups fresh signals into candidates. Same choices." },
              { key: "killAgent", label: "Kill pass agent", placeholder: "codex", hint: "Attacks the idea. Keep it a different lineage from claude (the research seats)." },
              { key: "fallbackAgent", label: "Fallback agent", placeholder: "codex", hint: "Answers when a seat's agent fails; the run records it. \"none\" = the seat fails instead." },
              { key: "kimiModel", label: "Kimi model (Ollama Cloud)", placeholder: "kimi-k2.6", hint: "Used only where an agent above is kimi." },
              { key: "redditSubs", label: "Radar: reddit subs", placeholder: "smallbusiness,Entrepreneur,SaaS", hint: "Comma-separated — pain mining sources." },
              { key: "seedTerms", label: "Radar: seed terms", placeholder: "ai automation,revops", hint: "Trends + autocomplete seeds." },
              { key: "dailyEnabled", label: "Daily idea (true/false)", placeholder: "false", hint: "At the hour below: one scan + one auto-validation. Hard-capped at 1/day." },
              { key: "dailyHour", label: "Daily hour (0-23)", placeholder: "7", hint: "Local hour for the daily run." },
            ]} />
        </div>
      </div>
      <p className="text-sm text-white/45 mb-4">
        Type an idea (or a trend, or a hunch). The council mines real pain evidence, maps the market, sizes it honestly,
        tries to kill it, and writes the dossier. Unsourced numbers are dropped in code — gaps say so.
      </p>

      {/* Daily run that spent its slot without producing a dossier — say why. */}
      {daily && !daily.dossierId && daily.note && daily.lastRunDate === new Date().toISOString().slice(0, 10) && (
        <div className="mb-4 text-[11.5px] text-white/40 font-mono">
          daily idea · {daily.candidateTopic ? `${daily.candidateTopic} — ` : ""}{daily.note}
        </div>
      )}

      {/* Idea of the Day */}
      {daily?.dossierId && daily.lastRunDate === new Date().toISOString().slice(0, 10) && (
        <button onClick={() => setOpenId(daily.dossierId)}
          className="w-full text-left mb-4 rounded-xl border p-3.5 flex items-center gap-3 hover:brightness-110 transition"
          style={{ borderColor: "rgba(245,158,11,0.5)", background: "rgba(245,158,11,0.07)" }}>
          <Telescope size={16} style={{ color: AMBER }} />
          <div className="min-w-0">
            <div className="text-[10.5px] font-mono uppercase tracking-widest" style={{ color: AMBER }}>Idea of the Day</div>
            <div className="text-[13.5px] font-medium truncate">{daily.candidateTopic}</div>
          </div>
          <ChevronRight size={14} className="ml-auto text-white/40 shrink-0" />
        </button>
      )}

      {/* Validate input */}
      <div className="flex gap-2 mb-5">
        <textarea value={idea} onChange={(e) => { setIdea(e.target.value); if (!e.target.value.trim()) setCandId(null); }} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void validate(); } }}
          placeholder='Idea to validate — e.g. "AI intake assistant for powersports dealership service departments"'
          className="flex-1 panel bg-transparent px-3 py-2 text-[13px] leading-relaxed resize-none" />
        <button onClick={() => void validate()} disabled={running || !idea.trim()}
          className="self-end inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12.5px] font-medium disabled:opacity-40"
          style={{ background: "rgba(245,158,11,0.16)", color: AMBER }}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {running ? "In council…" : "Validate"}
        </button>
      </div>
      {err && <div className="panel p-2.5 mb-4 text-[12.5px] text-rose-300">{err}</div>}

      {/* Live run seats */}
      {run && (
        <div className="panel p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            {run.status === "running" ? <Loader2 size={13} className="animate-spin" style={{ color: AMBER }} /> : run.status === "done" ? <FileText size={13} style={{ color: "#34d399" }} /> : <ShieldAlert size={13} className="text-rose-300" />}
            <span className="text-[12px] font-mono uppercase tracking-wider" style={{ color: AMBER }}>
              {run.status === "running" ? "Council in session" : run.status === "done" ? "Dossier ready" : `Run failed: ${run.error || "unknown"}`}
            </span>
            {run.status === "running" && (
              <span className="text-[10.5px] font-mono text-white/40" title="Full councils typically take 8–12 minutes">
                {elapsed(run.startedAt)} · ~8–12 min typical
              </span>
            )}
            <span className="text-[11px] text-white/40 ml-auto truncate max-w-[45%]">{run.idea}</span>
            {run.status === "running" && (
              <button onClick={async () => {
                await fetch(`/api/idea-engine/validate?id=${run.id}`, { method: "DELETE" }).catch(() => {});
                setRunning(false);
                setRun((r) => (r ? { ...r, status: "error", error: "cancelled by user" } : r));
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                void load();
              }}
                className="shrink-0 px-2 py-0.5 rounded text-[10.5px] text-rose-300/80 hover:bg-rose-500/10 border border-rose-500/25">
                Cancel
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SEAT_LABELS) as SeatName[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border border-[var(--panel-border)]">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: seatDot(run.seats[s] || "pending") }} />
                {SEAT_LABELS[s]}
                {run.seats[s] === "running" && <Loader2 size={10} className="animate-spin text-white/40" />}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trend Radar board */}
      <RadarBoard onValidate={(c) => {
        setIdea(`${c.topic} — ${c.thesis}`);
        setCandId(c.id);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} busy={running} />

      {/* Archive */}
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45 mb-2">Dossiers</div>
      {dossiers.length === 0 && !run && (
        <div className="panel border-dashed p-8 text-center text-[12.5px] text-white/45">
          Nothing validated yet. Feed it your first idea — the powersports service-intake control target is a good smoke test.
        </div>
      )}
      <div className="space-y-2">
        {dossiers.map((d) => {
          const v = VERDICT_META[d.verdict?.call ?? "watch"];
          const opp = d.scores?.opportunity?.value;
          return (
            <div key={d.id} role="button" tabIndex={0} onClick={() => setOpenId(d.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setOpenId(d.id); }}
              className="w-full text-left panel p-3 flex items-center gap-3 hover:brightness-110 transition cursor-pointer">
              <span className="text-[10px] font-mono font-bold px-2 py-1 rounded" style={{ background: `${v.color}22`, color: v.color }}>{v.label}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{d.identity?.title}</div>
                <div className="text-[11.5px] text-white/50 truncate">{d.identity?.one_liner}</div>
              </div>
              {typeof opp === "number" && <span className="text-[11px] font-mono text-white/50 shrink-0">opp {opp}/10</span>}
              <span className="text-[10.5px] text-white/35 shrink-0">{(d.generated_at || "").slice(0, 10)}</span>
              <button title="Exile dossier (recoverable from .exile/)" onClick={async (e) => {
                e.stopPropagation();
                if (!window.confirm(`Exile "${d.identity?.title}"? It moves to .exile/, not deleted.`)) return;
                await fetch(`/api/idea-engine/dossier?id=${d.id}`, { method: "DELETE" }).catch(() => {});
                void load();
              }} className="shrink-0 p-1 rounded text-white/25 hover:text-rose-300 hover:bg-rose-500/10">
                <Trash2 size={12} />
              </button>
              <ChevronRight size={13} className="text-white/30 shrink-0" />
            </div>
          );
        })}
      </div>

      {openId && <DossierDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ---- Trend Radar ----------------------------------------------------------

interface ScanJob { running: boolean; sources: Record<string, string>; newSignals: number; error: string | null; finishedAt: number | null }

function RadarBoard({ onValidate, busy }: { onValidate: (c: TrendCandidate) => void; busy: boolean }) {
  const [candidates, setCandidates] = useState<TrendCandidate[]>([]);
  const [scan, setScan] = useState<ScanJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch("/api/idea-engine/radar", { cache: "no-store" })).json();
      if (j.ok) { setCandidates(j.candidates); setScan(j.scan); return j.scan as ScanJob; }
    } catch { /* fine */ }
    return null;
  }, []);
  const ensurePoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await load();
      if (s && !s.running && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, 5000);
  }, [load]);

  // Resume the live view if a scan is already in flight (page reload, daily loop).
  useEffect(() => {
    void (async () => { const s = await load(); if (s?.running) ensurePoll(); })();
  }, [load, ensurePoll]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function startScan() {
    try {
      const j = await (await fetch("/api/idea-engine/radar", { method: "POST" })).json();
      if (j.ok) { setScan(j.scan); ensurePoll(); }
    } catch { /* fine */ }
  }

  async function move(id: string, status: string) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, status: status as TrendCandidate["status"] } : c)));
    await fetch("/api/idea-engine/radar", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }

  const srcSummary = scan && Object.keys(scan.sources).length
    ? Object.entries(scan.sources).map(([k, v]) => `${k} ${v.startsWith("ok") ? "✓" : v.startsWith("running") ? "…" : "✗"}`).join(" · ")
    : null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Trend Radar</span>
        <button onClick={() => void startScan()} disabled={scan?.running}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium disabled:opacity-40"
          style={{ background: "rgba(245,158,11,0.14)", color: AMBER }}>
          {scan?.running ? <Loader2 size={11} className="animate-spin" /> : <Telescope size={11} />}
          {scan?.running ? "Scanning sources…" : "Scan now"}
        </button>
        {!scan?.running && srcSummary && <span className="text-[10.5px] font-mono text-white/35 truncate" title={JSON.stringify(scan?.sources, null, 1)}>{srcSummary} · +{scan?.newSignals} signals</span>}
      </div>

      {/* Live scan strip — one chip per source, flipping running… → ✓/✗ as adapters land. */}
      {scan?.running && (
        <div className="panel p-2.5 mb-2 flex items-center gap-2 flex-wrap">
          <Loader2 size={12} className="animate-spin shrink-0" style={{ color: AMBER }} />
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: AMBER }}>Scanning</span>
          {Object.entries(scan.sources).map(([k, v]) => (
            <span key={k} title={v}
              className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border border-[var(--panel-border)]"
              style={{ color: v.startsWith("ok") ? "#34d399" : v.startsWith("running") ? "#22d3ee" : "#f87171" }}>
              {k} {v.startsWith("ok") ? "✓" : v.startsWith("running") ? "…" : "✗"}
            </span>
          ))}
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="panel border-dashed p-5 text-center text-[12px] text-white/40">
          No trend candidates yet — run a scan. Sources and seed terms live in the settings gear.
        </div>
      ) : (
        <div className="space-y-1.5">
          {CANDIDATE_COLUMNS.filter((col) => candidates.some((c) => c.status === col.key)).map((col) => (
            <div key={col.key}>
              <div className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: col.accent }}>{col.label}</div>
              {candidates.filter((c) => c.status === col.key).sort((a, b) => (b.scores.momentum.value ?? 0) - (a.scores.momentum.value ?? 0)).map((c) => (
                <div key={c.id} className="panel p-3 mb-1.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{c.topic}</div>
                    <div className="text-[11.5px] text-white/50 line-clamp-2">{c.thesis}</div>
                    <div className="flex gap-2 mt-1.5 text-[10px] font-mono text-white/45">
                      <span title={c.scores.momentum.inputs.map((i) => `${i.name}: ${i.value}`).join("\n")}>momentum {c.scores.momentum.value ?? "—"}</span>
                      <span title={c.scores.pain.inputs.map((i) => `${i.name}: ${i.value}`).join("\n")}>pain {c.scores.pain.value ?? "—"}</span>
                      <span title={c.scores.builders.inputs.map((i) => `${i.name}: ${i.value}`).join("\n")}>builders {c.scores.builders.value ?? "—"}</span>
                      <span>· {c.signalIds.length} signals</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => onValidate(c)} disabled={busy}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium disabled:opacity-40"
                      style={{ background: "rgba(245,158,11,0.16)", color: AMBER }}>Validate ↑</button>
                    <div className="flex gap-1">
                      {c.status !== "watching" && <button onClick={() => void move(c.id, "watching")} className="px-1.5 py-0.5 rounded text-[10px] text-cyan-300/80 hover:bg-cyan-500/10">watch</button>}
                      {c.status !== "parked" && <button onClick={() => void move(c.id, "parked")} className="px-1.5 py-0.5 rounded text-[10px] text-white/40 hover:bg-white/5">park</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DossierDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/idea-engine/dossier?id=${id}`, { cache: "no-store" })).json();
        if (j.ok) { setMd(j.markdown); setDegraded(j.dossier?.provenance?.degraded_seats ?? []); }
        else setMd(`_${j.error}_`);
      } catch (e) { setMd(`_${(e as Error).message}_`); }
    })();
  }, [id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-3xl h-full overflow-y-auto border-l p-6" style={{ borderColor: "rgba(245,158,11,0.3)", background: "rgba(12,14,22,0.99)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: AMBER }}>Idea dossier · {id}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-white/60"><X size={15} /></button>
        </div>
        {degraded.length > 0 && (
          <div className="mb-4 text-[11.5px] px-3 py-2 rounded-lg border" style={{ borderColor: "rgba(251,191,36,0.4)", color: "#fbbf24", background: "rgba(251,191,36,0.07)" }}>
            Degraded seats this run (output omitted, not faked): {degraded.join(", ")}
          </div>
        )}
        {!md ? (
          <div className="flex items-center gap-2 text-[12.5px] text-white/50"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white/90 prose-a:text-amber-400">
            <ReactMarkdown>{md}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
