"use client";

// S17 Missions (_design/jarvis-v3-plan.md): a dedicated Goal Mode. The owner writes a
// brief, Jarvis plans the steps and the crew, nothing runs until the owner approves,
// each seat's CLI works in its own scratch dir, and the mission ends at a review (or is
// delivered straight away, if the owner chose that). Every number on this page is
// measured from the mission records; "last heard" is the seat's real output.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, X, Loader2, Check, Square, CornerUpLeft, RotateCw, ChevronLeft, ChevronRight, Radio, FileText, Users, Clock,
} from "lucide-react";

type Agent = "claude" | "hermes" | "codex" | "antigravity";
type Stage = "briefing" | "in-progress" | "review" | "delivered" | "stopped" | "failed";
interface Seat { id: string; agent: Agent; model?: string; role: string }
interface Step { id: string; title: string; seatId: string; brief: string; dependsOn: string[]; status: "waiting" | "running" | "done" | "failed" | "stopped"; startedAt?: number; finishedAt?: number; lastHeardAt?: number; lastLine?: string; error?: string }
interface Mission {
  id: string; name: string; objective: string; successLooksLike: string; priority: "low" | "normal" | "high"; targetDate?: string;
  teamMode: "jarvis" | "manual"; seats: Seat[]; limits: { timeLimitMin: number; maxSteps: number; reportLength: string }; endAction: "review" | "deliver";
  stage: Stage; working?: "planning" | "reporting" | null; plan?: { rationale: string; guardrails: string[]; steps: Step[] }; planApproved: boolean;
  createdAt: number; launchedAt?: number; deadlineAt?: number; finishedAt?: number; deliveredAt?: number; result?: string; note?: string; error?: string;
}
interface MissionEvent { at: number; kind: string; text: string; stepId?: string; brief?: string }
interface Stats { waitingOnYou: number; cycleTimeMin: number | null; onTimePct: number | null; onTimeOf: number; agentsAtWork: number }
interface Crew { agent: Agent; installed: boolean; turnCapped: boolean; defaultModel?: string }

const AGENT_LABEL: Record<Agent, string> = { claude: "Claude", hermes: "Hermes", codex: "Codex", antigravity: "Antigravity (agy)" };
const STAGE_LABEL: Record<Stage, string> = { briefing: "Briefing", "in-progress": "In progress", review: "Review", delivered: "Delivered", stopped: "Stopped", failed: "Failed" };
const STAGE_TINT: Record<Stage, string> = { briefing: "#a78bfa", "in-progress": "#3b95ff", review: "#fbbf24", delivered: "#34d399", stopped: "#94a3b8", failed: "#f87171" };
const STEP_TINT: Record<Step["status"], string> = { waiting: "#64748b", running: "#3b95ff", done: "#34d399", failed: "#f87171", stopped: "#94a3b8" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `request failed (${r.status})`);
  return j as T;
}
const ago = (t: number | undefined, now: number) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const needsYou = (m: Mission) => (m.stage === "briefing" && !!m.plan && !m.working) || m.stage === "review";

