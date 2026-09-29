"use client";

// S26 Standing orders (_design/jarvis-v3-plan.md; NEXORA "Schedule": nothing runs behind
// your back). Every recurring job on one page: scheduled tasks, agents' schedule
// triggers, and Agent OS's own system jobs, each with who owns it, how often it runs,
// what it is told, the model, when it last ran and what came of it. Every action goes
// through the owning system; a field no source records says so.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Pause, CalendarClock, X } from "lucide-react";

interface Order {
  id: string; kind: "task" | "agent" | "system"; title: string; owner: string; deliveredBy: string; cadence: string;
  prompt: string | null; model: string | null; live: boolean; nextRunAt: number | null; lastRunAt: number | null;
  lastStatus: "ok" | "error" | null; lastResult: string | null; runs: number | null; runsBasis: string;
  actions: Record<"run" | "hold" | "resume" | "takeoff", boolean>; note?: string;
}
interface Data { orders: Order[]; counts: { onTheBooks: number; live: number; nextOne: { title: string; at: number } | null } }

const KIND: Record<Order["kind"], string> = { task: "Task", agent: "Agent", system: "System" };
const when = (t: number | null) => {
  if (!t) return null;
  const d = t - Date.now(), a = Math.abs(d), s = Math.round(a / 1000);
  const span = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return d >= 0 ? `in ${span}` : `${span} ago`;
};

export default function StandingOrdersTab() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "live" | "held">("all");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/standing", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setData(j); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (id: string, action: "run" | "hold" | "resume" | "takeoff") => {
    setBusy(`${id}:${action}`); setErr(null);
    try {
      const r = await fetch("/api/v2/standing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, confirm: action === "takeoff" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setData({ orders: j.orders, counts: j.counts });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setConfirmOff(null); }
  };

  const orders = (data?.orders ?? []).filter((o) => filter === "all" || (filter === "live" ? o.live : !o.live));
  return (
    <div className="space-y-4" data-standing-orders>
      <section className="glass-strong px-6 py-5">
        <div className="glass-eyebrow">Standing orders</div>
        <h2 className="type-display mt-1 text-[26px] leading-tight">Nothing runs behind your back</h2>
        <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Every recurring job any agent or module scheduled, in one place.</p>
        {data && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl px-3 py-2 glass-inset"><div className="text-[10.5px] text-[var(--fg-dimmer)]">On the books</div><div className="type-figure text-[20px] leading-none">{data.counts.onTheBooks}</div></div>
            <div className="rounded-xl px-3 py-2 glass-inset"><div className="text-[10.5px] text-[var(--fg-dimmer)]">Live</div><div className="type-figure text-[20px] leading-none">{data.counts.live}</div></div>
            <div className="rounded-xl px-3 py-2 glass-inset"><div className="text-[10.5px] text-[var(--fg-dimmer)]">Next one</div><div className="truncate text-[13px]">{data.counts.nextOne ? `${data.counts.nextOne.title}, ${when(data.counts.nextOne.at)}` : "nothing scheduled"}</div></div>
          </div>
        )}
      </section>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}
      {!data && !err && <p className="text-[13px] text-[var(--fg-dimmer)]">Reading every schedule…</p>}

      {data && (
        <div role="group" aria-label="Filter" className="flex gap-1.5">
          {(["all", "live", "held"] as const).map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-lg px-2.5 py-1 text-[12px] ${filter === k ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`}>{k === "all" ? "All" : k === "live" ? "Live" : "Held"}</button>)}
        </div>
      )}
      {data && orders.length === 0 && <section className="glass px-6 py-8 text-center text-[13px] text-[var(--fg-dim)]">{data.orders.length ? "None match this filter." : "No recurring jobs on the books."}</section>}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {orders.map((o) => (
          <article key={o.id} className="glass px-5 py-4" data-order={o.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.live ? "#34d399" : "#64748b" }} aria-hidden />
                  <span className="truncate text-[14px]">{o.title}</span>
                  <span className="rounded px-1.5 text-[10px] glass-inset text-[var(--fg-dimmer)]">{KIND[o.kind]}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[var(--fg-dim)]"><CalendarClock size={11} /> {o.cadence}</div>
              </div>
              <span className="shrink-0 text-[11px]" style={{ color: o.live ? "#34d399" : "var(--fg-dimmer)" }}>{o.live ? (o.nextRunAt ? `next ${when(o.nextRunAt)}` : "live") : "held"}</span>
            </div>
            <dl className="mt-3 grid grid-cols-[92px_1fr] gap-y-1 text-[12px]">
              <dt className="text-[var(--fg-dimmer)]">Owner</dt><dd className="truncate">{o.owner}</dd>
              <dt className="text-[var(--fg-dimmer)]">Delivered by</dt><dd className="truncate">{o.deliveredBy}</dd>
              <dt className="text-[var(--fg-dimmer)]">Model</dt><dd className="truncate font-mono text-[11.5px]">{o.model ?? <span className="font-sans text-[var(--fg-dimmer)]">not recorded</span>}</dd>
              <dt className="text-[var(--fg-dimmer)]">Last run</dt><dd>{o.lastRunAt ? `${when(o.lastRunAt)}${o.lastStatus === "error" ? ", failed" : o.lastStatus === "ok" ? ", ok" : ""}` : "never"}</dd>
              <dt className="text-[var(--fg-dimmer)]">Runs</dt><dd>{o.runs ?? "–"} <span className="text-[10.5px] text-[var(--fg-dimmer)]">{o.runsBasis}</span></dd>
            </dl>
            {o.prompt && <details className="mt-2 text-[12px]"><summary className="cursor-pointer text-[var(--fg-dim)]">What it is told</summary><p className="mt-1 whitespace-pre-wrap rounded-lg p-2 text-[11.5px] glass-inset">{o.prompt}</p></details>}
            {o.lastResult && <p className={`mt-2 line-clamp-2 text-[11.5px] ${o.lastStatus === "error" ? "text-red-300" : "text-[var(--fg-dim)]"}`} title={o.lastResult}>{o.lastResult}</p>}
            {o.note && <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">{o.note}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {o.actions.run && <button type="button" disabled={!!busy} onClick={() => void act(o.id, "run")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass disabled:opacity-50">{busy === `${o.id}:run` ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run it now</button>}
              {o.actions.hold && <button type="button" disabled={!!busy} onClick={() => void act(o.id, "hold")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass disabled:opacity-50"><Pause size={12} /> Hold it</button>}
              {o.actions.resume && <button type="button" disabled={!!busy} onClick={() => void act(o.id, "resume")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass neon-ring disabled:opacity-50"><Play size={12} /> Let it run</button>}
              {o.actions.takeoff && (confirmOff === o.id
                ? <span className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[12px] glass-inset">{o.kind === "task" ? "Clear its schedule (the task stays)?" : "Remove this schedule from the agent (its agent.json is kept as a version)?"}
                    <button type="button" onClick={() => void act(o.id, "takeoff")} className="text-red-300 hover:underline">Take it off</button>
                    <button type="button" aria-label="Cancel" onClick={() => setConfirmOff(null)}><X size={12} /></button></span>
                : <button type="button" disabled={!!busy} onClick={() => setConfirmOff(o.id)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass text-red-300 disabled:opacity-50"><X size={12} /> Take it off</button>)}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
