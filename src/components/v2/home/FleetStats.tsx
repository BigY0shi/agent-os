"use client";

// S36 Fleet stats on the Mission Control cockpit (Nexora C9). Four cards fed by
// /api/v2/home/fleet-stats: two-line sparklines (you vs agents) per bucket, an activity
// heatmap in the owner's timezone, the latest hand-offs between agents, and session counts.
// Bucket size and window length are gear settings (rule 16) saved through useSettings();
// the route reads them per request, so a change re-buckets on the next fetch, no rebuild.
// A source that is not recorded reads "not tracked"; an empty fleet reads as empty.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";

interface Handoff { at: number; missionId: string; mission: string; step: string; from: string; to: string }
type SessionSource =
  | { id: string; label: string; tracked: true; last24h: number; total: number }
  | { id: string; label: string; tracked: false; reason: string };
interface Stats {
  generatedAt: number; timeZone: string; bucketHours: number; windowDays: number;
  window: { start: number; end: number };
  buckets: { start: number; you: number; agents: number }[];
  totals: { you: number; agents: number };
  heat: { days: string[]; you: number[][]; agents: number[][] };
  handoffs: Handoff[];
  sessions: { sources: SessionSource[]; last24h: number; total: number; untracked: number };
  basis: { you: string; agents: string };
  errors: Record<string, string>;
}

export const BUCKET_CHOICES = [6, 12, 24, 48] as const;
export const WINDOW_CHOICES = [7, 14, 30, 60] as const;
const YOU = "#8b5cf6", AGENTS = "#3b95ff";

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const bucketLabel = (hours: number) => (hours === 24 ? "every day" : hours === 48 ? "every 2 days" : `every ${hours} h`);

function Sparklines({ stats }: { stats: Stats }) {
  const W = 360, Hh = 64;
  const n = stats.buckets.length;
  const max = Math.max(1, ...stats.buckets.map((b) => Math.max(b.you, b.agents)));
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => Hh - 3 - (v / max) * (Hh - 8);
  const line = (key: "you" | "agents") => stats.buckets.map((b, i) => `${x(i)},${y(b[key])}`).join(" ");
  const fmt = (ts: number) => new Date(ts).toLocaleString([], { timeZone: stats.timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="glass px-5 py-4" aria-label="Activity over time" data-fleet-sparklines>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="glass-eyebrow">Activity over time</div>
        <div className="flex gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full" style={{ background: YOU }} aria-hidden />you <span className="type-figure">{stats.totals.you}</span></span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full" style={{ background: AGENTS }} aria-hidden />agents <span className="type-figure">{stats.totals.agents}</span></span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" role="img"
        aria-label={`You and agents per bucket, ${bucketLabel(stats.bucketHours)} over ${stats.windowDays} days: you ${stats.totals.you}, agents ${stats.totals.agents}`}>
        <line x1="0" x2={W} y1={Hh - 3} y2={Hh - 3} stroke="rgba(255,255,255,0.08)" />
        {n > 1 && <polyline points={line("agents")} fill="none" stroke={AGENTS} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        {n > 1 && <polyline points={line("you")} fill="none" stroke={YOU} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        {stats.buckets.map((b, i) => <title key={i}>{`${fmt(b.start)}: you ${b.you}, agents ${b.agents}`}</title>)}
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px] text-[var(--fg-dimmer)]">
        <span>{n ? fmt(stats.buckets[0].start) : ""}</span>
        <span>{n} buckets, {bucketLabel(stats.bucketHours)}, from local midnight {stats.windowDays} days back</span>
        <span>now</span>
      </div>
      {stats.totals.you + stats.totals.agents === 0 && <p className="mt-2 text-[11.5px] text-[var(--fg-dimmer)]">Nothing recorded in this window.</p>}
      <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">You: {stats.basis.you}. Agents: {stats.basis.agents}.</p>
    </section>
  );
}

function Heat({ stats }: { stats: Stats }) {
  const [who, setWho] = useState<"both" | "you" | "agents">("both");
  const grid = useMemo(() => stats.heat.you.map((row, d) => row.map((v, h) => (who === "you" ? v : who === "agents" ? stats.heat.agents[d][h] : v + stats.heat.agents[d][h]))), [stats, who]);
  const max = Math.max(1, ...grid.flat());
  const seg = (on: boolean) => `rounded-md px-2 py-0.5 text-[11px] ${on ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`;
  return (
    <section className="glass px-5 py-4" aria-label="Activity heatmap" data-fleet-heatmap>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="glass-eyebrow">When the fleet is busy</div>
        <div className="flex gap-1">
          {(["both", "you", "agents"] as const).map((w) => <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)} className={seg(who === w)}>{w}</button>)}
        </div>
      </div>
      <div className="mt-3 space-y-1" role="table" aria-label={`Events per weekday and hour, ${stats.timeZone}`}>
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-1" role="row">
            <span className="w-8 shrink-0 text-[10.5px] text-[var(--fg-dimmer)]" role="rowheader">{stats.heat.days[d]}</span>
            {row.map((v, h) => <span key={h} role="cell" title={`${stats.heat.days[d]} ${String(h).padStart(2, "0")}:00: ${v}`} className="h-3 flex-1 rounded-[3px]" style={{ background: v ? `rgba(59,149,255,${0.18 + 0.82 * (v / max)})` : "rgba(255,255,255,0.05)" }} />)}
          </div>
        ))}
        <div className="flex gap-1 pl-9 text-[9.5px] text-[var(--fg-dimmer)]">{[0, 6, 12, 18].map((h) => <span key={h} className="flex-1">{String(h).padStart(2, "0")}:00</span>)}</div>
      </div>
      <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">Last {stats.windowDays} days, hours in {stats.timeZone} (the Tasks timezone).</p>
    </section>
  );
}

