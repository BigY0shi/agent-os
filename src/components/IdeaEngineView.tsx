"use client";

// Idea Engine — validate an idea through the cross-lineage council and read the
// resulting dossier. Phase 1 spine: manual idea in → seat progress → dossier
// archive. The Trend Radar board arrives in Phase 2 and feeds the same spine.

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Telescope, Loader2, Send, X, ShieldAlert, FileText, ChevronRight } from "lucide-react";
import {
  SEAT_LABELS, VERDICT_META, type IdeaDossier, type SeatName, type ValidationRun,
} from "@/lib/ideaEngineTypes";
import ModelSettings from "./ModelSettings";

const AMBER = "#f59e0b";

type DossierMeta = Pick<IdeaDossier, "id" | "generated_at" | "identity" | "verdict" | "scores">;

function seatDot(state: string): string {
  return state === "done" ? "#34d399" : state === "running" ? "#22d3ee" : state === "failed" ? "#f87171" : "#5a5d80";
}

export default function IdeaEngineView() {
  const [dossiers, setDossiers] = useState<DossierMeta[]>([]);
  const [running, setRunning] = useState(false);
  const [idea, setIdea] = useState("");
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch("/api/idea-engine/list", { cache: "no-store" })).json();
      if (j.ok) { setDossiers(j.dossiers); setRunning(j.running); }
    } catch { /* empty state covers it */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const watchRun = useCallback((runId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await (await fetch(`/api/idea-engine/validate?id=${runId}`, { cache: "no-store" })).json();
        if (!j.ok) return;
        setRun(j.run);
        if (j.run.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          await load();
          if (j.run.dossierId) setOpenId(j.run.dossierId);
        }
      } catch { /* transient */ }
    }, 4000);
  }, [load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function validate() {
    const text = idea.trim();
    if (!text || running) return;
    setErr(null);
    try {
      const j = await (await fetch("/api/idea-engine/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: text }),
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
              { key: "kimiModel", label: "Sizing seat (Ollama Cloud)", placeholder: "kimi-k2.6", hint: "Evidence-only sizing; falls back to codex if unreachable." },
              { key: "redditSubs", label: "Radar: reddit subs", placeholder: "smallbusiness,Entrepreneur,SaaS", hint: "Comma-separated — pain mining sources (Phase 2)." },
              { key: "seedTerms", label: "Radar: seed terms", placeholder: "ai automation,revops", hint: "Trends + autocomplete seeds (Phase 2)." },
            ]} />
        </div>
      </div>
      <p className="text-sm text-white/45 mb-4">
        Type an idea (or a trend, or a hunch). The council mines real pain evidence, maps the market, sizes it honestly,
        tries to kill it, and writes the dossier. Unsourced numbers are dropped in code — gaps say so.
      </p>

      {/* Validate input */}
      <div className="flex gap-2 mb-5">
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={2}
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
            <span className="text-[11px] text-white/40 ml-auto truncate max-w-[50%]">{run.idea}</span>
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
            <button key={d.id} onClick={() => setOpenId(d.id)}
              className="w-full text-left panel p-3 flex items-center gap-3 hover:brightness-110 transition">
              <span className="text-[10px] font-mono font-bold px-2 py-1 rounded" style={{ background: `${v.color}22`, color: v.color }}>{v.label}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{d.identity?.title}</div>
                <div className="text-[11.5px] text-white/50 truncate">{d.identity?.one_liner}</div>
              </div>
              {typeof opp === "number" && <span className="text-[11px] font-mono text-white/50 shrink-0">opp {opp}/10</span>}
              <span className="text-[10.5px] text-white/35 shrink-0">{(d.generated_at || "").slice(0, 10)}</span>
              <ChevronRight size={13} className="text-white/30 shrink-0" />
            </button>
          );
        })}
      </div>

      {openId && <DossierDrawer id={openId} onClose={() => setOpenId(null)} />}
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
