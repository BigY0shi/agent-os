"use client";

// S18 Mission Control cockpit (_design/jarvis-v3-plan.md; the owner liked how NEXORA
// presents telemetry). Information on first load: a telemetry band under the greeting,
// and a full System pulse view. Every number comes from /api/v2/home/pulse, which reads
// real sources; the basis of each number is printed next to it, and anything without a
// source is shown as unknown, never estimated.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import AgentAvatar from "@/components/AgentAvatar";
import { SnapshotsCard } from "./SnapshotsCard";

interface Pulse {
  sampledAt: string;
  host: null | {
    hostname: string; platform: string; release: string; uptimeSec: number; loadavg: [number, number, number] | null;
    cpu: { percent: number; perCore: number[]; cores: number; model: string };
    memory: { totalBytes: number; freeBytes: number; usedPercent: number };
    disks: { mount: string; totalBytes: number; freeBytes: number; usedPercent: number }[];
  };
  services: { id: string; name: string; state: "ok" | "down" | "not-configured"; ms: number | null; detail: string; optional?: boolean }[];
  checks: null | { items: { id: string; label: string; ok: boolean; detail: string }[]; clear: number; total: number; status: "optimal" | "strain" | "needs-a-look" };
  runs: { window: string; total: number; running: number; finished: number; succeeded: number; failed: number; successRate: number | null; avgMs: number | null; spark: number[]; byModule: { module: string; running: number }[] };
  missions: { queued: number; running: number; review: number; parked: number; delivered: number; waitingOnYou: number; agentsAtWork: number };
  agents: { id: string; name: string; status: "running" | "idle" | "waiting" | "error" | "offline"; detail: string | null }[];
  seatLoad: { agent: string; running: number }[];
  processes?: null | { byCpu: Proc[]; byMemory: Proc[]; windowMs: number; cpuScope: string; sampledAt: string };
  history?: null | { samples: { at: number; cpu: number; mem: number; disk: number | null; netBps: number | null }[]; intervalMs: number; shapes: Record<"cpu" | "mem" | "disk" | "net", "flat" | "spiky" | "bursty" | "steady" | "unknown"> };
  drives?: null | { mount: string; totalBytes: number; freeBytes: number; usedPercent: number }[];
  errors: Record<string, string>;
}
interface Proc { pid: number; name: string; cpuPercent: number; memBytes: number }

const STATUS: Record<"optimal" | "strain" | "needs-a-look", [string, string]> = {
  optimal: ["Optimal", "#34d399"], strain: ["Under strain", "#fbbf24"], "needs-a-look": ["Needs a look", "#f87171"],
};
const AGENT_TINT: Record<string, string> = { running: "#3b95ff", idle: "#34d399", waiting: "#fbbf24", error: "#f87171", offline: "#64748b" };
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : `${(b / 1e9).toFixed(1)} GB`);
const dur = (ms: number | null) => (ms == null ? "–" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`);

export function usePulse(processes: boolean, history = false) {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const qs = [processes ? "processes=1" : "", history ? "history=1" : ""].filter(Boolean).join("&");
      const r = await fetch(`/api/v2/home/pulse${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `pulse failed (${r.status})`);
      setPulse(j as Pulse); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [processes, history]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, history ? 5_000 : processes ? 15_000 : 10_000);
    return () => clearInterval(t);
  }, [load, processes, history]);
  return { pulse, err, busy, reload: load };
}

