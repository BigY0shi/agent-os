"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2, Play, Square, Stethoscope, RefreshCw, FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import OpenMontageSettings from "./OpenMontageSettings";

const ACCENT = "#f97316";

interface Check { ok: boolean; label: string; detail: string; fix?: string }
interface Pipeline { id: string; name: string; version: string; description: string; category: string; stability: string; budgetUsd: number | null; stages: string[] }
interface OutputFile { path: string; rel: string; bytes: number; mtime: number }
interface Project { id: string; dir: string; mtime: number; stages: string[]; outputs: OutputFile[] }
interface Config { repoPath: string; pythonBin: string; outputDir: string; agent: string; fallbackAgent: string; timeoutMin: number }
interface Loaded {
  ok: boolean; error?: string; fix?: string | null; config: Config;
  doctor?: { ok: boolean; checks: Check[] }; pipelines?: Pipeline[]; broken?: { file: string; error: string }[]; projects?: Project[];
}
interface Run {
  id: string; label: string; status: "running" | "done" | "error" | "lost" | "stopped"; error?: string;
  events: { at: number; text: string }[];
  result?: { projectId: string; projectDir: string; agent: string; fellBackFrom: string | null; fallbackReason: string | null; outputs: OutputFile[]; stages: string[] } | null;
}