function Handoffs({ stats }: { stats: Stats }) {
  return (
    <section className="glass px-5 py-4" aria-label="Recent hand-offs" data-fleet-handoffs>
      <div className="glass-eyebrow">Recent hand-offs</div>
      {stats.handoffs.length === 0 && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">No hand-offs recorded. They appear when a mission passes a step to a seat.</p>}
      <ul className="mt-2 divide-y divide-white/5">
        {stats.handoffs.map((h, i) => (
          <li key={`${h.missionId}:${i}`} className="py-1.5 text-[12px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate"><span className="text-[var(--fg-dim)]">{h.from}</span> <span aria-hidden>&rarr;</span> <span>{h.to}</span></span>
              <span className="shrink-0 text-[10.5px] text-[var(--fg-dimmer)]">{ago(h.at)}</span>
            </div>
            <div className="truncate text-[11px] text-[var(--fg-dimmer)]" title={`${h.mission}: ${h.step}`}>{h.mission}: {h.step}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Sessions({ stats }: { stats: Stats }) {
  return (
    <section className="glass px-5 py-4" aria-label="Sessions" data-fleet-sessions>
      <div className="flex items-baseline justify-between">
        <div className="glass-eyebrow">Sessions</div>
        <div className="text-[11px] text-[var(--fg-dim)]"><span className="type-figure text-[var(--fg)]">{stats.sessions.last24h}</span> last 24 h · <span className="type-figure text-[var(--fg)]">{stats.sessions.total}</span> total</div>
      </div>
      <table className="mt-2 w-full text-[11.5px]">
        <thead><tr className="text-[10px] uppercase tracking-wide text-[var(--fg-dimmer)]"><th className="text-left font-normal">Source</th><th className="text-right font-normal">24 h</th><th className="text-right font-normal">Total</th></tr></thead>
        <tbody>
          {stats.sessions.sources.map((s) => (
            <tr key={s.id} className="border-t border-white/5">
              <td className="py-1 pr-2 text-[var(--fg-dim)]" title={s.tracked ? undefined : s.reason}>{s.label}</td>
              {s.tracked
                ? <><td className="type-figure py-1 text-right">{s.last24h}</td><td className="type-figure py-1 text-right">{s.total}</td></>
                : <td className="py-1 text-right text-[var(--fg-dimmer)]" colSpan={2}>not tracked</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {stats.sessions.untracked > 0 && <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">"not tracked" means Agent OS keeps no record for that source; the totals above leave it out.</p>}
    </section>
  );
}

export default function FleetStats() {
  const { settings, save, saving } = useSettings();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gear, setGear] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/v2/home/fleet-stats", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `fleet stats failed (${r.status})`);
      setStats(j as Stats); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const fs = (settings?.fleetStats ?? {}) as { bucketHours?: number; windowDays?: number };
  const bucketHours = fs.bucketHours ?? 12, windowDays = fs.windowDays ?? 14;
  // Save, then fetch again: the route re-buckets from the saved setting on that request.
  const change = async (patch: { bucketHours?: number; windowDays?: number }) => {
    await save({ fleetStats: { bucketHours, windowDays, ...patch } } as never);
    await load();
  };
  const errs = Object.entries(stats?.errors ?? {});

  return (
    <div className="space-y-3" data-fleet-stats>
      <div className="flex items-center justify-between">
        <div className="glass-eyebrow">Fleet stats{stats ? <span className="ml-2 normal-case tracking-normal text-[var(--fg-dimmer)]">{bucketLabel(stats.bucketHours)}, {stats.windowDays} days, {stats.timeZone}</span> : null}</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void load()} disabled={busy} title="Count again" aria-label="Count again" className="rounded p-1 hover:bg-white/10 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
          <button type="button" onClick={() => setGear((v) => !v)} aria-expanded={gear} aria-label="Fleet stats settings" title="Fleet stats settings" className={`rounded p-1 hover:bg-white/10 ${gear ? "neon-ring" : ""}`}><Settings2 size={13} /></button>
        </div>
      </div>
      {gear && (
        <div className="glass-inset flex flex-wrap items-center gap-4 rounded-xl px-4 py-3 text-[12px]" data-fleet-gear>
          <label className="flex items-center gap-2">
            <span className="text-[var(--fg-dim)]">Bucket</span>
            <select value={bucketHours} disabled={saving} onChange={(e) => void change({ bucketHours: Number(e.target.value) })} className="rounded border border-white/10 bg-transparent px-1 py-0.5">
              {BUCKET_CHOICES.map((h) => <option key={h} value={h} style={{ background: "#14101c" }}>{h === 12 ? "12 h (twice a day)" : bucketLabel(h).replace("every ", "")}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[var(--fg-dim)]">Window</span>
            <select value={windowDays} disabled={saving} onChange={(e) => void change({ windowDays: Number(e.target.value) })} className="rounded border border-white/10 bg-transparent px-1 py-0.5">
              {WINDOW_CHOICES.map((d) => <option key={d} value={d} style={{ background: "#14101c" }}>{d} days</option>)}
            </select>
          </label>
          <span className="text-[10.5px] text-[var(--fg-dimmer)]">Saved to settings and applied on the next count; the heatmap uses the Tasks timezone.</span>
        </div>
      )}
      {err && !stats && <p role="alert" className="text-[12.5px] text-red-300">Fleet stats unavailable: {err}</p>}
      {!stats && !err && <div className="glass flex items-center gap-2 px-5 py-4 text-[12.5px] text-[var(--fg-dimmer)]"><Loader2 size={13} className="animate-spin" /> Counting…</div>}
      {stats && (
        <>
          {errs.length > 0 && <p role="alert" className="text-[11.5px] text-amber-300">{errs.map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Sparklines stats={stats} />
            <Heat stats={stats} />
            <Handoffs stats={stats} />
            <Sessions stats={stats} />
          </div>
        </>
      )}
    </div>
  );
}