export default function MissionsTab() {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [now, setNow] = useState(Date.now());
  // S23: Desk (focus + desk + stage columns) or Board (waiting on you | ring | delivered).
  const [view, setView] = useState<"desk" | "board">("desk");
  useEffect(() => { try { const v = localStorage.getItem("agentos.missions.view"); if (v === "board" || v === "desk") setView(v); } catch { /* storage blocked */ } }, []);
  const pickView = (v: "desk" | "board") => { setView(v); try { localStorage.setItem("agentos.missions.view", v); } catch { /* storage blocked */ } };

  const load = useCallback(async () => {
    try {
      const j = await api<{ missions: Mission[]; stats: Stats; crew: Crew[] }>("/api/v2/missions");
      setMissions(j.missions); setStats(j.stats); setCrew(j.crew); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  const busy = (missions ?? []).some((m) => m.stage === "in-progress" || m.working);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, busy ? 3000 : 15000);
    return () => clearInterval(t);
  }, [load, busy]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Focus: the owner's pick, else what needs them, else what is running, else the newest.
  const focus = useMemo(() => {
    const list = missions ?? [];
    return list.find((m) => m.id === focusId) ?? list.find(needsYou) ?? list.find((m) => m.stage === "in-progress") ?? list[0] ?? null;
  }, [missions, focusId]);

  const waiting = (missions ?? []).filter(needsYou);
  const columns: [string, Stage[]][] = [["Briefing", ["briefing"]], ["In progress", ["in-progress"]], ["Review", ["review"]], ["Delivered", ["delivered", "stopped", "failed"]]];

  return (
    <div className="space-y-4" data-missions-tab>
      <section className="glass-strong flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <div className="glass-eyebrow">Missions</div>
          <h2 className="type-display mt-1 text-[28px] leading-tight">
            {stats ? (stats.waitingOnYou ? `${stats.waitingOnYou} decision${stats.waitingOnYou === 1 ? "" : "s"} waiting on you` : "Nothing is waiting on you") : "Reading missions…"}
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Write a brief, Jarvis plans it and picks the crew, you approve, the crew works in their own folders.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Missions view" className="glass-tabs">
            {(["desk", "board"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className="glass-tab">{v === "desk" ? "Desk" : "Board"}</button>)}
          </div>
          <button type="button" onClick={() => setWizard(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] glass neon-ring"><Plus size={14} /> New mission</button>
        </div>
      </section>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Mission stats">
          <Stat label="Waiting on you" value={String(stats.waitingOnYou)} hint="plans to approve and results to read" />
          <Stat label="Cycle time" value={stats.cycleTimeMin == null ? "–" : stats.cycleTimeMin < 90 ? `${stats.cycleTimeMin} min` : `${(stats.cycleTimeMin / 60).toFixed(1)} h`} hint={stats.cycleTimeMin == null ? "no mission delivered yet" : "median, brief to delivery"} />
          <Stat label="On time" value={stats.onTimePct == null ? "–" : `${stats.onTimePct}%`} hint={stats.onTimeOf ? `of ${stats.onTimeOf} with a target date` : "no delivered mission had a target date"} />
          <Stat label="Agents at work" value={String(stats.agentsAtWork)} hint="seats running right now" />
        </div>
      )}

      {missions && missions.length === 0 && (
        <section className="glass px-6 py-8 text-center">
          <p className="text-[13.5px] text-[var(--fg-dim)]">No missions yet. Start one with a brief; nothing runs until you approve Jarvis&apos;s plan.</p>
        </section>
      )}

      {view === "board" && missions && missions.length > 0 && <Board missions={missions} focus={focus} onPick={setFocusId} onChanged={load} now={now} />}

      {view === "desk" && focus && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
          <InFocus m={focus} now={now} />
          <Desk m={focus} waiting={waiting} onPick={setFocusId} onChanged={load} />
        </div>
      )}

      {view === "desk" && missions && missions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Mission stages">
          {columns.map(([label, stages]) => {
            const list = missions.filter((m) => stages.includes(m.stage));
            return (
              <section key={label} className="glass px-4 py-3">
                <div className="glass-eyebrow flex items-center justify-between">{label}<span className="type-figure opacity-70">{list.length}</span></div>
                <ul className="mt-2 space-y-2">
                  {list.length === 0 && <li className="text-[12px] text-[var(--fg-dimmer)]">None.</li>}
                  {list.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setFocusId(m.id)} aria-pressed={focus?.id === m.id}
                        className={`w-full rounded-xl px-3 py-2 text-left glass-inset ${focus?.id === m.id ? "neon-ring" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px]">{m.name}</span>
                          {m.stage !== stages[0] && <span className="text-[10.5px]" style={{ color: STAGE_TINT[m.stage] }}>{STAGE_LABEL[m.stage]}</span>}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--fg-dimmer)]">
                          {m.priority !== "normal" && `${m.priority} priority · `}{m.working ? `Jarvis is ${m.working}` : needsYou(m) ? "needs you" : ago(m.createdAt, now)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {focus && <Timeline id={focus.id} key={focus.id} live={focus.stage === "in-progress" || !!focus.working} />}
      {wizard && <Wizard crew={crew} onClose={() => setWizard(false)} onCreated={(id) => { setWizard(false); setFocusId(id); void load(); }} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glass px-5 py-4">
      <div className="glass-eyebrow">{label}</div>
      <div className="type-figure mt-1 text-[26px] leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-[var(--fg-dimmer)]">{hint}</div>
    </div>
  );
}

function Ring({ m, now }: { m: Mission; now: number }) {
  const total = m.limits.timeLimitMin * 60_000;
  const elapsed = m.launchedAt ? Math.min(total, (m.finishedAt ?? now) - m.launchedAt) : 0;
  const pct = total ? elapsed / total : 0;
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="relative h-[88px] w-[88px] shrink-0" role="img" aria-label={m.launchedAt ? `${Math.round(elapsed / 60_000)} of ${m.limits.timeLimitMin} minutes used` : `time limit ${m.limits.timeLimitMin} minutes, not started`}>
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
        <circle cx="44" cy="44" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle cx="44" cy="44" r={R} fill="none" stroke={pct > 0.85 ? "#fbbf24" : "#3b95ff"} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="type-figure text-[15px] leading-none">{m.launchedAt ? Math.round(elapsed / 60_000) : 0}</div>
          <div className="text-[9.5px] text-[var(--fg-dimmer)]">of {m.limits.timeLimitMin} min</div>
        </div>
      </div>
    </div>
  );
}

function InFocus({ m, now }: { m: Mission; now: number }) {
  const [open, setOpen] = useState<{ step: string; kind: "md" | "log"; text: string } | null>(null);
  const steps = m.plan?.steps ?? [];
  const title = (id: string) => steps.find((s) => s.id === id)?.title ?? id;
  const seat = (id: string) => m.seats.find((s) => s.id === id);
  const show = async (step: string, kind: "md" | "log") => {
    try { const j = await api<{ text: string }>(`/api/v2/missions/${m.id}?step=${step}&kind=${kind}`); setOpen({ step, kind, text: j.text || "(nothing yet)" }); }
    catch (e) { setOpen({ step, kind, text: `Could not read it: ${(e as Error).message}` }); }
  };
  return (
    <section className="glass-strong px-6 py-5" aria-label={`In focus: ${m.name}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="glass-eyebrow">In focus</div>
          <h3 className="type-display mt-1 truncate text-[22px]">{m.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="rounded-md px-2 py-0.5 glass-inset" style={{ color: STAGE_TINT[m.stage] }}>{STAGE_LABEL[m.stage]}</span>
            {m.working && <span className="inline-flex items-center gap-1 text-[var(--fg-dim)]"><Loader2 size={11} className="animate-spin" /> Jarvis is {m.working}</span>}
            <span className="text-[var(--fg-dimmer)]">{m.priority} priority{m.targetDate ? ` · due ${m.targetDate}` : ""} · {m.teamMode === "jarvis" ? "Jarvis picked the crew" : "crew chosen by you"}</span>
          </div>
          <p className="mt-2 text-[12.5px] text-[var(--fg-dim)]">{m.objective}</p>
          <p className="mt-1 text-[11.5px] text-[var(--fg-dimmer)]">Success: {m.successLooksLike}</p>
        </div>
        <Ring m={m} now={now} />
      </div>
      {m.error && <p role="alert" className="mt-3 rounded-lg px-3 py-2 text-[12px] text-red-300 glass-inset">{m.error}</p>}

      {m.plan ? (
        <>
          {m.plan.rationale && (
            <div className="mt-4">
              <div className="glass-eyebrow flex items-center gap-1.5"><Users size={11} /> Crew rationale</div>
              <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">{m.plan.rationale}</p>
            </div>
          )}
          <ol className="mt-4 space-y-2" aria-label="Steps">
            {steps.map((s, i) => {
              const st = seat(s.seatId);
              const waitsOn = s.status === "waiting" ? s.dependsOn.filter((d) => steps.find((x) => x.id === d)?.status !== "done") : [];
              return (
                <li key={s.id} className="glass flex items-start gap-3 px-4 py-3" data-step-status={s.status}>
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STEP_TINT[s.status], boxShadow: s.status === "running" ? `0 0 10px ${STEP_TINT.running}` : undefined }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="text-[var(--fg-dimmer)]">{i + 1}.</span>{s.title}
                      {s.status === "running" && <span className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] font-semibold text-[#3b95ff] glass-inset"><Radio size={10} className="animate-pulse" />LIVE</span>}
                      <span className="text-[11px] text-[var(--fg-dimmer)]">{st ? `${AGENT_LABEL[st.agent]}${st.model ? ` · ${st.model}` : ""}` : "?"}</span>
                    </div>
                    {waitsOn.length > 0 && <div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">Waits for {waitsOn.map((d) => `"${title(d)}"`).join(" and ")}</div>}
                    {s.status === "running" && <div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">Last heard {ago(s.lastHeardAt ?? s.startedAt, now)}{s.lastLine ? `: ${s.lastLine}` : ""}</div>}
                    {s.error && <div className="mt-0.5 text-[11.5px] text-red-300">{s.error}</div>}
                    {(s.status !== "waiting") && (
                      <div className="mt-1.5 flex gap-2">
                        {s.status === "done" && <button type="button" onClick={() => void show(s.id, "md")} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] glass"><FileText size={11} />Answer</button>}
                        <button type="button" onClick={() => void show(s.id, "log")} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] glass">Raw output</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {m.plan.guardrails.length > 0 && (
            <details className="mt-3 text-[12px]">
              <summary className="cursor-pointer text-[var(--fg-dim)]">Guardrails ({m.plan.guardrails.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--fg-dimmer)]">{m.plan.guardrails.map((g) => <li key={g}>{g}</li>)}</ul>
            </details>
          )}
        </>
      ) : (
        <p className="mt-4 text-[12.5px] text-[var(--fg-dimmer)]">{m.working === "planning" ? "Jarvis is writing the plan…" : "No plan yet."}</p>
      )}

      {m.result && (
        <div className="mt-4">
          <div className="glass-eyebrow">Report</div>
          <pre className="mt-1 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl p-3 text-[12.5px] leading-relaxed glass-inset">{m.result}</pre>
        </div>
      )}

      {open && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="glass-eyebrow">{title(open.step)} · {open.kind === "md" ? "answer" : "raw output"}</div>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="rounded p-1 hover:bg-white/5"><X size={13} /></button>
          </div>
          <pre className="mt-1 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl p-3 text-[12px] leading-relaxed glass-inset">{open.text}</pre>
        </div>
      )}
    </section>
  );
}

function Desk({ m, waiting, onPick, onChanged }: { m: Mission; waiting: Mission[]; onPick: (id: string) => void; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setNote(""); setErr(null); }, [m.id, m.stage]);
  const act = async (action: string) => {
    setBusy(action); setErr(null);
    try { await api(`/api/v2/missions/${m.id}`, { method: "POST", body: JSON.stringify({ action, note }) }); setNote(""); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };
  const planWaiting = m.stage === "briefing" && m.plan && !m.working;
  const btn = "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] glass disabled:opacity-50";
  return (
    <section className="glass-strong flex flex-col px-5 py-5" aria-label="Your desk">
      <div className="glass-eyebrow">Your desk</div>
      {waiting.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {waiting.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => onPick(w.id)} className={`w-full rounded-lg px-3 py-1.5 text-left text-[12.5px] ${w.id === m.id ? "glass neon-ring" : "glass-inset"}`}>
                {w.name}<span className="ml-1 text-[11px] text-[var(--fg-dimmer)]">· {w.stage === "review" ? "result to read" : "plan to approve"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Nothing needs you.</p>}

      <div className="mt-4 border-t border-white/5 pt-4">
        <div className="text-[13px]">{m.name}</div>
        {planWaiting && (
          <>
            <p className="mt-1 text-[12px] text-[var(--fg-dim)]">Jarvis&apos;s plan has {m.plan!.steps.length} step{m.plan!.steps.length === 1 ? "" : "s"}. Approve to launch it with a {m.limits.timeLimitMin}-minute limit.</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <button type="button" disabled={!!busy} onClick={() => void act("approve")} className={`${btn} neon-ring`}>{busy === "approve" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve plan</button>
            </div>
          </>
        )}
        {m.stage === "review" && (
          <>
            <p className="mt-1 text-[12px] text-[var(--fg-dim)]">The crew is done. Read the report, then accept it or send it back.</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <button type="button" disabled={!!busy} onClick={() => void act("accept")} className={`${btn} neon-ring`}>{busy === "accept" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept result</button>
            </div>
          </>
        )}
        {(planWaiting || m.stage === "review") && (
          <div className="mt-3">
            <label className="block text-[11.5px] text-[var(--fg-dim)]">
              Send back with a note
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What should change?" className="mt-1 w-full resize-y rounded-xl px-3 py-2 text-[12.5px] outline-none glass-inset" />
            </label>
            <button type="button" disabled={!!busy || !note.trim()} onClick={() => void act("send-back")} className={`${btn} mt-2 w-full`}>{busy === "send-back" ? <Loader2 size={13} className="animate-spin" /> : <CornerUpLeft size={13} />} Send back</button>
          </div>
        )}
        {m.stage === "briefing" && !m.plan && !m.working && (
          <button type="button" disabled={!!busy} onClick={() => void act("replan")} className={`${btn} mt-3 w-full`}><RotateCw size={13} /> Plan again</button>
        )}
        {m.stage === "briefing" && m.working && <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)]"><Loader2 size={12} className="animate-spin" /> Jarvis is planning. You approve before anything runs.</p>}
        {m.stage === "in-progress" && (
          <>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)]"><Clock size={12} /> Running{m.deadlineAt ? `, stops by ${new Date(m.deadlineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.</p>
            <button type="button" disabled={!!busy} onClick={() => void act("stop")} className={`${btn} mt-3 w-full`} style={{ color: "#fca5a5" }}>{busy === "stop" ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />} Stop the mission</button>
          </>
        )}
        {(m.stage === "delivered" || m.stage === "stopped" || m.stage === "failed") && <p className="mt-1 text-[12px] text-[var(--fg-dimmer)]">{STAGE_LABEL[m.stage]}{m.finishedAt ? ` ${new Date(m.finishedAt).toLocaleString()}` : ""}. Nothing to do.</p>}
        {err && <p role="alert" className="mt-2 text-[12px] text-red-300">{err}</p>}
      </div>
    </section>
  );
}

// ── S23 Mission board ────────────────────────────────────────────────────────
// Left: WAITING ON YOU (mission plans to approve and results to read, plus the agents'
// own approval queue from /api/agents/approvals, answerable here). Centre: a ring of the
// missions by state with real counts; a segment lists its missions. Right: delivered.
// Below: the chosen mission in detail. BLOCKED = failed or stopped, or a plan that could
// not be made; it says so on hover.
interface Approval { id: string; runId: string; agentId: string; agentName: string; kind?: "approval" | "question"; toolName: string; inputPreview: string; question?: string; createdAt: number }
type Seg = "flight" | "review" | "blocked" | "delivered";
const SEG: Record<Seg, { label: string; tint: string; of: (m: Mission) => boolean; hint: string }> = {
  flight: { label: "In flight", tint: "#3b95ff", of: (m) => m.stage === "in-progress", hint: "crew at work" },
  review: { label: "Review", tint: "#fbbf24", of: (m) => m.stage === "review", hint: "results waiting for you" },
  blocked: { label: "Blocked", tint: "#f87171", of: (m) => m.stage === "failed" || m.stage === "stopped" || (m.stage === "briefing" && !!m.error && !m.working), hint: "failed, stopped, or a plan that could not be made" },
  delivered: { label: "Delivered", tint: "#34d399", of: (m) => m.stage === "delivered", hint: "accepted or delivered" },
};

function Board({ missions, focus, onPick, onChanged, now }: { missions: Mission[]; focus: Mission | null; onPick: (id: string) => void; onChanged: () => void; now: number }) {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [apErr, setApErr] = useState<string | null>(null);
  const [seg, setSeg] = useState<Seg>("flight");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const loadApprovals = useCallback(async () => {
    try { const j = await api<{ approvals: Approval[] }>("/api/agents/approvals"); setApprovals(j.approvals); setApErr(null); }
    catch (e) { setApErr((e as Error).message); }
  }, []);
  useEffect(() => {
    void loadApprovals();
    const t = setInterval(() => { if (!document.hidden) void loadApprovals(); }, 10_000);
    return () => clearInterval(t);
  }, [loadApprovals]);
  const decide = async (a: Approval, body: Record<string, unknown>) => {
    setBusy(a.id);
    try { await api("/api/agents/approvals", { method: "POST", body: JSON.stringify({ id: a.id, ...body }) }); await loadApprovals(); }
    catch (e) { setApErr((e as Error).message); } finally { setBusy(null); }
  };

  const counts = (Object.keys(SEG) as Seg[]).map((k) => [k, missions.filter(SEG[k].of).length] as const);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  const queued = missions.filter((m) => m.stage === "briefing" && !SEG.blocked.of(m)).length;
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const waitingMissions = missions.filter(needsYou);
  const list = missions.filter(SEG[seg].of);

  return (
    <div className="space-y-3" data-mission-board>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px_1fr]">
        <section className="glass px-5 py-4" aria-label="Waiting on you">
          <div className="glass-eyebrow">Waiting on you <span className="type-figure opacity-70">{waitingMissions.length + (approvals?.length ?? 0)}</span></div>
          <ul className="mt-2 space-y-2">
            {waitingMissions.map((m) => (
              <li key={m.id}><button type="button" onClick={() => onPick(m.id)} className={`w-full rounded-xl px-3 py-2 text-left glass-inset ${focus?.id === m.id ? "neon-ring" : ""}`}>
                <div className="text-[13px]">{m.name}</div><div className="text-[11px]" style={{ color: STAGE_TINT[m.stage] }}>{m.stage === "review" ? "Result to read" : "Plan to approve"}</div>
              </button></li>
            ))}
            {(approvals ?? []).map((a) => (
              <li key={a.id} className="rounded-xl px-3 py-2 glass-inset">
                <div className="text-[12.5px]">{a.agentName} <span className="text-[11px] text-[var(--fg-dimmer)]">{a.kind === "question" ? "asks" : `wants to use ${a.toolName}`}</span></div>
                {a.kind === "question"
                  ? (<>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--fg-dim)]">{a.question}</p>
                      <div className="mt-1.5 flex gap-1.5">
                        <input value={reply[a.id] ?? ""} onChange={(e) => setReply({ ...reply, [a.id]: e.target.value })} aria-label={`Reply to ${a.agentName}`} placeholder="Your reply" className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[12px] outline-none glass" />
                        <button type="button" disabled={busy === a.id || !(reply[a.id] ?? "").trim()} onClick={() => void decide(a, { answer: reply[a.id] })} className="rounded-lg px-2 py-1 text-[11.5px] glass neon-ring disabled:opacity-40">Reply</button>
                      </div>
                    </>)
                  : (<>
                      <pre className="mt-1 max-h-[90px] overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[10.5px] glass">{a.inputPreview}</pre>
                      <div className="mt-1.5 flex gap-1.5">
                        <button type="button" disabled={busy === a.id} onClick={() => void decide(a, { decision: "allow" })} className="rounded-lg px-2.5 py-1 text-[11.5px] glass neon-ring disabled:opacity-40">Allow</button>
                        <button type="button" disabled={busy === a.id} onClick={() => void decide(a, { decision: "deny" })} className="rounded-lg px-2.5 py-1 text-[11.5px] glass disabled:opacity-40">Deny</button>
                      </div>
                    </>)}
              </li>
            ))}
            {waitingMissions.length === 0 && (approvals?.length ?? 0) === 0 && <li className="text-[12px] text-[var(--fg-dimmer)]">Nothing needs you.</li>}
          </ul>
          {apErr && <p role="alert" className="mt-2 text-[11.5px] text-red-300">Agent approvals unavailable: {apErr}</p>}
        </section>

        <section className="glass flex flex-col items-center px-4 py-4" aria-label="Missions by state">
          <svg viewBox="0 0 180 180" className="w-full max-w-[220px] -rotate-90">
            <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="16" />
            {total > 0 && counts.map(([k, c]) => {
              if (!c) return null;
              const len = (c / total) * C, dash = `${Math.max(0, len - 3)} ${C}`, off = -offset;
              offset += len;
              return <circle key={k} cx="90" cy="90" r={R} fill="none" stroke={SEG[k].tint} strokeOpacity={seg === k ? 1 : 0.55} strokeWidth={seg === k ? 18 : 14} strokeDasharray={dash} strokeDashoffset={off} onClick={() => setSeg(k)} className="cursor-pointer" />;
            })}
          </svg>
          <div className="-mt-[132px] mb-[84px] text-center">
            <div className="type-figure text-[26px] leading-none">{total}</div>
            <div className="text-[10.5px] text-[var(--fg-dimmer)]">missions{queued ? `, ${queued} queued` : ""}</div>
          </div>
          <div className="grid w-full grid-cols-2 gap-1.5">
            {counts.map(([k, c]) => (
              <button key={k} type="button" aria-pressed={seg === k} title={SEG[k].hint} onClick={() => setSeg(k)} className={`rounded-lg px-2 py-1 text-left text-[11.5px] ${seg === k ? "glass neon-ring" : "glass-inset"}`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SEG[k].tint }} />{SEG[k].label} <span className="type-figure">{c}</span>
              </button>
            ))}
          </div>
          <ul className="mt-3 w-full space-y-1">
            {list.length === 0 && <li className="text-center text-[11.5px] text-[var(--fg-dimmer)]">None {SEG[seg].label.toLowerCase()}.</li>}
            {list.map((m) => <li key={m.id}><button type="button" onClick={() => onPick(m.id)} className={`w-full truncate rounded-lg px-2.5 py-1 text-left text-[12px] ${focus?.id === m.id ? "glass neon-ring" : "hover:bg-white/5"}`}>{m.name}</button></li>)}
          </ul>
        </section>

        <section className="glass px-5 py-4" aria-label="Delivered">
          <div className="glass-eyebrow">Delivered <span className="type-figure opacity-70">{missions.filter(SEG.delivered.of).length}</span></div>
          <ul className="mt-2 space-y-2">
            {missions.filter(SEG.delivered.of).length === 0 && <li className="text-[12px] text-[var(--fg-dimmer)]">Nothing delivered yet.</li>}
            {missions.filter(SEG.delivered.of).map((m) => (
              <li key={m.id}><button type="button" onClick={() => onPick(m.id)} className={`w-full rounded-xl px-3 py-2 text-left glass-inset ${focus?.id === m.id ? "neon-ring" : ""}`}>
                <div className="truncate text-[13px]">{m.name}</div>
                <div className="text-[11px] text-[var(--fg-dimmer)]">{m.deliveredAt ? `delivered ${ago(m.deliveredAt, now)}` : "delivered"}{m.plan ? ` · ${m.plan.steps.length} step${m.plan.steps.length === 1 ? "" : "s"}` : ""}</div>
              </button></li>
            ))}
          </ul>
        </section>
      </div>
      {focus && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
          <InFocus m={focus} now={now} />
          <Desk m={focus} waiting={missions.filter(needsYou)} onPick={onPick} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}


function Timeline({ id, live }: { id: string; live: boolean }) {
  const [events, setEvents] = useState<MissionEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    const load = async () => {
      try { const j = await api<{ events: MissionEvent[] }>(`/api/v2/missions/${id}`); if (!off) { setEvents(j.events); setErr(null); } }
      catch (e) { if (!off) setErr((e as Error).message); }
    };
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, live ? 3000 : 20000);
    return () => { off = true; clearInterval(t); };
  }, [id, live]);
  return (
    <section className="glass px-6 py-5" aria-label="What happened, in order">
      <div className="glass-eyebrow">What happened, in order</div>
      {err && <p role="alert" className="mt-2 text-[12px] text-red-300">{err}</p>}
      {!events && !err && <p className="mt-2 text-[12px] text-[var(--fg-dimmer)]">Reading…</p>}
      <ol className="mt-3 space-y-2">
        {(events ?? []).map((e, i) => (
          <li key={i} className="flex gap-3 text-[12.5px]">
            <span className="type-figure w-[72px] shrink-0 text-[11px] text-[var(--fg-dimmer)]">{clock(e.at)}</span>
            <div className="min-w-0 flex-1">
              <span className={e.kind.endsWith("failed") || e.kind === "timeout" ? "text-red-300" : ""}>{e.text}</span>
              {e.brief && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11.5px] text-[var(--fg-dim)]">The brief it was sent</summary>
                  <pre className="mt-1 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[11.5px] leading-relaxed glass-inset">{e.brief}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── create-a-mission wizard ─────────────────────────────────────────────────
interface DraftSeat { agent: Agent; model: string; role: string }

function Wizard({ crew, onClose, onCreated }: { crew: Crew[]; onClose: () => void; onCreated: (id: string) => void }) {
  const installed = crew.filter((c) => c.installed);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [success, setSuccess] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [targetDate, setTargetDate] = useState("");
  const [teamMode, setTeamMode] = useState<"jarvis" | "manual">("jarvis");
  const [seats, setSeats] = useState<DraftSeat[]>(installed.length ? [{ agent: installed[0].agent, model: "", role: "" }] : []);
  const [timeLimitMin, setTimeLimit] = useState(60);
  const [maxSteps, setMaxSteps] = useState(5);
  const [reportLength, setReportLength] = useState<"brief" | "standard" | "detailed">("standard");
  const [endAction, setEndAction] = useState<"review" | "deliver">("review");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canNext = step === 0 ? !!(name.trim() && objective.trim() && success.trim()) : step === 1 ? teamMode === "jarvis" || seats.length > 0 : true;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const j = await api<{ mission: Mission }>("/api/v2/missions", {
        method: "POST",
        body: JSON.stringify({ name, objective, successLooksLike: success, priority, targetDate: targetDate || undefined, teamMode, seats: teamMode === "manual" ? seats : undefined, timeLimitMin, maxSteps, reportLength, endAction }),
      });
      onCreated(j.mission.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const input = "mt-1 w-full rounded-xl px-3 py-2 text-[13px] outline-none glass-inset focus:ring-1 focus:ring-[#3b95ff]";
  const seg = (on: boolean) => `rounded-lg px-3 py-1.5 text-[12px] ${on ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`;
  const hours = (n: number) => (n < 60 ? `${n} min` : n % 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n / 60} h`);

  return (
    <div role="dialog" aria-modal="true" aria-label="Create a mission" className="fixed inset-0 z-[96] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} aria-hidden />
      <div className="glass-strong relative flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(22,19,34,0.97), rgba(10,9,18,0.97))" }}>
        <header className="flex items-start justify-between px-6 pt-5">
          <div>
            <div className="glass-eyebrow">New mission · step {step + 1} of 3</div>
            <h2 className="type-display mt-1 text-[22px]">{["The brief", "The crew", "Limits and launch"][step]}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/5"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4 text-[13px]">
          {step === 0 && (<>
            <label className="block">Name<input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Competitor pricing sweep" /></label>
            <label className="block">Objective: the deliverable<textarea className={input} rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should exist at the end?" /></label>
            <label className="block">What success looks like<textarea className={input} rows={2} value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="How you will judge it" /></label>
            <div className="flex flex-wrap items-end gap-4">
              <fieldset><legend className="mb-1">Priority</legend>
                <div className="flex gap-1.5">{(["low", "normal", "high"] as const).map((p) => <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} className={seg(priority === p)}>{p}</button>)}</div>
              </fieldset>
              <label className="block">Target date <span className="text-[11px] text-[var(--fg-dimmer)]">(optional)</span><input type="date" className={input} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></label>
            </div>
          </>)}

          {step === 1 && (<>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" aria-pressed={teamMode === "jarvis"} onClick={() => setTeamMode("jarvis")} className={`rounded-xl px-4 py-3 text-left ${teamMode === "jarvis" ? "glass neon-ring" : "glass-inset"}`}>
                <div className="text-[13px]">Jarvis picks the team <span className="text-[10.5px] text-[#34d399]">recommended</span></div>
                <div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">From the installed CLIs: {installed.map((c) => AGENT_LABEL[c.agent]).join(", ") || "none"}. You approve the team and the plan before anything runs.</div>
              </button>
              <button type="button" aria-pressed={teamMode === "manual"} onClick={() => setTeamMode("manual")} className={`rounded-xl px-4 py-3 text-left ${teamMode === "manual" ? "glass neon-ring" : "glass-inset"}`}>
                <div className="text-[13px]">I&apos;ll choose</div>
                <div className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">Pick each crew member, its model and its role.</div>
              </button>
            </div>
            {teamMode === "manual" && (
              <div className="space-y-2">
                {seats.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
                    <select aria-label={`Crew ${i + 1} agent`} className={input} value={s.agent} onChange={(e) => setSeats(seats.map((x, j) => (j === i ? { ...x, agent: e.target.value as Agent } : x)))}>
                      {installed.map((c) => <option key={c.agent} value={c.agent}>{AGENT_LABEL[c.agent]}</option>)}
                    </select>
                    <input aria-label={`Crew ${i + 1} model`} className={input} value={s.model} placeholder={crew.find((c) => c.agent === s.agent)?.defaultModel ?? "its default model"} onChange={(e) => setSeats(seats.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} />
                    <input aria-label={`Crew ${i + 1} role`} className={input} value={s.role} placeholder="role, e.g. researcher" onChange={(e) => setSeats(seats.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                    <button type="button" aria-label="Remove" onClick={() => setSeats(seats.filter((_, j) => j !== i))} className="mt-1 rounded-lg px-2 glass"><X size={12} /></button>
                  </div>
                ))}
                {seats.length < 6 && installed.length > 0 && <button type="button" onClick={() => setSeats([...seats, { agent: installed[0].agent, model: "", role: "" }])} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] glass"><Plus size={12} /> Add crew member</button>}
              </div>
            )}
            <p className="text-[11.5px] text-[var(--fg-dimmer)]">Every seat works in its own scratch folder. Claude and Hermes stop at 50 turns; Codex and Antigravity have no turn flag, so the mission&apos;s time limit bounds them.</p>
          </>)}

          {step === 2 && (<>
            <label className="block">Time limit: <span className="type-figure">{hours(timeLimitMin)}</span>
              <input type="range" min={15} max={480} step={15} value={timeLimitMin} onChange={(e) => setTimeLimit(Number(e.target.value))} className="mt-2 w-full" aria-valuetext={hours(timeLimitMin)} />
            </label>
            <label className="block">Maximum steps: <span className="type-figure">{maxSteps}</span>
              <input type="range" min={1} max={12} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} className="mt-2 w-full" />
            </label>
            <fieldset><legend className="mb-1">Report length</legend>
              <div className="flex gap-1.5">{(["brief", "standard", "detailed"] as const).map((r) => <button key={r} type="button" aria-pressed={reportLength === r} onClick={() => setReportLength(r)} className={seg(reportLength === r)}>{r}</button>)}</div>
            </fieldset>
            <fieldset><legend className="mb-1">At the end</legend>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={endAction === "review"} onClick={() => setEndAction("review")} className={seg(endAction === "review")}>Send me the result to review first</button>
                <button type="button" aria-pressed={endAction === "deliver"} onClick={() => setEndAction("deliver")} className={seg(endAction === "deliver")}>Deliver it</button>
              </div>
            </fieldset>
            <div className="rounded-xl px-4 py-3 text-[12px] text-[var(--fg-dim)] glass-inset">
              <b className="text-[var(--fg)]">{name || "Untitled"}</b>, {priority} priority{targetDate ? `, due ${targetDate}` : ""}. {teamMode === "jarvis" ? "Jarvis picks the crew" : `${seats.length} crew member${seats.length === 1 ? "" : "s"}`}, up to {maxSteps} step{maxSteps === 1 ? "" : "s"}, {hours(timeLimitMin)}.
              Jarvis plans first; nothing runs until you approve the plan.
            </div>
          </>)}
          {err && <p role="alert" className="text-[12px] text-red-300">{err}</p>}
        </div>
        <footer className="flex justify-between px-6 pb-5">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-40"><ChevronLeft size={13} /> Back</button>
          {step < 2
            ? <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring disabled:opacity-40">Next <ChevronRight size={13} /></button>
            : <button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass neon-ring">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Create and plan</button>}
        </footer>
      </div>
    </div>
  );
}
