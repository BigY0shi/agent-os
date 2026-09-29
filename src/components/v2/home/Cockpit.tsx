"use client";

// S18 Mission Control cockpit (_design/jarvis-v3-plan.md; the owner liked how NEXORA
// presents telemetry). Information on first load: a telemetry band under the greeting,
// and a full System pulse view. Every number comes from /api/v2/home/pulse, which reads
// real sources; the basis of each number is printed next to it, and anything without a
// source is shown as unknown, never estimated.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";

interface Pulse {
  sampledAt: string;
  host: null | {
    hostname: string; platform: string; uptimeSec: number;
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
  errors: Record<string, string>;
}
interface Proc { pid: number; name: string; cpuPercent: number; memBytes: number }

const STATUS: Record<"optimal" | "strain" | "needs-a-look", [string, string]> = {
  optimal: ["Optimal", "#34d399"], strain: ["Under strain", "#fbbf24"], "needs-a-look": ["Needs a look", "#f87171"],
};
const AGENT_TINT: Record<string, string> = { running: "#3b95ff", idle: "#34d399", waiting: "#fbbf24", error: "#f87171", offline: "#64748b" };
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : `${(b / 1e9).toFixed(1)} GB`);
const dur = (ms: number | null) => (ms == null ? "–" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`);

export function usePulse(processes: boolean) {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/v2/home/pulse${processes ? "?processes=1" : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `pulse failed (${r.status})`);
      setPulse(j as Pulse); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [processes]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, processes ? 15_000 : 10_000);
    return () => clearInterval(t);
  }, [load, processes]);
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
    ...pulse.agents.map((a) => ({ key: `a:${a.id}`, name: a.name, tint: AGENT_TINT[a.status] ?? "#64748b", label: a.status, load: a.status === "running" ? 1 : 0 })),
    ...pulse.seatLoad.map((s) => ({ key: `s:${s.agent}`, name: `${s.agent} (mission seats)`, tint: AGENT_TINT.running, label: `${s.running} running`, load: s.running })),
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
                <span className="flex min-w-0 items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: l.tint }} aria-hidden /><span className="truncate">{l.name}</span></span>
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

/** The full System pulse view: gauges, what is holding the machine, diagnostics. */
export function SystemPulse() {
  const { pulse, err, busy, reload } = usePulse(true);
  if (err && !pulse) return <p role="alert" className="text-[12.5px] text-red-300">System pulse unavailable: {err}</p>;
  if (!pulse) return <div className="glass flex items-center gap-2 px-5 py-4 text-[12.5px] text-[var(--fg-dimmer)]"><Loader2 size={13} className="animate-spin" /> Measuring the machine…</div>;
  const h = pulse.host;
  const status = pulse.checks ? STATUS[pulse.checks.status] : null;
  const procs = pulse.processes;
  return (
    <div className="space-y-3" data-system-pulse>
      <section className="glass-strong flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <div className="glass-eyebrow">System pulse</div>
          <div className="type-display mt-1 text-[28px] leading-none" style={{ color: status?.[1] }}>{status?.[0] ?? "Unknown"}</div>
          <div className="mt-2 text-[12px] text-[var(--fg-dim)]">{pulse.checks ? `${pulse.checks.clear} of ${pulse.checks.total} checks clear` : "checks unavailable"}{h ? ` · ${h.hostname} · up ${Math.round(h.uptimeSec / 3600)} h` : ""}</div>
        </div>
        <button type="button" onClick={() => void reload()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Measure again
        </button>
      </section>

      {h && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="glass flex flex-col items-center px-4 py-4"><Ring pct={h.cpu.percent} center={`${h.cpu.percent}%`} sub="processor" size={110} /><div className="mt-2 text-center text-[10.5px] text-[var(--fg-dimmer)]">{h.cpu.cores} cores</div></div>
          <div className="glass flex flex-col items-center px-4 py-4"><Ring pct={Math.round(h.memory.usedPercent)} center={`${Math.round(h.memory.usedPercent)}%`} sub="memory" size={110} /><div className="mt-2 text-center text-[10.5px] text-[var(--fg-dimmer)]">{gb(h.memory.totalBytes - h.memory.freeBytes)} of {gb(h.memory.totalBytes)}</div></div>
          {h.disks.slice(0, 2).map((d) => (
            <div key={d.mount} className="glass flex flex-col items-center px-4 py-4"><Ring pct={Math.round(d.usedPercent)} center={`${Math.round(d.usedPercent)}%`} sub={`disk ${d.mount}`} size={110} /><div className="mt-2 text-center text-[10.5px] text-[var(--fg-dimmer)]">{gb(d.freeBytes)} free of {gb(d.totalBytes)}</div></div>
          ))}
        </div>
      )}
      {h && (
        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Per core</div>
          <div className="mt-2 flex h-14 items-end gap-1 border-b border-white/10" aria-label="Per-core load">
            {h.cpu.perCore.map((p, i) => <div key={i} className="flex-1 self-end rounded-t-sm" title={`core ${i}: ${p}%`} style={{ height: Math.max(2, Math.round((p / 100) * 56)), background: "linear-gradient(180deg,#3b95ff,#8b5cf6)" }} />)}
          </div>
          <div className="mt-1 truncate text-[10.5px] text-[var(--fg-dimmer)]">{h.cpu.model}</div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">What is holding the machine</div>
          {pulse.errors.processes && <p role="alert" className="mt-2 text-[12px] text-red-300">Could not read processes: {pulse.errors.processes}</p>}
          {!procs && !pulse.errors.processes && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Reading processes…</p>}
          {procs && (
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[11.5px] text-[var(--fg-dim)]">Processor, over {procs.windowMs / 1000} s</div>
                <ol className="mt-1 space-y-1">{procs.byCpu.map((p) => <li key={p.pid} className="flex justify-between gap-2 text-[12px]"><span className="truncate">{p.name}</span><span className="type-figure shrink-0">{p.cpuPercent}%</span></li>)}</ol>
                <div className="mt-1 text-[10px] text-[var(--fg-dimmer)]">Share of the whole machine; {procs.cpuScope}.</div>
              </div>
              <div>
                <div className="text-[11.5px] text-[var(--fg-dim)]">Memory</div>
                <ol className="mt-1 space-y-1">{procs.byMemory.map((p) => <li key={p.pid} className="flex justify-between gap-2 text-[12px]"><span className="truncate">{p.name}</span><span className="type-figure shrink-0">{gb(p.memBytes)}</span></li>)}</ol>
                <div className="mt-1 text-[10px] text-[var(--fg-dimmer)]">Working set, every process.</div>
              </div>
            </div>
          )}
        </section>

        <section className="glass px-5 py-4">
          <div className="glass-eyebrow">Diagnostics</div>
          <ul className="mt-2 space-y-1.5">
            {(pulse.checks?.items ?? []).map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: c.ok ? "#34d399" : "#f87171" }} aria-hidden />
                <span className="min-w-0"><span>{c.label}</span> <span className="text-[11px] text-[var(--fg-dimmer)]">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <div className="glass-eyebrow mt-4">Local services</div>
          <ul className="mt-2 space-y-1">
            {pulse.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span>{s.name}{s.optional ? <span className="ml-1 text-[10.5px] text-[var(--fg-dimmer)]">optional</span> : null}</span>
                <span className="text-[11px]" style={{ color: s.state === "ok" ? "#34d399" : s.state === "down" ? "#f87171" : "var(--fg-dimmer)" }}>{s.state === "ok" ? `ok · ${s.ms} ms` : s.state === "down" ? s.detail : "not set up"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
