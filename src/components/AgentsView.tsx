"use client";

// Agents — the local Tasklet. Reusable background agents on the Claude Agent SDK:
// create an agent (instructions + permission dial + intelligence dial), fire it
// manually (triggers arrive in Phase 3), watch the run live, and answer approval
// cards when a gated/constitution action wants out.

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Play, Plus, ShieldAlert, Square, X, ChevronRight, RefreshCw, Loader2, ThumbsUp, ThumbsDown, MessageCircleQuestion } from "lucide-react";
import type { AgentDef, AgentTrigger, ApprovalReq, McpServerHealth, RunEvent, RunMeta } from "@/lib/agentsTypes";
import { INTELLIGENCE_META, MODE_META, STATUS_COLORS } from "@/lib/agentsTypes";
import ModelSettings from "./ModelSettings";

const VIOLET = "#a78bfa";

type AgentCard = AgentDef & { lastRun: RunMeta | null; active: boolean };

export function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export default function AgentsView() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [approvals, setApprovals] = useState<ApprovalReq[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/agents").then((r) => r.json());
      if (Array.isArray(j.agents)) setAgents(j.agents);
      setLoaded(true);
    } catch { /* server asleep — next tick */ }
  }, []);

  const refreshApprovals = useCallback(async () => {
    try {
      const j = await fetch("/api/agents/approvals").then((r) => r.json());
      if (Array.isArray(j.approvals)) setApprovals(j.approvals);
    } catch { /* fine */ }
  }, []);

  useEffect(() => {
    void refresh(); void refreshApprovals();
    const a = setInterval(refresh, 5000);
    const b = setInterval(refreshApprovals, 3000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refresh, refreshApprovals]);

  async function decide(id: string, decision: "allow" | "deny") {
    setApprovals((l) => l.filter((x) => x.id !== id));
    await fetch("/api/agents/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }) }).catch(() => {});
  }

  // Answering a parked question — same endpoint, `answer` instead of `decision`.
  async function answer(id: string, text: string) {
    setApprovals((l) => l.filter((x) => x.id !== id));
    await fetch("/api/agents/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer: text }) }).catch(() => {});
    void refresh();
  }

  async function runNow(id: string) {
    await fetch(`/api/agents/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    void refresh();
    setOpenId(id);
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold flex items-center gap-2.5" style={{ color: "var(--fg)" }}>
          <Bot size={20} style={{ color: VIOLET }} /> Agents
        </h1>
        <div className="flex items-center gap-2">
          <ModelSettings section="agentsModels" title="Agents intelligence dial" accent={VIOLET}
            fields={[
              { key: "fast", label: "Fast tier", placeholder: "claude-haiku-4-5", hint: "Cheap triage/routing runs." },
              { key: "standard", label: "Standard tier", placeholder: "claude-sonnet-5", hint: "The default for most agents; also the curator." },
              { key: "deep", label: "Deep tier", placeholder: "blank = pinned CLAUDE_MODEL", hint: "Research and judgment-heavy agents." },
            ]} />
          <button onClick={() => setCreating(true)}
            className="px-3.5 h-9 rounded-lg border text-[13px] flex items-center gap-1.5 transition hover:brightness-125"
            style={{ borderColor: `${VIOLET}66`, color: VIOLET, background: "rgba(167,139,250,0.10)" }}>
            <Plus size={14} /> New agent
          </button>
        </div>
      </div>
      <p className="text-[12.5px] mb-5" style={{ color: "var(--fg-dimmer)" }}>
        Reusable background agents — your tools, your subscriptions, your machine. Runs pause for approval before anything leaves the box.
      </p>

      <ApprovalsStrip approvals={approvals} onDecide={decide} onAnswer={(id, text) => void answer(id, text)} />

      {loaded && agents.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
          <Bot size={28} className="mx-auto mb-3" style={{ color: VIOLET }} />
          <div className="text-[14px] mb-1" style={{ color: "var(--fg)" }}>No agents yet</div>
          <div className="text-[12.5px] mb-4" style={{ color: "var(--fg-dimmer)" }}>
            Describe a standing job in plain English — triage my inbox, watch this feed, keep this report fresh.
          </div>
          <button onClick={() => setCreating(true)} className="px-4 h-9 rounded-lg border text-[13px]" style={{ borderColor: `${VIOLET}66`, color: VIOLET }}>Create the first one</button>
        </div>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <button key={a.id} onClick={() => setOpenId(a.id)}
            className="text-left rounded-2xl border p-4 transition hover:brightness-110 relative overflow-hidden"
            style={{ borderColor: a.active ? `${STATUS_COLORS.running}66` : "var(--panel-border)", background: "rgba(255,255,255,0.02)", opacity: a.enabled ? 1 : 0.55 }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[14px] font-medium truncate" style={{ color: "var(--fg)" }}>{a.name}</span>
              <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                style={{ borderColor: `${MODE_META[a.permissionMode].color}55`, color: MODE_META[a.permissionMode].color }}>
                {MODE_META[a.permissionMode].label}
              </span>
            </div>
            {a.description && <div className="text-[12px] mb-2 line-clamp-2" style={{ color: "var(--fg-dim)" }}>{a.description}</div>}
            <div className="flex items-center gap-2 text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
              <span>{INTELLIGENCE_META[a.intelligence].label}</span>
              <span>·</span>
              {a.active ? (
                <span className="flex items-center gap-1" style={{ color: STATUS_COLORS.running }}>
                  <Loader2 size={10} className="animate-spin" /> running
                </span>
              ) : a.lastRun ? (
                <span style={{ color: STATUS_COLORS[a.lastRun.status] }}>{a.lastRun.status} · {ago(a.lastRun.startedAt)}</span>
              ) : (
                <span>never run</span>
              )}
              {!a.enabled && <><span>·</span><span>disabled</span></>}
            </div>
          </button>
        ))}
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void refresh(); setOpenId(id); }} />}
      {openId && <AgentDrawer id={openId} onClose={() => { setOpenId(null); void refresh(); }} onRun={runNow} />}
    </div>
  );
}

// ---- approvals strip (shared with the v2 agents page) ---------------------
//
// Two card kinds share the strip, because to the user they are the same event:
// a run stopped and needs them. kind "question" renders a reply box instead of
// Approve/Deny — the answer goes back into the run's still-open input queue and
// it carries on from where it stopped.

export function ApprovalsStrip({ approvals, onDecide, onAnswer }: {
  approvals: ApprovalReq[];
  onDecide: (id: string, decision: "allow" | "deny") => void;
  onAnswer?: (id: string, answer: string) => void;
}) {
  if (approvals.length === 0) return null;
  const questions = approvals.filter((a) => a.kind === "question").length;
  return (
    <div className="mb-5 rounded-2xl border p-4 space-y-3" style={{ borderColor: "rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.06)" }}>
      <div className="text-[11px] font-mono uppercase tracking-widest flex items-center gap-2 text-amber-300">
        <ShieldAlert size={13} /> Waiting on you — {approvals.length} pending
        {questions > 0 ? ` (${questions} question${questions > 1 ? "s" : ""})` : ` action${approvals.length > 1 ? "s" : ""}`}
      </div>
      {approvals.map((a) => (
        a.kind === "question" ? (
          <QuestionCard key={a.id} req={a} onAnswer={onAnswer} onSkip={() => onDecide(a.id, "deny")} />
        ) : (
          <div key={a.id} className="rounded-xl border p-3" style={{ borderColor: "rgba(251,191,36,0.3)", background: "rgba(0,0,0,0.25)" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px]" style={{ color: "var(--fg)" }}>
                <b>{a.agentName}</b> wants <code className="text-amber-300">{a.toolName}</code>
                <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ borderColor: "rgba(251,191,36,0.4)", color: "#fbbf24" }}>{a.reason}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onDecide(a.id, "allow")} className="px-3 h-8 rounded-lg border text-[12px] text-emerald-300" style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.10)" }}>Approve</button>
                <button onClick={() => onDecide(a.id, "deny")} className="px-3 h-8 rounded-lg border text-[12px] text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.08)" }}>Deny</button>
              </div>
            </div>
            <pre className="mt-2 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto" style={{ color: "var(--fg-dim)" }}>{a.inputPreview}</pre>
          </div>
        )
      ))}
    </div>
  );
}

function QuestionCard({ req, onAnswer, onSkip }: { req: ApprovalReq; onAnswer?: (id: string, answer: string) => void; onSkip: () => void }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  function send() {
    const text = draft.trim();
    if (!text || !onAnswer) return;
    setSending(true);
    onAnswer(req.id, text);
  }

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "rgba(251,191,36,0.45)", background: "rgba(0,0,0,0.25)" }}>
      <div className="flex items-center gap-2 flex-wrap text-[13px]" style={{ color: "var(--fg)" }}>
        <MessageCircleQuestion size={14} className="text-amber-300 shrink-0" />
        <b>{req.agentName}</b> is asking you
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ borderColor: "rgba(251,191,36,0.4)", color: "#fbbf24" }}>question</span>
      </div>
      <div className="mt-2 text-[12.5px] whitespace-pre-wrap" style={{ color: "var(--fg-dim)" }}>{req.question ?? req.inputPreview}</div>
      <div className="mt-2.5 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          placeholder="Your answer — it goes straight back into the running agent (Ctrl+Enter)"
          rows={2}
          disabled={sending}
          className="flex-1 bg-black/40 border rounded-lg px-2.5 py-2 text-[12.5px] outline-none resize-y disabled:opacity-50"
          style={{ borderColor: "rgba(251,191,36,0.35)", color: "var(--fg)" }}
        />
        <div className="flex flex-col gap-1.5">
          <button onClick={send} disabled={sending || !draft.trim()}
            className="px-3 h-8 rounded-lg border text-[12px] text-emerald-300 disabled:opacity-40"
            style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.10)" }}>
            {sending ? "Sending…" : "Reply"}
          </button>
          <button onClick={onSkip} disabled={sending}
            className="px-3 h-8 rounded-lg border text-[11.5px] disabled:opacity-40"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}
            title="End the run unanswered instead of replying">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- create ---------------------------------------------------------------

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<AgentDef["permissionMode"]>("gated");
  const [intel, setIntel] = useState<AgentDef["intelligence"]>("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !instructions.trim()) { setErr("Name and instructions are required."); return; }
    setBusy(true); setErr(null);
    try {
      const j = await fetch("/api/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, instructions, permissionMode: mode, intelligence: intel }),
      }).then((r) => r.json());
      if (j.agent?.id) onCreated(j.agent.id);
      else setErr(j.error || "create failed");
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border p-5 space-y-3.5" style={{ borderColor: `${VIOLET}44`, background: "rgba(14,16,26,0.98)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>New agent</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--fg-dim)" }}><X size={15} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Inbox Triage"
          className="w-full bg-black/30 border rounded-lg px-3.5 h-10 text-sm outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-liner for the card (optional)"
          className="w-full bg-black/30 border rounded-lg px-3.5 h-10 text-sm outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={6}
          placeholder={"Standing instructions — what this agent does every time it runs.\nBe concrete: what to check, what good output looks like, where to leave results."}
          className="w-full bg-black/30 border rounded-lg px-3.5 py-2.5 text-sm outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <div className="grid grid-cols-2 gap-3">
          <ModePicker value={mode} onChange={setMode} />
          <IntelPicker value={intel} onChange={setIntel} />
        </div>
        {err && <div className="text-[12px] text-rose-300">{err}</div>}
        <button onClick={create} disabled={busy}
          className="w-full h-10 rounded-lg border text-[13px] disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ borderColor: `${VIOLET}66`, color: VIOLET, background: "rgba(167,139,250,0.10)" }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create agent
        </button>
      </div>
    </div>
  );
}

export function ModePicker({ value, onChange }: { value: AgentDef["permissionMode"]; onChange: (m: AgentDef["permissionMode"]) => void }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Permissions</div>
      <div className="flex gap-1.5">
        {(Object.keys(MODE_META) as AgentDef["permissionMode"][]).map((m) => (
          <button key={m} onClick={() => onChange(m)} title={MODE_META[m].blurb}
            className="flex-1 h-8 rounded-lg border text-[11.5px] transition"
            style={{
              borderColor: value === m ? MODE_META[m].color : "var(--panel-border)",
              color: value === m ? MODE_META[m].color : "var(--fg-dim)",
              background: value === m ? `${MODE_META[m].color}18` : "transparent",
            }}>
            {MODE_META[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IntelPicker({ value, onChange }: { value: AgentDef["intelligence"]; onChange: (m: AgentDef["intelligence"]) => void }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Intelligence</div>
      <div className="flex gap-1.5">
        {(Object.keys(INTELLIGENCE_META) as AgentDef["intelligence"][]).map((m) => (
          <button key={m} onClick={() => onChange(m)} title={INTELLIGENCE_META[m].blurb}
            className="flex-1 h-8 rounded-lg border text-[11.5px] transition"
            style={{
              borderColor: value === m ? VIOLET : "var(--panel-border)",
              color: value === m ? VIOLET : "var(--fg-dim)",
              background: value === m ? "rgba(167,139,250,0.12)" : "transparent",
            }}>
            {INTELLIGENCE_META[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- drawer ---------------------------------------------------------------

function AgentDrawer({ id, onClose, onRun }: { id: string; onClose: () => void; onRun: (id: string) => void }) {
  const [agent, setAgent] = useState<AgentDef | null>(null);
  const [system, setSystem] = useState("");
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [active, setActive] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const j = await fetch(`/api/agents/${id}`).then((r) => r.json());
      if (j.agent) { setAgent(j.agent); setSystem(j.system ?? ""); setRuns(j.runs ?? []); setActive(!!j.active); }
    } catch { /* fine */ }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-open the newest live run so "Run now" lands you in the transcript.
  useEffect(() => {
    if (active && !openRun && runs[0] && (runs[0].status === "running" || runs[0].status === "waiting")) setOpenRun(runs[0].id);
  }, [active, runs, openRun]);

  async function patch(p: Record<string, unknown>) {
    await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(() => {});
    void load();
  }

  async function exile() {
    if (!confirm(`Exile "${agent?.name}"? The agent and its history move to the exile folder (recoverable).`)) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" }).catch(() => {});
    onClose();
  }

  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-2xl h-full overflow-y-auto border-l p-5 space-y-4" style={{ borderColor: `${VIOLET}33`, background: "rgba(12,14,22,0.99)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Bot size={17} style={{ color: VIOLET }} />
            <span className="text-[16px] font-medium truncate" style={{ color: "var(--fg)" }}>{agent.name}</span>
            <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
              style={{ borderColor: `${MODE_META[agent.permissionMode].color}55`, color: MODE_META[agent.permissionMode].color }}>
              {MODE_META[agent.permissionMode].label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onRun(id)} disabled={active}
              className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 disabled:opacity-40 text-emerald-300"
              style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.10)" }}>
              <Play size={12} /> Run now
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--fg-dim)" }}><X size={15} /></button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <ModePicker value={agent.permissionMode} onChange={(m) => void patch({ permissionMode: m })} />
          <IntelPicker value={agent.intelligence} onChange={(m) => void patch({ intelligence: m })} />
          <label className="flex items-center gap-2 text-[12px] mt-5 cursor-pointer" style={{ color: "var(--fg-dim)" }}>
            <input type="checkbox" checked={agent.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} /> Enabled
          </label>
          <button onClick={exile} className="mt-5 text-[11px] text-rose-300/70 hover:text-rose-300 transition">Exile agent</button>
        </div>

        <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Instructions (system.md)</span>
            {!editing ? (
              <button onClick={() => { setDraft(system); setEditing(true); }} className="text-[11px]" style={{ color: VIOLET }}>Edit</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={async () => { await patch({ instructions: draft }); setSystem(draft); setEditing(false); }} className="text-[11px] text-emerald-300">Save</button>
                <button onClick={() => setEditing(false)} className="text-[11px]" style={{ color: "var(--fg-dim)" }}>Cancel</button>
              </div>
            )}
          </div>
          {editing ? (
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8}
              className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          ) : (
            <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: "var(--fg-dim)" }}>{system || "(empty)"}</pre>
          )}
        </div>

        <TriggersEditor agent={agent} onSave={(triggers) => void patch({ triggers })} />

        <div>
          <div className="flex items-center gap-2 mb-2">
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the next run…"
              className="flex-1 bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            <button
              onClick={async () => {
                await fetch(`/api/agents/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).catch(() => {});
                setNote(""); void load();
              }}
              disabled={active}
              className="px-3 h-9 rounded-lg border text-[12px] disabled:opacity-40" style={{ borderColor: `${VIOLET}55`, color: VIOLET }}>
              Run with note
            </button>
          </div>

          <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Runs</div>
          {runs.length === 0 && <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No runs yet.</div>}
          <div className="space-y-1.5">
            {runs.map((r) => (
              <button key={r.id} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                className="w-full text-left rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2.5 transition hover:brightness-110"
                style={{ borderColor: openRun === r.id ? `${VIOLET}55` : "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[r.status] }} />
                <span style={{ color: "var(--fg-dim)" }}>{r.trigger}</span>
                <span className="font-mono text-[10.5px]" style={{ color: STATUS_COLORS[r.status] }}>{r.status}</span>
                <span className="font-mono text-[10.5px] ml-auto" style={{ color: "var(--fg-dimmer)" }}>
                  {ago(r.startedAt)}{typeof r.numTurns === "number" ? ` · ${r.numTurns} turns` : ""}
                </span>
                <ChevronRight size={12} style={{ color: "var(--fg-dimmer)", transform: openRun === r.id ? "rotate(90deg)" : "none" }} />
              </button>
            ))}
          </div>
        </div>

        {openRun && <RunView agentId={id} runId={openRun} />}
      </div>
    </div>
  );
}

// ---- triggers editor ------------------------------------------------------

function trigSummary(t: AgentTrigger): string {
  switch (t.type) {
    case "manual": return "Manual";
    case "webhook": return "Webhook";
    case "gmail": return `Gmail · "${t.query}" · every ${t.intervalMin}m`;
    case "webwatch": return `Watch · ${t.url} · every ${t.intervalMin}m`;
    case "filewatch": return `Files · ${t.path}${t.glob ? ` · ${t.glob}` : ""}`;
    case "schedule": return `Cron · ${t.cron}`;
  }
}

export function TriggersEditor({ agent, onSave }: { agent: AgentDef; onSave: (t: AgentTrigger[]) => void }) {
  const [adding, setAdding] = useState<AgentTrigger["type"] | null>(null);
  const [f1, setF1] = useState("");  // query / url / path / cron
  const [f2, setF2] = useState("");  // interval / glob

  function remove(i: number) {
    onSave(agent.triggers.filter((_, idx) => idx !== i));
  }

  function add() {
    let t: AgentTrigger | null = null;
    const iv = Math.max(parseInt(f2) || 30, 5);
    if (adding === "webhook") t = { type: "webhook", secret: crypto.randomUUID().replace(/-/g, "") };
    else if (adding === "gmail" && f1.trim()) t = { type: "gmail", query: f1.trim(), intervalMin: Math.max(iv, 10) };
    else if (adding === "webwatch" && f1.trim()) t = { type: "webwatch", url: f1.trim(), intervalMin: iv };
    else if (adding === "filewatch" && f1.trim()) t = { type: "filewatch", path: f1.trim(), glob: f2.trim() || undefined };
    else if (adding === "schedule" && f1.trim()) t = { type: "schedule", cron: f1.trim() };
    if (!t) return;
    onSave([...agent.triggers, t]);
    setAdding(null); setF1(""); setF2("");
  }

  const webhook = agent.triggers.find((t): t is Extract<AgentTrigger, { type: "webhook" }> => t.type === "webhook");

  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
      <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--fg-dimmer)" }}>Triggers</div>
      <div className="space-y-1.5 mb-2.5">
        {agent.triggers.map((t, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px] rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--panel-border)" }}>
            <span className="flex-1 truncate font-mono text-[11.5px]" style={{ color: "var(--fg-dim)" }}>{trigSummary(t)}</span>
            {t.type !== "manual" && (
              <button onClick={() => remove(i)} title="Remove trigger" className="p-1 rounded hover:bg-rose-500/15 text-rose-300/70"><X size={12} /></button>
            )}
          </div>
        ))}
      </div>
      {webhook && (
        <div className="mb-2.5 text-[11px] font-mono rounded-lg border px-2.5 py-2 break-all" style={{ borderColor: `${VIOLET}33`, color: "var(--fg-dim)" }}>
          POST <span style={{ color: VIOLET }}>/api/agents/hook/{agent.id}</span><br />
          header <span style={{ color: VIOLET }}>x-agent-secret: {webhook.secret}</span>
        </div>
      )}
      {!adding ? (
        <div className="flex gap-1.5 flex-wrap">
          {(["gmail", "webwatch", "filewatch", "schedule", "webhook"] as const).map((ty) => (
            <button key={ty} onClick={() => { setAdding(ty); setF1(""); setF2(""); }}
              disabled={ty === "webhook" && !!webhook}
              className="px-2.5 h-7 rounded-md border text-[11px] disabled:opacity-30" style={{ borderColor: `${VIOLET}44`, color: VIOLET }}>
              + {ty}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {adding !== "webhook" && (
            <input value={f1} onChange={(e) => setF1(e.target.value)} autoFocus
              placeholder={adding === "gmail" ? "Gmail search query — e.g. is:unread from:client.com" : adding === "webwatch" ? "URL to watch" : adding === "filewatch" ? "Folder path to watch" : "Cron ('0 8 * * *') or a phrase: '8am daily', 'every 15 minutes', 'weekdays 9am'"}
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          )}
          {(adding === "gmail" || adding === "webwatch") && (
            <input value={f2} onChange={(e) => setF2(e.target.value)} placeholder={adding === "gmail" ? "Interval minutes (min 10 — each check is a model call)" : "Interval minutes (min 5)"}
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          )}
          {adding === "filewatch" && (
            <input value={f2} onChange={(e) => setF2(e.target.value)} placeholder="Glob (optional) — e.g. *.pdf"
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          )}
          <div className="flex gap-2">
            <button onClick={add} className="px-3 h-8 rounded-lg border text-[12px]" style={{ borderColor: `${VIOLET}55`, color: VIOLET }}>Add {adding}</button>
            <button onClick={() => setAdding(null)} className="px-3 h-8 rounded-lg text-[12px]" style={{ color: "var(--fg-dim)" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- live run transcript --------------------------------------------------

export function RunView({ agentId, runId }: { agentId: string; runId: string }) {
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [mcp, setMcp] = useState<McpServerHealth[]>([]);
  const seqRef = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    seqRef.current = -1;
    setEvents([]);
    let stop = false;
    async function poll() {
      try {
        const j = await fetch(`/api/agents/${agentId}/runs/${runId}?after=${seqRef.current}`).then((r) => r.json());
        if (stop) return;
        if (j.meta) setMeta(j.meta);
        if (Array.isArray(j.mcpHealth) && j.mcpHealth.length) setMcp(j.mcpHealth);
        if (Array.isArray(j.events) && j.events.length) {
          setEvents((prev) => [...prev, ...j.events]);
          seqRef.current = j.events[j.events.length - 1].seq;
        }
      } catch { /* next tick */ }
    }
    void poll();
    const t = setInterval(poll, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [agentId, runId]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [events]);

  const liveStatus = meta?.status === "running" || meta?.status === "waiting";

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${VIOLET}33` }}>
      <div className="flex items-center justify-between px-3.5 py-2 border-b" style={{ borderColor: `${VIOLET}22`, background: "rgba(167,139,250,0.05)" }}>
        <span className="text-[11px] font-mono flex items-center gap-2" style={{ color: VIOLET }}>
          {liveStatus && <Loader2 size={11} className="animate-spin" />}
          RUN · {meta?.status?.toUpperCase() ?? "…"}
          {typeof meta?.costUsd === "number" && <span style={{ color: "var(--fg-dimmer)" }}>· ${meta.costUsd.toFixed(3)}</span>}
        </span>
        <div className="flex items-center gap-2">
          {mcp.length > 0 && (
            <span className="text-[10px] font-mono" title={mcp.map((s) => `${s.name}: ${s.status}`).join("\n")} style={{ color: "var(--fg-dimmer)" }}>
              MCP {mcp.filter((s) => s.status === "connected").length}/{mcp.length}
            </span>
          )}
          {liveStatus && (
            <button onClick={() => fetch(`/api/agents/${agentId}/runs/${runId}`, { method: "DELETE" }).catch(() => {})}
              className="px-2.5 h-7 rounded-md border text-[11px] flex items-center gap-1 text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)" }}>
              <Square size={10} /> Kill
            </button>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="px-3.5 py-3 space-y-2 overflow-y-auto font-mono text-[11.5px] leading-relaxed" style={{ maxHeight: 380, background: "rgba(0,0,0,0.25)" }}>
        {events.length === 0 && <div className="flex items-center gap-2" style={{ color: "var(--fg-dimmer)" }}><RefreshCw size={11} className="animate-spin" /> waiting for events…</div>}
        {events.map((ev) => <EventLine key={ev.seq} ev={ev} />)}
        {meta?.result && meta.status === "done" && (
          <div className="mt-2 rounded-lg border p-3 whitespace-pre-wrap" style={{ borderColor: "rgba(52,211,153,0.35)", background: "rgba(52,211,153,0.06)", color: "var(--fg)" }}>
            {meta.result}
          </div>
        )}
      </div>
      {meta && (meta.status === "done" || meta.status === "error") && meta.trigger !== "curator" && meta.trigger !== "feedback" && (
        <FeedbackRow agentId={agentId} runId={runId} />
      )}
    </div>
  );
}

// Thumbs feed the curator: a rating (plus optional note) fires a feedback-weighted
// curation pass that can refine the agent's instructions.
function FeedbackRow({ agentId, runId }: { agentId: string; runId: string }) {
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  async function send(verdict: "up" | "down") {
    setSent(verdict);
    await fetch(`/api/agents/${agentId}/runs/${runId}/feedback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, comment }),
    }).catch(() => {});
  }

  if (sent) return (
    <div className="px-3.5 py-2 border-t text-[11px] font-mono" style={{ borderColor: `${VIOLET}22`, color: "var(--fg-dimmer)" }}>
      Feedback sent — the curator is folding it into the agent&apos;s memory.
    </div>
  );
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 border-t" style={{ borderColor: `${VIOLET}22` }}>
      <button onClick={() => send("up")} title="Good run — reinforce this" className="p-1.5 rounded-md hover:bg-emerald-500/15 text-emerald-300"><ThumbsUp size={13} /></button>
      <button onClick={() => send("down")} title="Bad run — the curator will adjust" className="p-1.5 rounded-md hover:bg-rose-500/15 text-rose-300"><ThumbsDown size={13} /></button>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should it do differently? (optional, sent with the thumb)"
        className="flex-1 bg-black/30 border rounded-lg px-3 h-8 text-[11.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
    </div>
  );
}

function EventLine({ ev }: { ev: RunEvent }) {
  if (ev.kind === "text") return <div style={{ color: "var(--fg)" }} className="whitespace-pre-wrap">{ev.text}</div>;
  if (ev.kind === "tool") return <div style={{ color: "#7dd3fc" }}>▸ {ev.toolName} <span style={{ color: "var(--fg-dimmer)" }}>{ev.detail}</span></div>;
  if (ev.kind === "tool-result") return <div style={{ color: ev.text === "error" ? "#f87171" : "var(--fg-dimmer)" }} className="pl-3 break-all">{ev.detail}</div>;
  if (ev.kind === "approval") return <div className="text-amber-300">⏸ {ev.toolName}: {ev.detail}</div>;
  if (ev.kind === "question") return (
    <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.08)" }}>
      <div className="text-amber-300">⏸ asking you — {ev.detail}</div>
      <div className="mt-1 whitespace-pre-wrap" style={{ color: "var(--fg)" }}>{ev.text}</div>
      <div className="mt-1 text-[10.5px]" style={{ color: "var(--fg-dimmer)" }}>Answer it in the &quot;Waiting on you&quot; strip.</div>
    </div>
  );
  if (ev.kind === "status") return <div style={{ color: "var(--fg-dimmer)" }}>· {ev.detail}</div>;
  if (ev.kind === "init") return <div style={{ color: "var(--fg-dimmer)" }}>⚙ {ev.detail}</div>;
  if (ev.kind === "error") return <div className="text-rose-300">✖ {ev.text}</div>;
  if (ev.kind === "stderr") return <div style={{ color: "#f59e0b99" }} className="break-all">{ev.text}</div>;
  if (ev.kind === "result") return null; // rendered as the green result box
  return null;
}
