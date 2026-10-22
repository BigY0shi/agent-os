"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lightbulb, Loader2, Plus, Send, FileText, AlertTriangle, Check } from "lucide-react";
import AgentAvatar, { agentColor, type AgentKey } from "./AgentAvatar";
import ModelSettings from "./ModelSettings";

// Brainstorm Council — Claude + ChatGPT (codex) + Kimi (Ollama Cloud) ideate on a
// topic in structured rounds (diverge → converge → chair synthesis), then take
// steer messages against the same session. Server: /api/brainstorm (NDJSON).

interface Msg { agent: string; phase: string; text: string; ts: number }
interface SessionMeta { id: string; topic: string; updatedAt: number; brief: string | null }

const SEAT_LABEL: Record<string, string> = { claude: "Claude", codex: "ChatGPT", kimi: "Kimi" };
const PHASE_LABEL: Record<string, string> = {
  diverge: "Diverge — independent concepts",
  critique: "Converge — cross-examination",
  steer: "Steer — the council responds",
  synthesis: "Chair synthesis",
};

function seatKey(agent: string): AgentKey {
  return (agent === "chair" ? "claude" : agent) as AgentKey;
}

export default function BrainstormView() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [brief, setBrief] = useState<string | null>(null);
  const [kimiModel, setKimiModel] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [accepted, setAccepted] = useState<{ at: number; notePath: string } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const j = await (await fetch("/api/brainstorm", { cache: "no-store" })).json();
      if (j.ok) setSessions(j.sessions);
    } catch { /* list is cosmetic */ }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, phase, brief]);

  async function openSession(id: string) {
    try {
      const j = await (await fetch(`/api/brainstorm?id=${encodeURIComponent(id)}`, { cache: "no-store" })).json();
      if (j.ok) {
        setSessionId(id); setMsgs(j.session.msgs); setBrief(j.session.brief);
        setKimiModel(j.session.kimiModel || null); setErrors([]); setPhase(null);
        setAccepted(j.session.accepted || null); setAcceptErr(null);
      }
    } catch { /* stays where it was */ }
  }

  function newSession() {
    setSessionId(null); setMsgs([]); setBrief(null); setErrors([]); setPhase(null); setKimiModel(null);
    setAccepted(null); setAcceptErr(null);
  }

  async function acceptBrief() {
    if (!sessionId || accepting) return;
    setAccepting(true); setAcceptErr(null);
    try {
      const j = await (await fetch("/api/brainstorm/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
      })).json();
      if (j.ok) setAccepted(j.accepted);
      else setAcceptErr(j.error || "Accept failed");
    } catch (e) { setAcceptErr((e as Error).message); }
    setAccepting(false);
  }

  async function submit() {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    setRunning(true);
    setErrors([]);
    setMsgs((m) => [...m, { agent: "user", phase: "user", text, ts: Date.now() }]);
    try {
      const r = await fetch("/api/brainstorm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, id: sessionId ?? undefined }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        setErrors([j.error || `Council failed to convene (${r.status})`]);
        setRunning(false);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "phase") setPhase(ev.name as string);
          else if (ev.t === "seat") setKimiModel(ev.model as string);
          else if (ev.t === "msg") setMsgs((m) => [...m, { agent: ev.agent as string, phase: ev.phase as string, text: ev.text as string, ts: Date.now() }]);
          else if (ev.t === "brief") { setBrief(ev.text as string); setPhase(null); }
          else if (ev.t === "err") setErrors((e) => [...e, `${SEAT_LABEL[ev.agent as string] ?? ev.agent}: ${ev.message}`]);
          else if (ev.t === "fatal") setErrors((e) => [...e, ev.message as string]);
          else if (ev.t === "done") { setSessionId(ev.id as string); loadSessions(); }
        }
      }
    } catch (e) {
      setErrors((er) => [...er, (e as Error).message]);
    }
    setPhase(null);
    setRunning(false);
  }

  // Group consecutive messages by phase for section headers.
  const grouped: { phase: string; items: Msg[] }[] = [];
  for (const m of msgs) {
    const last = grouped[grouped.length - 1];
    if (last && last.phase === m.phase) last.items.push(m);
    else grouped.push({ phase: m.phase, items: [m] });
  }

  return (
    <div className="max-w-[1200px] mx-auto flex gap-4">
      {/* Session rail */}
      <div className="hidden lg:flex flex-col w-[220px] shrink-0 gap-2">
        <button onClick={newSession}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium panel hover:brightness-110">
          <Plus size={13} /> New session
        </button>
        {sessions.map((s) => (
          <button key={s.id} onClick={() => openSession(s.id)}
            className="panel p-2.5 text-left transition hover:brightness-110"
            style={{ outline: s.id === sessionId ? "1px solid #fbbf24" : "none" }}>
            <div className="text-[12px] text-white/80 line-clamp-2 leading-snug">{s.topic}</div>
            <div className="text-[10px] text-white/35 mt-1">
              {new Date(s.updatedAt).toLocaleDateString()} {s.brief ? "· brief ready" : ""}
            </div>
          </button>
        ))}
      </div>

      {/* Main column */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24" }}>
            <Lightbulb size={18} />
          </div>
          <h1 className="text-xl font-semibold">Brainstorm</h1>
          <div className="flex items-center gap-1.5 ml-1">
            {(["claude", "codex", "kimi"] as AgentKey[]).map((a) => (
              <span key={a} title={a === "kimi" ? (kimiModel || "Kimi (Ollama Cloud)") : SEAT_LABEL[a]}>
                <AgentAvatar agent={a} size={20} />
              </span>
            ))}
          </div>
          <span className="text-[11px] text-white/40">
            three-seat council{kimiModel ? ` · kimi seat: ${kimiModel}` : ""}
          </span>
          <div className="ml-auto">
            <ModelSettings section="brainstorm" title="Brainstorm models" accent="#fbbf24"
              fields={[{ key: "kimiModel", label: "Kimi seat (Ollama Cloud)", placeholder: "kimi-k2.6",
                hint: "Chat/agentic seat — policy default kimi-k2.6. Must exist on your Ollama Cloud plan." },
                // S30: the per-seat time limits (were 240 s / 180 s literals). A launch-drawer timeout wins per run.
                { key: "seatTimeoutSec", label: "CLI seat time limit (seconds)", placeholder: "240", type: "number",
                  hint: "How long Claude or Codex may take per council turn. Default 240." },
                { key: "kimiTimeoutSec", label: "Kimi seat time limit (seconds)", placeholder: "180", type: "number",
                  hint: "How long the Ollama Cloud call may take per council turn. Default 180." }]} />
          </div>
        </div>
        <p className="text-sm text-white/45 mb-4">
          Give the council a topic, idea, or goal. They diverge, cross-examine, and the chair writes a working project brief. Keep talking to steer it.
        </p>

        {errors.length > 0 && (
          <div className="panel p-2.5 mb-3 text-[12px] space-y-1" style={{ color: "#fbbf24" }}>
            {errors.map((e, i) => <div key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{e}</div>)}
          </div>
        )}

        {!msgs.length && !running && (
          <div className="panel p-8 text-center text-white/50 text-[13px]">
            No session yet. Drop an idea below — e.g. <span className="text-white/75">&ldquo;a tool that turns my homelab into a product&rdquo;</span> — and the council convenes.
          </div>
        )}

        <div className="space-y-4">
          {grouped.map((g, gi) => (
            <div key={gi}>
              {g.phase !== "user" && PHASE_LABEL[g.phase] && (
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-white/35 mb-2">{PHASE_LABEL[g.phase]}</div>
              )}
              <div className="space-y-2">
                {g.items.map((m, i) => m.agent === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="rounded-xl px-3 py-2 max-w-[80%] text-[13px] leading-relaxed"
                      style={{ background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.25)" }}>
                      {m.text}
                    </div>
                  </div>
                ) : m.phase === "brief" ? null : (
                  <div key={i} className="panel p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AgentAvatar agent={seatKey(m.agent)} size={18} />
                      <span className="text-[11.5px] font-semibold" style={{ color: agentColor(seatKey(m.agent)) }}>
                        {SEAT_LABEL[m.agent] ?? m.agent}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-white/75 whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {phase && (
            <div className="flex items-center gap-2 text-[12px] text-white/50">
              <Loader2 size={13} className="animate-spin" />
              {PHASE_LABEL[phase] ?? phase}…
            </div>
          )}

          {brief && (
            <div className="rounded-lg p-4" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)" }}>
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} style={{ color: "#34d399" }} />
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#34d399" }}>Working project brief</span>
                <div className="ml-auto">
                  {accepted ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono" style={{ color: "#34d399" }} title={accepted.notePath}>
                      <Check size={12} /> Accepted · {accepted.notePath.split(/[\\/]/).pop()}
                    </span>
                  ) : (
                    <button onClick={acceptBrief} disabled={accepting || running}
                      title="Write this brief to the Obsidian vault (Agentic OS/Project Briefs) and mark the session accepted"
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium disabled:opacity-40"
                      style={{ background: "rgba(52,211,153,0.16)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}>
                      {accepting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      {accepting ? "Saving…" : "Accept brief"}
                    </button>
                  )}
                </div>
              </div>
              {acceptErr && <div className="text-[11.5px] text-rose-300 mb-2">{acceptErr}</div>}
              <div className="text-[13px] text-white/85 whitespace-pre-wrap leading-relaxed">{brief}</div>
              {accepted && (
                <div className="text-[11px] mt-2 text-white/40">
                  Steering further updates the working brief — Accept again to save a fresh note.
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="sticky bottom-0 pt-4 pb-2" style={{ background: "linear-gradient(transparent, var(--bg, #14101c) 30%)" }}>
          <div className="flex gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={2}
              placeholder={sessionId ? "Steer the council — push back, add constraints, pick a direction…" : "Topic, idea, or goal for the council…"}
              className="flex-1 panel bg-transparent px-3 py-2 text-[13px] leading-relaxed resize-none" />
            <button onClick={submit} disabled={running || !input.trim()}
              className="self-end inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12.5px] font-medium disabled:opacity-40"
              style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24" }}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {running ? "In session…" : sessionId ? "Steer" : "Convene"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
