"use client";

// S21 Crew (_design/jarvis-v3-plan.md; owner's NEXORA "Agent City" screenshots): the
// owner's configured agents as a crew with Jarvis at the centre. Every count comes from
// the agents' recorded runs (GET /api/v2/crew). Talking to an agent starts a real run;
// its reply is what that run returned. Deploying uses the existing POST /api/agents.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Loader2, Send, ChevronLeft, ChevronRight, Check, Rocket } from "lucide-react";
import dynamic from "next/dynamic";
import AgentAvatar from "@/components/AgentAvatar";

const AgentCity = dynamic(() => import("./AgentCity"), { ssr: false, loading: () => <div className="glass grid h-[420px] place-items-center text-[12.5px] text-[var(--fg-dimmer)]">Building the city…</div> });

type Band = "running" | "idle" | "waiting" | "error" | "offline";
export interface CrewAgent { id: string; name: string; description: string; enabled: boolean; intelligence: string; status: Band; detail: string | null; runs7d: number; avgReplyMs: number | null; tokens7d: number; sessions: number; lastAt: number | null }
interface Crew {
  counts: { agents: number; workingNow: number; messages7d: number; avgReplyMs: number | null; agentTimeMonthMs: number };
  agents: CrewAgent[];
  heat: { owner7d: number[][]; agent7d: number[][]; owner24h: number[]; agent24h: number[]; days: string[] };
  recent: { agentId: string; agent: string; what: string; source: string; at: number; tokens: number | null; status: string }[];
  basis: string;
  statusError: string | null;
  roles: { id: string; title: string; oneLine: string; suggestedIntelligence: "fast" | "standard" | "deep"; instructions: string }[];
  tiers: Record<"fast" | "standard" | "deep", string>;
}
interface Turn { at: number; role: "owner" | "agent"; text: string; status?: string; pending?: boolean }

export const BAND_WORD: Record<Band, string> = { running: "working now", idle: "ready", waiting: "waiting on you", error: "error", offline: "off" };
export const BAND_TINT: Record<Band, string> = { running: "#3b95ff", idle: "#f2b441", waiting: "#a78bfa", error: "#f87171", offline: "#64748b" };
const dur = (ms: number | null) => (ms == null ? "–" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const ago = (t: number | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j as { error?: string }).error ?? `request failed (${r.status})`), { body: j });
  return j as T;
}

