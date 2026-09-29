"use client";

// S25 AI Agent Mastermind as the crew chat (_design/jarvis-v3-plan.md; NEXORA "Chat": a
// line to every specialist). A restyle around the existing module, not a new one: the
// left rail lists every specialist with ONE real status word (GET /api/room/status) and
// header counts; "The whole room" is the existing group chat, unchanged; choosing a
// specialist opens a persistent one-on-one thread with it. One-on-one threads use the
// same room endpoint (targeted at that one agent) and the same vault-backed store
// (conversation id dm-<agent>), so they survive reloads and show on any device.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Users } from "lucide-react";
import GroupChatView from "./GroupChatView";

type Status = "working now" | "active today" | "ready" | "unreachable";
interface Specialist { id: string; name: string; color: string; provider: string; status: Status; why: string }
interface Msg { key: number; who: string; name?: string; color?: string; text: string; kind?: string }
interface Convo { id: string; title: string; ts: number; msgs: Msg[] }
const TINT: Record<Status, string> = { "working now": "#3b95ff", "active today": "#34d399", ready: "#f2b441", unreachable: "#f87171" };

export default function MastermindView() {
  const [list, setList] = useState<Specialist[] | null>(null);
  const [counts, setCounts] = useState<{ specialists: number; workingNow: number; unreachable: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null); // null = the whole room
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/room/status", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setList(j.specialists); setCounts(j.counts); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);
  const current = list?.find((s) => s.id === sel) ?? null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]" data-mastermind>
      <aside className="glass h-fit px-3 py-3 lg:sticky lg:top-4" aria-label="Specialists">
        <div className="px-2">
          <div className="glass-eyebrow">Specialists</div>
          <div className="mt-1 text-[12px] text-[var(--fg-dim)]">{counts ? `${counts.specialists} specialists, ${counts.workingNow} working now` : "…"}</div>
        </div>
        <button type="button" aria-pressed={sel === null} onClick={() => setSel(null)} className={`mt-3 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] ${sel === null ? "glass neon-ring" : "hover:bg-white/5"}`}>
          <Users size={13} /> The whole room
        </button>
        <ul className="mt-1 space-y-0.5">
          {(list ?? []).map((s) => (
            <li key={s.id}>
              <button type="button" aria-pressed={sel === s.id} onClick={() => setSel(s.id)} title={s.why} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${sel === s.id ? "glass neon-ring" : "hover:bg-white/5"}`}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold" style={{ background: `${s.color}33`, color: s.color }}>{s.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]">{s.name}</span>
                  <span className="flex items-center gap-1 text-[10.5px]" style={{ color: TINT[s.status] }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT[s.status] }} />{s.status}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {err && <p role="alert" className="mt-2 px-2 text-[11px] text-red-300">{err}</p>}
      </aside>
      <div className="min-w-0">{current ? <SpecialistChat key={current.id} s={current} onTurn={load} /> : <GroupChatView />}</div>
    </div>
  );
}

function SpecialistChat({ s, onTurn }: { s: Specialist; onTurn: () => void }) {
  const id = `dm-${s.id}`;
  const [convo, setConvo] = useState<Convo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/api/room/history", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const found = (j.conversations as Convo[] | undefined)?.find((c) => c.id === id);
      setConvo(found ?? { id, title: `One-on-one with ${s.name}`, ts: Date.now(), msgs: [] });
    }).catch((e) => setErr(String(e)));
  }, [id, s.name]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [convo]);

  const save = (c: Convo) => fetch("/api/room/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }).catch(() => {});
  const send = async () => {
    if (!convo || !text.trim()) return;
    const mine: Msg = { key: Date.now(), who: "you", text: text.trim() };
    const history = convo.msgs.filter((m) => m.who !== "system").map((m) => ({ speaker: m.who === "you" ? "You" : m.name ?? s.name, text: m.text }));
    let next: Convo = { ...convo, ts: Date.now(), msgs: [...convo.msgs, mine] };
    setConvo(next); setText(""); setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/room", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: mine.text, history, agents: [s.id] }) });
      if (!r.ok || !r.body) throw new Error(`the room answered ${r.status}`);
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { t: string; id?: string; name?: string; color?: string; text?: string; label?: string };
          if (ev.t === "msg" && ev.id === s.id) { next = { ...next, msgs: [...next.msgs, { key: Date.now(), who: s.id, name: ev.name, color: ev.color, text: ev.text ?? "" }] }; setConvo(next); }
          if (ev.t === "action" && ev.label) { next = { ...next, msgs: [...next.msgs, { key: Date.now() + 1, who: "system", text: ev.label, kind: "action" }] }; setConvo(next); }
        }
      }
      void save(next);
    } catch (e) { setErr((e as Error).message); void save(next); }
    finally { setBusy(false); onTurn(); }
  };

  return (
    <section className="glass-strong flex h-[calc(100vh-170px)] min-h-[480px] flex-col" aria-label={`One-on-one with ${s.name}`} data-specialist={s.id}>
      <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full text-[14px] font-semibold" style={{ background: `${s.color}33`, color: s.color }}>{s.name.slice(0, 1)}</span>
        <div className="min-w-0">
          <div className="text-[14px]">{s.name}</div>
          <div className="text-[11px]" style={{ color: TINT[s.status] }}>{s.status} <span className="text-[var(--fg-dimmer)]">· {s.why}</span></div>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {!convo && <p className="text-[12px] text-[var(--fg-dimmer)]">Loading the thread…</p>}
        {convo && convo.msgs.length === 0 && <p className="text-[12px] text-[var(--fg-dimmer)]">A private line to {s.name}. It keeps its own thread, separate from the room.</p>}
        {convo?.msgs.map((m) => (
          <div key={m.key} className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${m.who === "you" ? "glass neon-ring" : m.who === "system" ? "text-[11.5px] text-[var(--fg-dim)] glass-inset" : "glass-inset"}`}>{m.text}</div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: s.color }}><Loader2 size={12} className="animate-spin" /> {s.name} is replying…</div>}
        <div ref={endRef} />
      </div>
      {err && <p role="alert" className="px-5 text-[11.5px] text-red-300">{err}</p>}
      <form className="flex gap-2 border-t border-white/5 px-4 py-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={s.status === "unreachable" ? `${s.name} is unreachable: ${s.why}` : `Message ${s.name}`} aria-label={`Message ${s.name}`} className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none glass-inset" />
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] glass neon-ring disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
      </form>
    </section>
  );
}