function Bar({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  const tint = pct == null ? "#64748b" : pct > 90 ? "#f87171" : pct > 75 ? "#fbbf24" : "#3b95ff";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-[var(--fg-dim)]">{label}</span>
        <span className="type-figure">{pct == null ? "unknown" : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full glass-inset" aria-hidden>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct ?? 0}%`, background: `linear-gradient(90deg, #8b5cf6, ${tint})` }} />
      </div>
      <div className="mt-0.5 text-[10.5px] text-[var(--fg-dimmer)]">{detail}</div>
    </div>
  );
}

function Ring({ pct, center, sub, size = 92 }: { pct: number | null; center: string; sub: string; size?: number }) {
  const R = size / 2 - 7, C = 2 * Math.PI * R;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${center} ${sub}`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        {pct != null && <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} />}
        <defs><linearGradient id="ringGrad" x1="0" x2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#3b95ff" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="type-figure text-[18px] leading-none">{center}</div><div className="mt-0.5 text-[9.5px] text-[var(--fg-dimmer)]">{sub}</div></div>
      </div>
    </div>
  );
}

/** The telemetry band that sits under the greeting: information on first load. */
export function CockpitBand() {
  const { pulse, err } = usePulse(false);
  if (err && !pulse) return <p role="alert" className="text-[12.5px] text-red-300">Telemetry unavailable: {err}</p>;
  if (!pulse) return <div className="glass flex items-center gap-2 px-5 py-4 text-[12.5px] text-[var(--fg-dimmer)]"><Loader2 size={13} className="animate-spin" /> Measuring…</div>;
  const h = pulse.host;
  const status = pulse.checks ? STATUS[pulse.checks.status] : null;
  const disk = h?.disks[0];
  const loads = [
    ...pulse.agents.map((a) => ({ key: `a:${a.id}`, markId: a.id as string | null, name: a.name, tint: AGENT_TINT[a.status] ?? "#64748b", label: a.status, load: a.status === "running" ? 1 : 0 })),
    ...pulse.seatLoad.map((s) => ({ key: `s:${s.agent}`, markId: null as string | null, name: `${s.agent} (mission seats)`, tint: AGENT_TINT.running, label: `${s.running} running`, load: s.running })),
  ];
  const maxLoad = Math.max(1, ...loads.map((l) => l.load));
  return (
    <section aria-label="Cockpit telemetry" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-cockpit>
      <div className="glass px-5 py-4">
        <div className="glass-eyebrow">System pulse</div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="type-display text-[20px] leading-none" style={{ color: status?.[1] }}>{status?.[0] ?? "Unknown"}</span>
          {pulse.checks && <span className="text-[11px] text-[var(--fg-dimmer)]">{pulse.checks.clear} of {pulse.checks.total} checks clear</span>}
        </div>
        <div className="mt-3 space-y-2">
          <Bar label="Processor" pct={h ? h.cpu.percent : null} detail={h ? `${h.cpu.cores} cores, sampled over 0.4 s` : "not measured"} />
          <Bar label="Memory" pct={h ? Math.round(h.memory.usedPercent) : null} detail={h ? `${gb(h.memory.totalBytes - h.memory.freeBytes)} of ${gb(h.memory.totalBytes)}` : "not measured"} />
          <Bar label={`Disk ${disk?.mount ?? ""}`} pct={disk ? Math.round(disk.usedPercent) : null} detail={disk ? `${gb(disk.freeBytes)} free` : "not measured"} />
        </div>
      </div>

      <div className="glass px-5 py-4">
        <div className="glass-eyebrow">Runs</div>
        <div className="mt-2 flex items-center gap-4">
          <Ring pct={pulse.runs.successRate} center={String(pulse.runs.total)} sub={pulse.runs.successRate == null ? "runs" : `${pulse.runs.successRate}% ok`} />
          <div className="min-w-0 space-y-1 text-[11.5px]">
            <div><span className="type-figure">{pulse.runs.running}</span> <span className="text-[var(--fg-dim)]">running now</span></div>
            <div><span className="type-figure">{dur(pulse.runs.avgMs)}</span> <span className="text-[var(--fg-dim)]">average run</span></div>
            <div className="flex gap-[3px] pt-1" aria-label="Last finished runs, oldest to newest">
              {pulse.runs.spark.length === 0 && <span className="text-[10.5px] text-[var(--fg-dimmer)]">no finished runs yet</span>}
              {pulse.runs.spark.map((v, i) => <span key={i} className="h-3.5 w-1.5 rounded-sm" title={v === 1 ? "done" : v === -1 ? "stopped" : "failed"} style={{ background: v === 1 ? "#34d399" : v === -1 ? "#64748b" : "#f87171", opacity: 0.5 + (i / pulse.runs.spark.length) * 0.5 }} />)}
            </div>
          </div>
        </div>
        <div className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">Counted over {pulse.runs.window}.</div>
      </div>

      <div className="glass px-5 py-4">
        <div className="glass-eyebrow flex items-center justify-between">Missions<Link href="/jarvis?tab=goals" className="normal-case tracking-normal text-[11px] text-[#3b95ff] hover:underline">Open</Link></div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([["Queued", pulse.missions.queued, "#a78bfa"], ["Running", pulse.missions.running, "#3b95ff"], ["Review", pulse.missions.review, "#fbbf24"], ["Parked", pulse.missions.parked, "#94a3b8"]] as const).map(([k, v, c]) => (
            <div key={k} className="rounded-xl px-3 py-2 glass-inset">
              <div className="text-[10.5px] text-[var(--fg-dimmer)]">{k}</div>
              <div className="type-figure text-[20px] leading-none" style={{ color: v ? c : undefined }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-[var(--fg-dim)]">{pulse.missions.waitingOnYou ? `${pulse.missions.waitingOnYou} waiting on you` : "Nothing waiting on you"} · {pulse.missions.delivered} delivered</div>
      </div>

      <div className="glass px-5 py-4">
        <div className="glass-eyebrow">Orchestration</div>
        <div className="mt-2 flex items-center gap-2 text-[12.5px]">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#8b5cf6", boxShadow: "0 0 8px #8b5cf6" }} aria-hidden /> Jarvis
          <span className="text-[10.5px] text-[var(--fg-dimmer)]">{loads.length} under him</span>
        </div>
        <ul className="mt-2 max-h-[132px] space-y-1.5 overflow-y-auto border-l border-white/10 pl-3">
          {loads.length === 0 && <li className="text-[11.5px] text-[var(--fg-dimmer)]">No agents configured.</li>}
          {loads.map((l) => (
            <li key={l.key} className="text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">{l.markId ? <AgentAvatar agent={l.markId} name={l.name} size={16} /> : null}<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: l.tint }} aria-hidden /><span className="truncate">{l.name}</span></span>
                <span className="shrink-0 text-[10.5px] text-[var(--fg-dimmer)]">{l.label}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full glass-inset" aria-hidden><div className="h-full rounded-full" style={{ width: `${(l.load / maxLoad) * 100}%`, background: l.tint }} /></div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** S27 Health (was the S18 System pulse view): the machine in plain words, with history. */
const AGENT_PROC = /^(claude|hermes|codex|agy|antigravity|openclaw|ollama|cursor-agent|kimi)(\.exe)?$/i;
const SHAPE_NOTE: Record<string, string> = { flat: "flat", spiky: "spiky", bursty: "bursty", steady: "steady", unknown: "gathering…" };
const bps = (n: number | null) => (n == null ? "unknown" : n < 1024 ? `${n} B/s` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB/s` : `${(n / 1_048_576).toFixed(1)} MB/s`);

function Spark({ label, values, shape, now, fmt }: { label: string; values: (number | null)[]; shape: string; now: string; fmt?: (v: number) => string }) {
  const xs = values.filter((v): v is number => v != null);
  const W = 240, Hh = 44;
  const max = Math.max(1, ...xs), min = fmt ? 0 : 0;
  const pts = xs.map((v, i) => `${xs.length > 1 ? (i / (xs.length - 1)) * W : W / 2},${Hh - ((v - min) / (max - min || 1)) * (Hh - 4) - 2}`).join(" ");
  return (
    <div className="glass px-4 py-3">
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="glass-eyebrow">{label}</span>
        <span className="text-[10.5px] text-[var(--fg-dimmer)]">{SHAPE_NOTE[shape] ?? shape}</span>
      </div>
      <div className="type-figure mt-1 text-[20px] leading-none">{now}</div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-2 h-11 w-full" preserveAspectRatio="none" aria-label={`${label}, last ${xs.length} samples, ${SHAPE_NOTE[shape] ?? shape}`}>
        {xs.length > 1 && <polyline points={pts} fill="none" stroke="url(#sparkGrad)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        <defs><linearGradient id="sparkGrad" x1="0" x2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#3b95ff" /></linearGradient></defs>
      </svg>
    </div>
  );
}

export function SystemPulse() {
  const { pulse, err, busy, reload } = usePulse(true, true);
  const [procFilter, setProcFilter] = useState<"all" | "agents">("all");
  if (err && !pulse) return <p role="alert" className="text-[12.5px] text-red-300">Health unavailable: {err}</p>;
  if (!pulse) return <div className="glass flex items-center gap-2 px-5 py-4 text-[12.5px] text-[var(--fg-dimmer)]"><Loader2 size={13} className="animate-spin" /> Measuring the machine…</div>;
  const h = pulse.host;
  const checks = pulse.checks;
  const failing = checks?.items.filter((c) => !c.ok) ?? [];
  const headline = !checks ? "Health checks are unavailable" : failing.length === 0 ? "The machine is quiet and well" : `${failing.length} thing${failing.length === 1 ? " needs" : "s need"} a look: ${failing.map((c) => c.label.toLowerCase()).join(", ")}`;
  const tint = !checks ? "var(--fg-dim)" : failing.length === 0 ? "#34d399" : failing.length === 1 ? "#fbbf24" : "#f87171";
  const hist = pulse.history;
  const last = hist?.samples.at(-1);
  const procs = pulse.processes;
  const cpuList = (procs?.byCpu ?? []).filter((p) => procFilter === "all" || AGENT_PROC.test(p.name));
  const memList = (procs?.byMemory ?? []).filter((p) => procFilter === "all" || AGENT_PROC.test(p.name));
  const upH = h ? Math.floor(h.uptimeSec / 3600) : 0;
  return (
    <div className="space-y-3" data-system-pulse data-health>
      <section className="glass-strong flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-5">
          <Ring pct={checks ? Math.round((checks.clear / Math.max(1, checks.total)) * 100) : null} center={checks ? `${checks.clear}/${checks.total}` : "?"} sub="checks clear" />
          <div>
            <div className="glass-eyebrow">Health</div>
            <div className="type-display mt-1 text-[24px] leading-tight" style={{ color: tint }}>{headline}</div>
            <div className="mt-1 text-[11.5px] text-[var(--fg-dimmer)]">Measured {new Date(pulse.sampledAt).toLocaleTimeString()}; history every {Math.round((hist?.intervalMs ?? 5000) / 1000)} s while this page is open.</div>
          </div>
        </div>
        <button type="button" onClick={() => void reload()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Measure again
        </button>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="glass px-5 py-4 lg:col-span-1">
          <div className="glass-eyebrow">This machine</div>
          {h ? (
            <dl className="mt-2 grid grid-cols-[88px_1fr] gap-y-1 text-[12px]">
              <dt className="text-[var(--fg-dimmer)]">Host</dt><dd className="truncate">{h.hostname}</dd>
              <dt className="text-[var(--fg-dimmer)]">System</dt><dd className="truncate">{h.platform}</dd>
              <dt className="text-[var(--fg-dimmer)]">Kernel</dt><dd className="truncate">{h.release}</dd>
              <dt className="text-[var(--fg-dimmer)]">Processor</dt><dd className="truncate" title={h.cpu.model}>{h.cpu.cores} cores · {h.cpu.model}</dd>
              <dt className="text-[var(--fg-dimmer)]">Uptime</dt><dd>{upH >= 24 ? `${Math.floor(upH / 24)} d ${upH % 24} h` : `${upH} h`}</dd>
              <dt className="text-[var(--fg-dimmer)]">Storage</dt><dd>{pulse.drives?.length ?? h.disks.length} drive{(pulse.drives?.length ?? h.disks.length) === 1 ? "" : "s"}</dd>
            </dl>
          ) : <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Not measured.</p>}
        </section>
        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Load, 1 / 5 / 15 min</div>
          {h?.loadavg ? (
            <div className="mt-2 space-y-2">{h.loadavg.map((v, i) => <Bar key={i} label={["1 min", "5 min", "15 min"][i]} pct={Math.min(100, Math.round((v / Math.max(1, h.cpu.cores)) * 100))} detail={`${v.toFixed(2)} runnable per ${h.cpu.cores} cores`} />)}</div>
          ) : <p className="mt-2 text-[12px] text-[var(--fg-dim)]">Windows keeps no load average, so none is shown. The processor line on the right is the live load.</p>}
        </section>
        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Memory</div>
          {h ? (<>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full glass-inset" aria-label={`Memory: ${gb(h.memory.totalBytes - h.memory.freeBytes)} in use, ${gb(h.memory.freeBytes)} free`}>
              <div style={{ width: `${h.memory.usedPercent}%`, background: "linear-gradient(90deg,#8b5cf6,#3b95ff)" }} />
            </div>
            <div className="mt-2 flex justify-between text-[11.5px]"><span>{gb(h.memory.totalBytes - h.memory.freeBytes)} in use</span><span className="text-[var(--fg-dim)]">{gb(h.memory.freeBytes)} free of {gb(h.memory.totalBytes)}</span></div>
          </>) : <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Not measured.</p>}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Recent history">
        <Spark label="Processor" values={hist?.samples.map((x) => x.cpu) ?? []} shape={hist?.shapes.cpu ?? "unknown"} now={last ? `${last.cpu}%` : "–"} />
        <Spark label="Memory" values={hist?.samples.map((x) => x.mem) ?? []} shape={hist?.shapes.mem ?? "unknown"} now={last ? `${last.mem}%` : "–"} />
        <Spark label="Disk (system drive)" values={hist?.samples.map((x) => x.disk) ?? []} shape={hist?.shapes.disk ?? "unknown"} now={last?.disk != null ? `${last.disk}% used` : "unknown"} />
        <Spark label="Network" values={hist?.samples.map((x) => x.netBps) ?? []} shape={hist?.shapes.net ?? "unknown"} now={bps(last?.netBps ?? null)} />
      </div>

      {h && (
        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Per core</div>
          <div className="mt-2 flex h-14 items-end gap-1 border-b border-white/10" aria-label="Per-core load">
            {h.cpu.perCore.map((p, i) => <div key={i} className="flex-1 self-end rounded-t-sm" title={`core ${i}: ${p}%`} style={{ height: Math.max(2, Math.round((p / 100) * 56)), background: "linear-gradient(180deg,#3b95ff,#8b5cf6)" }} />)}
          </div>
        </section>
      )}

      <section className="glass px-5 py-4">
        <div className="glass-eyebrow">Storage</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(pulse.drives ?? h?.disks ?? []).map((d) => <Bar key={d.mount} label={d.mount} pct={Math.round(d.usedPercent)} detail={`${gb(d.freeBytes)} free of ${gb(d.totalBytes)}`} />)}
        </div>
      </section>

      <SnapshotsCard />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="glass px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="glass-eyebrow">Busiest processes</div>
            <div className="flex gap-1">
              {(["all", "agents"] as const).map((k) => <button key={k} type="button" aria-pressed={procFilter === k} onClick={() => setProcFilter(k)} className={`rounded-md px-2 py-0.5 text-[11px] ${procFilter === k ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`}>{k === "all" ? "Everything" : "Agents only"}</button>)}
            </div>
          </div>
          {pulse.errors.processes && <p role="alert" className="mt-2 text-[12px] text-red-300">Could not read processes: {pulse.errors.processes}</p>}
          {!procs && !pulse.errors.processes && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Reading processes…</p>}
          {procs && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cpuList.slice(0, 6).map((p) => (
                  <div key={`c${p.pid}`} className="rounded-xl px-3 py-2 glass-inset"><div className="truncate text-[12px]">{p.name}</div><div className="type-figure text-[15px]">{p.cpuPercent}%</div><div className="text-[10px] text-[var(--fg-dimmer)]">{gb(p.memBytes)}</div></div>
                ))}
                {cpuList.length === 0 && <p className="col-span-full text-[12px] text-[var(--fg-dimmer)]">{procFilter === "agents" ? "No agent CLI is running right now." : "Nothing measured."}</p>}
              </div>
              <div className="mt-2 text-[10px] text-[var(--fg-dimmer)]">Processor over {procs.windowMs / 1000} s, share of the whole machine; {procs.cpuScope}. Agents only = processes named after an agent CLI.</div>
              {memList.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11.5px] text-[var(--fg-dim)]">By memory</div>
                  <ol className="mt-1 space-y-1">{memList.slice(0, 6).map((p) => <li key={`m${p.pid}`} className="flex justify-between gap-2 text-[12px]"><span className="truncate">{p.name}</span><span className="type-figure shrink-0">{gb(p.memBytes)}</span></li>)}</ol>
                </div>
              )}
            </>
          )}
        </section>

        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Diagnostics</div>
          <ul className="mt-2 space-y-1.5">
            {(checks?.items ?? []).map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: c.ok ? "#34d399" : "#f87171" }} aria-hidden />
                <span className="min-w-0"><span>{c.label}</span> <span className="text-[11px] text-[var(--fg-dimmer)]">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <div className="glass-eyebrow mt-4">Local services</div>
          <ul className="mt-2 space-y-1">
            {pulse.services.map((sv) => (
              <li key={sv.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span>{sv.name}{sv.optional ? <span className="ml-1 text-[10.5px] text-[var(--fg-dimmer)]">optional</span> : null}</span>
                <span className="text-[11px]" style={{ color: sv.state === "ok" ? "#34d399" : sv.state === "down" ? "#f87171" : "var(--fg-dimmer)" }}>{sv.state === "ok" ? `ok · ${sv.ms} ms` : sv.state === "down" ? sv.detail : "not set up"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
