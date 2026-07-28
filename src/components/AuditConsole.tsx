"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Radar, Play, Loader2, FlaskConical, FileText, ExternalLink, RefreshCw, AlertTriangle,
} from "lucide-react";

// Audit Console — start and watch Business Audit Engine runs (feat-004).
// The engine is standalone; this page shells to its CLI through /api/audit/* and never
// stores audit state on this side. Long jobs follow the Deal Desk scrape pattern:
// POST starts, GET polls, and the poller re-attaches on mount so a reload mid-run
// simply resumes watching.

interface EngineClient {
  slug: string;
  business_name: string | null;
  state: string;
  stage: string | null;
  intake_ok: boolean;
}

interface Job {
  stage: "idle" | "running" | "done" | "failed";
  action: string | null;
  slug: string | null;
  passes: number | null;
  error: string | null;
  result: unknown;
  tail: string[];
  running?: boolean;
  elapsedMs: number;
}

interface EngineStatus {
  state?: string;
  stage?: string | null;
  target_passes?: number | null;
  passes?: { pass: number; state: string; stage: string }[];
  agents?: Record<string, { status: string; validation: string; warnings: number }>;
  intake?: { ok: boolean };
}

const stateColor = (s: string | undefined) =>
  s === "COMPLETE" ? "#34d399" : s === "RUNNING" ? "#22d3ee" : s === "HELD" || s === "BLOCKED" ? "#f87171" : "#94a3b8";