function fmtBytes(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`; }
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter(Boolean).slice(0, 4).join("-"); }
function todayStamp() { return new Date().toISOString().slice(0, 10).replace(/-/g, ""); }

export default function OpenMontageStudio() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectEdited, setProjectEdited] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ error: string; fix?: string | null } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [preflight, setPreflight] = useState<{ busy: boolean; text?: string; error?: string; fix?: string | null }>({ busy: false });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/openmontage", { cache: "no-store" });
      const j = (await r.json()) as Loaded;
      setData(j);
      if (j.ok && j.pipelines?.length && !j.pipelines.some((p) => p.id === pipeline)) setPipeline(j.pipelines[0].id);
    } catch (e) {
      setData({ ok: false, error: `could not reach /api/openmontage: ${String(e)}`, config: { repoPath: "", pythonBin: "", outputDir: "", agent: "", fallbackAgent: "", timeoutMin: 0 } });
    } finally { setLoading(false); }
  }, [pipeline]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!projectEdited) setProjectId(brief.trim() ? `${slug(brief) || "project"}-${todayStamp()}` : "");
  }, [brief, projectEdited]);

  // Poll the module run while it is in flight; the tray shows the same events.
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!run || run.status !== "running") return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/runs/${run.id}`, { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; run?: Run };
        if (j.ok && j.run) {
          setRun(j.run);
          if (j.run.status !== "running") load();
        }
      } catch { /* next tick */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [run, load]);

  async function start() {
    if (starting || !pipeline || !brief.trim()) return;
    setStarting(true); setStartError(null); setRun(null);
    try {
      const r = await fetch("/api/openmontage/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pipeline, brief, projectId: projectId || undefined }) });
      const j = (await r.json()) as { ok: boolean; runId?: string; error?: string; fix?: string | null };
      if (!j.ok || !j.runId) { setStartError({ error: j.error || `HTTP ${r.status}`, fix: j.fix }); return; }
      const rr = await fetch(`/api/runs/${j.runId}`, { cache: "no-store" });
      const rj = (await rr.json()) as { ok: boolean; run?: Run };
      setRun(rj.run ?? { id: j.runId, label: "", status: "running", events: [] });
    } catch (e) {
      setStartError({ error: String(e) });
    } finally { setStarting(false); }
  }

  async function stop() {
    if (!run) return;
    await fetch(`/api/runs/${run.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) }).catch(() => {});
  }

  async function runPreflight() {
    setPreflight({ busy: true });
    try {
      const r = await fetch("/api/openmontage/preflight", { method: "POST" });
      const j = (await r.json()) as { ok: boolean; text?: string; error?: string; fix?: string | null };
      setPreflight(j.ok ? { busy: false, text: j.text } : { busy: false, error: j.error || `HTTP ${r.status}`, fix: j.fix });
    } catch (e) { setPreflight({ busy: false, error: String(e) }); }
  }

  const doctorOk = !!data?.ok && !!data.doctor?.ok;
  const selected = data?.pipelines?.find((p) => p.id === pipeline) ?? null;
  const canRun = !!data?.ok && !!selected && brief.trim().length > 0 && !starting && (!run || run.status !== "running");

  return (
    <div className="space-y-5">
      {/* status strip + gear */}
      <div className="panel p-3 flex flex-wrap items-center gap-2">
        <Clapperboard size={16} style={{ color: ACCENT }} />
        <span className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>Environment</span>
        {loading && !data ? <Loader2 size={14} className="animate-spin" style={{ color: "var(--fg-dim)" }} /> : null}
        {data?.doctor?.checks.map((c) => (
          <span key={c.label} title={c.detail} className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px]"
            style={{ border: `1px solid ${c.ok ? "rgba(52,211,153,0.5)" : "rgba(239,68,68,0.6)"}`, color: c.ok ? "#34d399" : "#f87171" }}>
            {c.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}{c.label}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="h-8 px-2 rounded-lg text-[12px] inline-flex items-center gap-1 transition hover:brightness-125" style={{ border: "1px solid var(--line-soft)", color: "var(--fg-dim)" }} aria-label="Reload"><RefreshCw size={12} /></button>
          <button onClick={runPreflight} disabled={preflight.busy || !data?.ok} className="h-8 px-3 rounded-lg text-[12px] inline-flex items-center gap-1 transition hover:brightness-125 disabled:opacity-50" style={{ border: `1px solid ${ACCENT}66`, color: "var(--fg)" }}>
            {preflight.busy ? <Loader2 size={12} className="animate-spin" /> : <Stethoscope size={12} />} Preflight
          </button>
          <OpenMontageSettings defaults={data ? { repoPath: data.config.repoPath, outputDir: data.config.outputDir } : undefined} />
        </div>
      </div>

      {/* the one error that blocks everything: no checkout */}
      {data && !data.ok ? (
        <div className="panel p-4 space-y-2" style={{ borderColor: "rgba(239,68,68,0.5)" }}>
          <div className="text-[13px] font-medium" style={{ color: "#f87171" }}>{data.error}</div>
          {data.fix ? <pre className="text-[11.5px] p-2 rounded overflow-x-auto" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>{data.fix}</pre> : null}
          <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>Then Reload. The repo path is in the gear.</div>
        </div>
      ) : null}

      {/* failed checks with their fixes (the list still renders) */}
      {data?.ok && data.doctor && !data.doctor.ok ? (
        <div className="panel p-4 space-y-2" style={{ borderColor: "rgba(239,68,68,0.5)" }}>
          {data.doctor.checks.filter((c) => !c.ok).map((c) => (
            <div key={c.label}>
              <div className="text-[12.5px]" style={{ color: "#f87171" }}><b>{c.label}:</b> {c.detail}</div>
              {c.fix ? <pre className="text-[11.5px] mt-1 p-2 rounded overflow-x-auto" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>{c.fix}</pre> : null}
            </div>
          ))}
          <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>Run the fix yourself, then Reload. Nothing is installed from this page.</div>
        </div>
      ) : null}

      {preflight.text || preflight.error ? (
        <div className="panel p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>Preflight: tool registry</div>
          {preflight.error ? <div className="text-[12.5px]" style={{ color: "#f87171" }}>{preflight.error}</div> : null}
          {preflight.fix ? <pre className="text-[11.5px] p-2 rounded overflow-x-auto" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>{preflight.fix}</pre> : null}
          {preflight.text ? <pre className="text-[11px] p-2 rounded overflow-auto max-h-[320px]" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>{preflight.text}</pre> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
        {/* pipelines */}
        <div className="panel p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>1 · Pipeline <span style={{ color: "var(--fg-dimmer)" }}>· from pipeline_defs/</span></div>
          {data?.ok && data.pipelines?.length === 0 ? <div className="text-[12.5px]" style={{ color: "var(--fg-dim)" }}>No manifests in {data.config.repoPath}/pipeline_defs.</div> : null}
          <div className="space-y-1.5">
            {data?.pipelines?.map((p) => (
              <button key={p.id} onClick={() => setPipeline(p.id)} className="w-full text-left rounded-lg p-2.5 transition hover:brightness-110"
                style={pipeline === p.id ? { background: `${ACCENT}18`, border: `1px solid ${ACCENT}` } : { border: "1px solid var(--line-soft)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>{p.name}</span>
                  <span className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--fg-dimmer)" }}>{p.category}{p.stability ? ` · ${p.stability}` : ""}</span>
                </div>
                {p.description ? <div className="text-[11.5px] mt-0.5 line-clamp-2" style={{ color: "var(--fg-dim)" }}>{p.description}</div> : null}
                <div className="text-[10.5px] mt-1" style={{ color: "var(--fg-dimmer)" }}>{p.stages.length} stages{p.budgetUsd != null ? ` · default budget $${p.budgetUsd.toFixed(2)}` : ""}</div>
              </button>
            ))}
          </div>
          {data?.broken?.length ? (
            <div className="text-[11.5px]" style={{ color: "#f87171" }}>Could not parse: {data.broken.map((b) => `${b.file} (${b.error})`).join("; ")}</div>
          ) : null}
        </div>

        {/* brief + run */}
        <div className="space-y-5">
          <div className="panel p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>2 · Brief</div>
            {selected ? <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>Stages: {selected.stages.join(" → ") || "(none listed)"}</div> : null}
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder="Make a 60-second animated explainer about how neural networks learn, calm narration, flat motion graphics."
              className="w-full rounded-lg p-3 text-[13px] outline-none" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--line-soft)", color: "var(--fg)" }} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11.5px]" style={{ color: "var(--fg-dim)" }}>Project id</label>
              <input value={projectId} onChange={(e) => { setProjectEdited(true); setProjectId(e.target.value); }} placeholder="auto from the brief"
                className="h-8 px-2 rounded-lg text-[12px] outline-none flex-1 min-w-[200px]" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--line-soft)", color: "var(--fg)" }} />
              <button onClick={start} disabled={!canRun} className="h-9 px-4 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition hover:brightness-110 disabled:opacity-50"
                style={{ background: ACCENT, color: "#1a0d05" }}>
                {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run pipeline
              </button>
            </div>
            <div className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
              {data?.ok ? `${data.config.agent} runs inside ${data.config.repoPath}; the project lands in ${data.config.outputDir}. ${doctorOk ? "" : "Fix the checks above first."}` : ""}
            </div>
            {startError ? (
              <div className="space-y-1">
                <div className="text-[12.5px]" style={{ color: "#f87171" }}>{startError.error}</div>
                {startError.fix ? <pre className="text-[11.5px] p-2 rounded overflow-x-auto" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>{startError.fix}</pre> : null}
              </div>
            ) : null}
          </div>

          {run ? (
            <div className="panel p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>3 · Run</div>
                <span className="text-[11px] px-2 h-5 inline-flex items-center rounded-full" style={{ border: "1px solid var(--line-soft)", color: run.status === "error" || run.status === "lost" ? "#f87171" : run.status === "done" ? "#34d399" : "var(--fg-dim)" }}>
                  {run.status === "running" ? <Loader2 size={10} className="animate-spin mr-1" /> : null}{run.status}
                </span>
                <span className="text-[11.5px] truncate" style={{ color: "var(--fg-dim)" }}>{run.label}</span>
                {run.status === "running" ? (
                  <button onClick={stop} className="ml-auto h-7 px-2.5 rounded-lg text-[11.5px] inline-flex items-center gap-1" style={{ border: "1px solid rgba(239,68,68,0.6)", color: "#f87171" }}><Square size={10} /> STOP</button>
                ) : null}
              </div>
              {run.error ? <div className="text-[12.5px]" style={{ color: "#f87171" }}>{run.error}</div> : null}
              {run.result?.fellBackFrom ? (
                <div className="text-[12px]" style={{ color: "#fbbf24" }}>Ran on {run.result.agent} instead of {run.result.fellBackFrom}: {run.result.fallbackReason}</div>
              ) : null}
              <pre className="text-[11px] p-2 rounded overflow-auto max-h-[260px] whitespace-pre-wrap" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)" }}>
                {run.events.length ? run.events.map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.text}`).join("\n") : "waiting for the first line..."}
              </pre>
              {run.result ? (
                <div className="space-y-1">
                  <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>{run.result.projectDir} · checkpoints: {run.result.stages.join(", ") || "none"}</div>
                  {run.result.outputs.length ? run.result.outputs.map((f) => (
                    <div key={f.path} className="text-[12px] flex items-center gap-2" style={{ color: "var(--fg)" }}><FolderOpen size={11} style={{ color: ACCENT }} />{f.rel} <span style={{ color: "var(--fg-dimmer)" }}>{fmtBytes(f.bytes)}</span></div>
                  )) : <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>No rendered files in the project folder.</div>}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* projects on disk */}
      {data?.ok ? (
        <div className="panel p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: ACCENT }}>Projects <span style={{ color: "var(--fg-dimmer)" }}>· {data.config.outputDir}</span></div>
          {data.projects?.length ? data.projects.map((p) => (
            <div key={p.id} className="rounded-lg p-2.5" style={{ border: "1px solid var(--line-soft)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium" style={{ color: "var(--fg)" }}>{p.id}</span>
                <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>{new Date(p.mtime).toLocaleString()} · {p.stages.length} checkpoint(s)</span>
              </div>
              {p.outputs.length ? (
                <div className="mt-1 space-y-0.5">
                  {p.outputs.map((f) => <div key={f.path} className="text-[11.5px]" style={{ color: "var(--fg-dim)" }}>{f.rel} <span style={{ color: "var(--fg-dimmer)" }}>{fmtBytes(f.bytes)}</span></div>)}
                </div>
              ) : <div className="text-[11.5px] mt-1" style={{ color: "var(--fg-dimmer)" }}>no rendered files yet</div>}
            </div>
          )) : <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>No projects yet. The first run creates one.</div>}
        </div>
      ) : null}
    </div>
  );
}