export default function CrewTab() {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [deploy, setDeploy] = useState(false);
  const load = useCallback(async () => {
    try { setCrew(await api<Crew>("/api/v2/crew")); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);
  const selected = crew?.agents.find((a) => a.id === sel) ?? null;

  return (
    <div className="space-y-4" data-crew-tab>
      <section className="glass-strong px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="glass-eyebrow">Crew</div>
            <h2 className="type-display mt-1 text-[28px] leading-tight">
              {crew ? `${crew.counts.agents} agent${crew.counts.agents === 1 ? "" : "s"}, ${crew.counts.workingNow} working now` : "Reading the crew…"}
            </h2>
            <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Jarvis orchestrates; each agent below is one you configured. Pick one to talk to it.</p>
          </div>
          <button type="button" onClick={() => setDeploy(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] glass neon-ring"><Rocket size={14} /> Deploy agent</button>
        </div>
        {crew && (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Crew counts">
            {([["Agents", String(crew.counts.agents)], ["Working now", String(crew.counts.workingNow)], ["Messages, 7 days", String(crew.counts.messages7d)], ["Average reply", dur(crew.counts.avgReplyMs)], ["Agent time this month", dur(crew.counts.agentTimeMonthMs || null)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2 glass-inset"><div className="text-[10.5px] text-[var(--fg-dimmer)]">{k}</div><div className="type-figure text-[20px] leading-none">{v}</div></div>
            ))}
          </div>
        )}
        {crew && <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">From {crew.basis}.{crew.statusError ? ` Live status unavailable: ${crew.statusError}` : ""}</p>}
      </section>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}

      {crew && crew.agents.length === 0 && (
        <section className="glass px-6 py-8 text-center text-[13px] text-[var(--fg-dim)]">No agents yet. Deploy one: pick a prepared role or write your own.</section>
      )}

      {crew && crew.agents.length > 0 && (
        <>
          <AgentCity agents={crew.agents} selected={sel} onSelect={setSel} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[380px_1fr]">
            <CrewRing agents={crew.agents} selected={sel} onSelect={setSel} />
            {selected ? <CrewChat agent={selected} onClose={() => setSel(null)} onSent={load} /> : (
              <section className="glass grid place-items-center px-6 py-10 text-center text-[12.5px] text-[var(--fg-dimmer)]">Choose an agent on the ring, the roster or the city to open a conversation with it.</section>
            )}
          </div>
          <Roster agents={crew.agents} selected={sel} onSelect={setSel} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Heatmap heat={crew.heat} />
            <Recent recent={crew.recent} onSelect={setSel} />
          </div>
        </>
      )}
      {deploy && crew && <DeployWizard roles={crew.roles} tiers={crew.tiers} onClose={() => setDeploy(false)} onDeployed={(id) => { setDeploy(false); void load().then(() => setSel(id)); }} />}
    </div>
  );
}

// ── Talk to the crew ring ────────────────────────────────────────────────────
function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}
function CrewRing({ agents, selected, onSelect }: { agents: CrewAgent[]; selected: string | null; onSelect: (id: string) => void }) {
  const n = agents.length, gap = n > 1 ? 0.04 : 0, C = 170;
  return (
    <section className="glass flex flex-col items-center px-4 py-4" aria-label="Talk to the crew">
      <div className="glass-eyebrow self-start">Talk to the crew</div>
      <svg viewBox="0 0 340 340" className="mt-2 w-full max-w-[340px]">
        {agents.map((a, i) => {
          const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap, a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - gap;
          const on = a.id === selected, mid = (a0 + a1) / 2;
          return (
            <g key={a.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${a.name}, ${BAND_WORD[a.status]}`}
              onClick={() => onSelect(a.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(a.id); } }}
              className="cursor-pointer outline-none">
              <path d={arc(C, C, on ? 104 : 110, on ? 164 : 158, a0, a1)} fill={BAND_TINT[a.status]} fillOpacity={on ? 0.55 : 0.22} stroke={BAND_TINT[a.status]} strokeOpacity={on ? 1 : 0.6} strokeWidth={on ? 2 : 1} />
              <text x={C + 134 * Math.cos(mid)} y={C + 134 * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize={n > 8 ? 9 : 11} fill="currentColor">{a.name.length > 12 ? `${a.name.slice(0, 11)}…` : a.name}</text>
            </g>
          );
        })}
        <circle cx={C} cy={C} r={78} fill="rgba(139,92,246,0.14)" stroke="#8b5cf6" strokeOpacity={0.6} />
        <text x={C} y={C - 6} textAnchor="middle" fontSize={17} fill="currentColor" className="type-display">Jarvis</text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>orchestrator</text>
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-2 text-[10.5px] text-[var(--fg-dimmer)]">
        {(Object.keys(BAND_WORD) as Band[]).map((b) => <span key={b} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: BAND_TINT[b] }} />{BAND_WORD[b]}</span>)}
      </div>
    </section>
  );
}

// ── messenger drawer ─────────────────────────────────────────────────────────
export function CrewChat({ agent, onClose, onSent }: { agent: CrewAgent; onClose: () => void; onSent?: () => void }) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { const j = await api<{ turns: Turn[] }>(`/api/v2/crew/${encodeURIComponent(agent.id)}/chat`); setTurns(j.turns); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, [agent.id]);
  const pending = (turns ?? []).some((t) => t.pending);
  useEffect(() => { setTurns(null); void load(); }, [load]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => clearInterval(t);
  }, [pending, load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { const j = await api<{ turns: Turn[] }>(`/api/v2/crew/${encodeURIComponent(agent.id)}/chat`, { method: "POST", body: JSON.stringify({ text }) }); setTurns(j.turns); setText(""); onSent?.(); }
    catch (e) { const body = (e as { body?: { turns?: Turn[] } }).body; if (body?.turns) setTurns(body.turns); setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="glass-strong flex h-[460px] flex-col" aria-label={`Conversation with ${agent.name}`} data-crew-chat={agent.id}>
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><AgentAvatar agent={agent.id} name={agent.name} size={28} pulse={agent.status === "running"} /><span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_TINT[agent.status] }} aria-hidden /><span className="truncate text-[14px]">{agent.name}</span><span className="text-[11px] text-[var(--fg-dimmer)]">{BAND_WORD[agent.status]}</span></div>
          <div className="truncate text-[11.5px] text-[var(--fg-dim)]">{agent.description}</div>
        </div>
        <button type="button" aria-label="Close conversation" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/5"><X size={15} /></button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-3">
        {!turns && <p className="text-[12px] text-[var(--fg-dimmer)]">Loading the conversation…</p>}
        {turns && turns.length === 0 && <p className="text-[12px] text-[var(--fg-dimmer)]">No messages yet. What you send starts a real run of {agent.name}; the reply is what that run returns.</p>}
        {(turns ?? []).map((t, i) => (
          <div key={i} className={`flex ${t.role === "owner" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${t.role === "owner" ? "glass neon-ring" : "glass-inset"}`} style={t.status === "error" ? { color: "#fca5a5" } : undefined}>
              {t.pending && <Loader2 size={11} className="mr-1 inline animate-spin" />}{t.text}
              <div className="mt-1 text-right text-[9.5px] text-[var(--fg-dimmer)]">{new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {err && <p role="alert" className="px-5 text-[11.5px] text-red-300">{err}</p>}
      <form className="flex gap-2 border-t border-white/5 px-4 py-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={!agent.enabled} placeholder={agent.enabled ? `Message ${agent.name}` : `${agent.name} is switched off`} aria-label={`Message ${agent.name}`} className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none glass-inset" />
        <button type="submit" disabled={busy || !text.trim() || !agent.enabled || pending} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] glass neon-ring disabled:opacity-40" title={pending ? "Wait for the reply first: one run at a time per agent" : undefined}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
      </form>
    </section>
  );
}

// ── roster, heatmap, recent ──────────────────────────────────────────────────
function Roster({ agents, selected, onSelect }: { agents: CrewAgent[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="glass px-4 py-4" aria-label="Roster">
      <div className="glass-eyebrow px-1">Roster</div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {agents.map((a) => (
          <button key={a.id} type="button" onClick={() => onSelect(a.id)} aria-pressed={a.id === selected}
            className={`w-[220px] shrink-0 snap-start rounded-xl px-4 py-3 text-left ${a.id === selected ? "glass neon-ring" : "glass-inset"}`}>
            <div className="flex items-center gap-2"><AgentAvatar agent={a.id} name={a.name} size={22} /><span className="h-2 w-2 rounded-full" style={{ background: BAND_TINT[a.status] }} aria-hidden /><span className="truncate text-[13px]">{a.name}</span></div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--fg-dim)]">{BAND_WORD[a.status]}{a.detail ? ` · ${a.detail}` : ""}</div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[10.5px] text-[var(--fg-dimmer)]">
              <div><div className="type-figure text-[14px] text-[var(--fg)]">{a.runs7d}</div>runs, 7d</div>
              <div><div className="type-figure text-[14px] text-[var(--fg)]">{dur(a.avgReplyMs)}</div>reply</div>
              <div><div className="type-figure text-[14px] text-[var(--fg)]">{a.tokens7d >= 1000 ? `${Math.round(a.tokens7d / 1000)}k` : a.tokens7d}</div>tokens</div>
            </div>
            <div className="mt-1 text-[10px] text-[var(--fg-dimmer)]">{a.sessions} run{a.sessions === 1 ? "" : "s"} recorded · last {ago(a.lastAt)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Heatmap({ heat }: { heat: Crew["heat"] }) {
  const [span, setSpan] = useState<"24h" | "7d">("7d");
  const [who, setWho] = useState<"both" | "owner" | "agent">("both");
  const grid = useMemo(() => {
    const pick = (o: number[][], a: number[][]) => o.map((row, d) => row.map((v, h) => (who === "owner" ? v : who === "agent" ? a[d][h] : v + a[d][h])));
    return span === "7d" ? pick(heat.owner7d, heat.agent7d) : pick([heat.owner24h], [heat.agent24h]);
  }, [heat, span, who]);
  const max = Math.max(1, ...grid.flat());
  const labels = span === "7d" ? heat.days : ["Last 24 h"];
  const seg = (on: boolean) => `rounded-md px-2 py-0.5 text-[11px] ${on ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`;
  return (
    <section className="glass px-5 py-4" aria-label="When the crew speaks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="glass-eyebrow">When the crew speaks</div>
        <div className="flex gap-1">
          {(["24h", "7d"] as const).map((s) => <button key={s} type="button" aria-pressed={span === s} onClick={() => setSpan(s)} className={seg(span === s)}>{s}</button>)}
          <span className="w-2" />
          {(["both", "owner", "agent"] as const).map((w) => <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)} className={seg(who === w)}>{w === "owner" ? "you" : w === "agent" ? "agents" : "both"}</button>)}
        </div>
      </div>
      <div className="mt-3 space-y-1" role="table" aria-label="Messages per hour">
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-1" role="row">
            <span className="w-16 shrink-0 text-[10.5px] text-[var(--fg-dimmer)]" role="rowheader">{labels[d]}</span>
            {row.map((v, h) => <span key={h} role="cell" title={`${labels[d]} ${String(h).padStart(2, "0")}:00: ${v}`} className="h-3.5 flex-1 rounded-[3px]" style={{ background: v ? `rgba(59,149,255,${0.18 + 0.82 * (v / max)})` : "rgba(255,255,255,0.05)" }} />)}
          </div>
        ))}
        <div className="flex gap-1 pl-[68px] text-[9.5px] text-[var(--fg-dimmer)]">{[0, 6, 12, 18].map((h) => <span key={h} className="flex-1">{String(h).padStart(2, "0")}:00</span>)}</div>
      </div>
      <p className="mt-2 text-[10.5px] text-[var(--fg-dimmer)]">You: when you messaged or ran an agent. Agents: when a run finished. Local server time.</p>
    </section>
  );
}

function Recent({ recent, onSelect }: { recent: Crew["recent"]; onSelect: (id: string) => void }) {
  return (
    <section className="glass px-5 py-4" aria-label="Recent activity">
      <div className="glass-eyebrow">Recent activity</div>
      {recent.length === 0 && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">No runs recorded yet.</p>}
      <ul className="mt-2 divide-y divide-white/5">
        {recent.map((r, i) => (
          <li key={i} className="flex items-start gap-3 py-1.5 text-[12px]">
            <button type="button" onClick={() => onSelect(r.agentId)} className="w-28 shrink-0 truncate text-left hover:underline">{r.agent}</button>
            <span className="min-w-0 flex-1 truncate text-[var(--fg-dim)]" title={r.what}>{r.what}</span>
            <span className="shrink-0 text-[10.5px] text-[var(--fg-dimmer)]">{r.source}</span>
            <span className="w-16 shrink-0 text-right text-[10.5px] text-[var(--fg-dimmer)]">{ago(r.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Deploy agent wizard ──────────────────────────────────────────────────────
function DeployWizard({ roles, tiers, onClose, onDeployed }: { roles: Crew["roles"]; tiers: Crew["tiers"]; onClose: () => void; onDeployed: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [oneLine, setOneLine] = useState("");
  const [instructions, setInstructions] = useState("");
  const [intel, setIntel] = useState<"fast" | "standard" | "deep">("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const pickRole = (id: string | null) => {
    setRoleId(id);
    const r = roles.find((x) => x.id === id);
    if (r) { setName((n) => n || r.title); setOneLine(r.oneLine); setInstructions(r.instructions); setIntel(r.suggestedIntelligence); }
    else { setOneLine(""); setInstructions(""); }
  };
  const canNext = step === 0 ? roleId !== undefined : step === 1 ? !!(name.trim() && oneLine.trim() && instructions.trim()) : true;
  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const j = await api<{ agent: { id: string }; warning?: string }>("/api/agents", { method: "POST", body: JSON.stringify({ name: name.trim(), description: oneLine.trim(), instructions: instructions.trim(), intelligence: intel }) });
      if (j.warning) { setWarning(j.warning); setBusy(false); return; }
      onDeployed(j.agent.id);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const input = "mt-1 w-full rounded-xl px-3 py-2 text-[13px] outline-none glass-inset focus:ring-1 focus:ring-[#3b95ff]";
  return (
    <div role="dialog" aria-modal="true" aria-label="Deploy an agent" className="fixed inset-0 z-[96] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} aria-hidden />
      <div className="glass-strong relative flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(22,19,34,0.97), rgba(10,9,18,0.97))" }}>
        <header className="flex items-start justify-between px-6 pt-5">
          <div><div className="glass-eyebrow">Deploy agent · step {step + 1} of 4</div><h2 className="type-display mt-1 text-[22px]">{["Pick a role", "Name and role", "Model", "Review and confirm"][step]}</h2></div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/5"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4 text-[13px]">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {roles.map((r) => (
                <button key={r.id} type="button" aria-pressed={roleId === r.id} onClick={() => pickRole(r.id)} className={`rounded-xl px-4 py-3 text-left ${roleId === r.id ? "glass neon-ring" : "glass-inset"}`}>
                  <div className="text-[13px]">{r.title}</div><div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">{r.oneLine}</div>
                </button>
              ))}
              <button type="button" aria-pressed={roleId === null} onClick={() => pickRole(null)} className={`rounded-xl px-4 py-3 text-left ${roleId === null ? "glass neon-ring" : "glass-inset"}`}>
                <div className="inline-flex items-center gap-1 text-[13px]"><Plus size={12} /> Write your own</div><div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">Start from a blank page.</div>
              </button>
            </div>
          )}
          {step === 1 && (<>
            <label className="block">Name<input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label className="block">Role, in one line<input className={input} value={oneLine} onChange={(e) => setOneLine(e.target.value)} placeholder="What it does for you" /></label>
            <label className="block">Instructions <span className="text-[11px] text-[var(--fg-dimmer)]">(editable now, and later in the agent&apos;s system.md)</span><textarea className={input} rows={9} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
          </>)}
          {step === 2 && (
            <div className="space-y-2">
              {(["fast", "standard", "deep"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={intel === t} onClick={() => setIntel(t)} className={`w-full rounded-xl px-4 py-3 text-left ${intel === t ? "glass neon-ring" : "glass-inset"}`}>
                  <div className="flex items-center justify-between"><span className="capitalize">{t}</span><span className="font-mono text-[11px] text-[var(--fg-dim)]">{tiers[t]}</span></div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--fg-dimmer)]">{t === "fast" ? "Cheapest: triage, routing, simple digests." : t === "standard" ? "Most tasks." : "Research, writing, judgment calls."}</div>
                </button>
              ))}
              <p className="text-[11px] text-[var(--fg-dimmer)]">These are the models each tier runs on today (Agents settings). Change them there.</p>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-2">
              <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
                <dt className="text-[var(--fg-dimmer)]">Name</dt><dd>{name}</dd>
                <dt className="text-[var(--fg-dimmer)]">Role</dt><dd>{oneLine}</dd>
                <dt className="text-[var(--fg-dimmer)]">Model</dt><dd>{intel} · <span className="font-mono text-[11.5px]">{tiers[intel]}</span></dd>
                <dt className="text-[var(--fg-dimmer)]">Starts from</dt><dd>{roleId ? roles.find((r) => r.id === roleId)?.title : "your own instructions"}</dd>
              </dl>
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-xl p-3 text-[11.5px] glass-inset">{instructions}</pre>
              {warning && <p role="alert" className="rounded-lg px-3 py-2 text-[12px] text-amber-300 glass-inset">{warning}</p>}
            </div>
          )}
          {err && <p role="alert" className="text-[12px] text-red-300">{err}</p>}
        </div>
        <footer className="flex justify-between px-6 pb-5">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40"><ChevronLeft size={13} /> Back</button>
          {step < 3
            ? <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring disabled:opacity-40">Next <ChevronRight size={13} /></button>
            : warning
              ? <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass">Close</button>
              : <button type="button" disabled={busy} onClick={() => void confirm()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Deploy</button>}
        </footer>
      </div>
    </div>
  );
}