const agentColor = (s: string) =>
  s === "COMPLETE" ? "#34d399" : s === "DEGRADED_COMPLETE" ? "#fbbf24" : s === "FAILED" || s === "BLOCKED" ? "#f87171" : "#94a3b8";

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function AuditConsole() {
  const [clients, setClients] = useState<EngineClient[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [passes, setPasses] = useState(3);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadClients = useCallback(async () => {
    try {
      const j = await (await fetch("/api/audit")).json();
      if (j.ok) setClients(j.clients);
      else setErr(j.error || "Engine unreachable");
      if (j.job) setJob(j.job);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, []);

  const poll = useCallback(async (slug?: string) => {
    try {
      const q = slug ? `?slug=${encodeURIComponent(slug)}` : "";
      const j = await (await fetch(`/api/audit/run${q}`)).json();
      if (j.ok) { setJob(j.job); setEngine(j.engine); }
    } catch { /* transient poll failure — the next tick retries */ }
  }, []);

  // Re-attach on mount: if a run was started before a reload, the first poll finds it.
  useEffect(() => { void loadClients(); void poll(); }, [loadClients, poll]);

  // Poll while a job runs; refresh the client list when it settles.
  useEffect(() => {
    if (job?.stage === "running") {
      if (!timer.current) {
        timer.current = setInterval(() => void poll(job.slug ?? undefined), 5000);
      }
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      void loadClients();
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [job?.stage, job?.slug, poll, loadClients]);

  async function start(action: "run" | "distill" | "warroom", slug: string) {
    setErr("");
    try {
      const j = await (await fetch("/api/audit/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, slug, passes: action === "run" ? passes : undefined }),
      })).json();
      if (!j.ok) { setErr(j.error || "Could not start"); return; }
      setSelected(slug);
      void poll(slug);
    } catch (e) { setErr((e as Error).message); }
  }

  const running = job?.stage === "running";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Radar size={20} style={{ color: "#34d399" }} />
        <h1 className="text-xl font-semibold">Audit Console</h1>
        <button onClick={() => { setLoading(true); void loadClients(); }}
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md border border-white/10 text-white/60 hover:text-white/90 transition">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p className="text-[13px] text-white/50 mb-5">
        Business Audit Engine, watched from here, owned by nobody but itself. Runs execute in the
        engine folder; this page only starts them and reads the state back.
      </p>

      {err && (
        <div className="panel p-3 mb-4 flex items-center gap-2 text-[13px]" style={{ borderLeft: "3px solid #f87171" }}>
          <AlertTriangle size={14} style={{ color: "#f87171" }} /> {err}
        </div>
      )}

      {/* Live job panel */}
      {job && job.stage !== "idle" && (
        <div className="panel p-4 mb-5" style={{ borderLeft: `3px solid ${running ? "#22d3ee" : job.stage === "done" ? "#34d399" : "#f87171"}` }}>
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {running ? <Loader2 size={14} className="animate-spin" style={{ color: "#22d3ee" }} /> : null}
            <span className="uppercase tracking-wide text-[11px] text-white/45">{job.action}</span>
            <span>{job.slug}</span>
            {job.passes ? <span className="text-white/45">· {job.passes} passes</span> : null}
            <span className="ml-auto font-mono text-[11px] text-white/40">{fmtElapsed(job.elapsedMs)} · {job.stage}</span>
          </div>
          {job.error && <div className="text-[12px] mt-2" style={{ color: "#f87171" }}>{job.error}</div>}

          {engine?.agents && Object.keys(engine.agents).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Object.entries(engine.agents).map(([id, a]) => (
                <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.06)", color: agentColor(a.status) }}
                  title={`validation ${a.validation} · ${a.warnings} warnings`}>
                  {id} {a.status}
                </span>
              ))}
            </div>
          )}
          {engine?.passes && engine.passes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {engine.passes.map((p) => (
                <span key={p.pass} className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.06)", color: stateColor(p.state) }}>
                  pass {p.pass} · {p.state} @ {p.stage}
                </span>
              ))}
            </div>
          )}
          {job.tail.length > 0 && (
            <pre className="text-[10.5px] font-mono text-white/40 mt-3 mb-0 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {job.tail.join("\n")}
            </pre>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="panel p-3 mb-4 flex items-center gap-3 text-[13px]">
        <span className="text-white/50">Ensemble passes</span>
        <input type="number" min={1} max={6} value={passes}
          onChange={(e) => setPasses(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
          className="w-14 bg-black/30 border border-white/10 rounded px-2 py-1 text-[13px] outline-none focus:border-emerald-500/60" />
        <span className="text-[11px] text-white/35">
          Cross-pass agreement is the confidence signal. 3 is the default; each pass is a full agent chain.
        </span>
      </div>

      {/* Clients */}
      {loading ? (
        <div className="flex items-center gap-2 text-white/50 text-[13px]"><Loader2 size={14} className="animate-spin" /> Reading the engine…</div>
      ) : clients.length === 0 ? (
        <div className="panel p-4 text-[13px] text-white/50">
          No clients in the engine yet. Scaffold one in the engine folder: <span className="font-mono text-white/70">node cli.mjs new &lt;slug&gt;</span>, fill the brief, then run it from here.
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-white/35 border-b border-white/10">
                <th className="text-left px-4 py-2.5 font-medium">Client</th>
                <th className="text-left px-4 py-2.5 font-medium">State</th>
                <th className="text-left px-4 py-2.5 font-medium">Stage</th>
                <th className="text-left px-4 py-2.5 font-medium">Brief</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.slug} className={`border-b border-white/5 hover:bg-white/[0.03] transition ${selected === c.slug ? "bg-white/[0.04]" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{c.business_name || c.slug}</div>
                    <div className="text-[11px] font-mono text-white/35">{c.slug}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: stateColor(c.state) }}>{c.state}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-white/50">{c.stage ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[11px]" style={{ color: c.intake_ok ? "#34d399" : "#f87171" }}>
                    {c.intake_ok ? "ready" : "incomplete"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button disabled={running || !c.intake_ok} onClick={() => void start("run", c.slug)}
                        title={c.intake_ok ? `Run Machine 1 (${passes} passes)` : "Fill the client brief first"}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition disabled:opacity-35 disabled:cursor-not-allowed">
                        <Play size={11} /> Audit
                      </button>
                      <button disabled={running} onClick={() => void start("distill", c.slug)}
                        title="Machine 2: judge-merged 9-file packet"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/5 transition disabled:opacity-35 disabled:cursor-not-allowed">
                        <FlaskConical size={11} /> Distill
                      </button>
                      <button disabled={running} onClick={() => void start("warroom", c.slug)}
                        title="Generate the client readout from the packet"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/5 transition disabled:opacity-35 disabled:cursor-not-allowed">
                        <FileText size={11} /> War Room
                      </button>
                      <a href={`/api/audit/warroom?slug=${encodeURIComponent(c.slug)}`} target="_blank" rel="noreferrer"
                        title="Open the generated readout"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/5 transition">
                        <ExternalLink size={11} /> View
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
