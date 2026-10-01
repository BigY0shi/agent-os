"use client";

// S22 Voice mode (_design/jarvis-v3-plan.md; owner: a per-agent roster with NEXORA's
// selection dial, "I don't care about the camera->hand control"). Pick who you are
// talking to on an elliptical dial (click a card, the arrows, the arrow keys, or say
// "talk to <name>"), their face fills the stage, and you talk push-to-talk: hold Space or
// the mic button. Speech goes through Parakeet (useVoiceCapture, provider "parakeet");
// the reply comes from that agent's own lane and is spoken through Kokoro
// (/api/hermes/tts, provider "local"). Nothing is simulated: the face shows listening
// only while the mic records, thinking only while a reply is awaited, speaking only
// while audio plays, driven by the audio's real level.
//
// Lanes: Jarvis  POST /api/v2/jarvis/ask (SSE sentences)
//        Oracle  POST /api/oracle (one answer)
//        room    POST /api/room, agents: [id] (a Mastermind specialist)
//        crew    POST /api/v2/crew/<id>/chat (a real run of that agent; polled to its end)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";
import { AgentFace, type FaceState, type FaceVariant } from "@/components/faces/AgentFace";
import AgentAvatar from "@/components/AgentAvatar";
import { useVoiceCapture } from "@/lib/v2/jarvis/useVoiceCapture";

type Lane = "jarvis" | "oracle" | "room" | "crew";
interface Member { key: string; id: string; name: string; lane: Lane; color: string; face: FaceVariant; status?: string; voiceId?: string; voiceLabel: string }
interface Turn { who: "you" | "agent" | "system"; name: string; text: string; at: number }

const LANE_WORD: Record<Lane, string> = { jarvis: "orchestrator", oracle: "advisor", room: "specialist", crew: "crew agent" };
const PROMPTS: Record<Lane, string[]> = {
  jarvis: ["What needs me today?", "Open the Deal Desk", "Summarize what the crew did this week"],
  oracle: ["What am I not seeing about my pricing?", "Which bet should I make this quarter?"],
  room: ["What is your take on my newest idea?", "What would you change first, and why?"],
  crew: ["What did you find today?", "Run your usual check now and tell me what you see"],
};
const BASE: Member[] = [
  // bm_george is the Kokoro voice already used for Jarvis in this codebase (hermes/tts route).
  { key: "jarvis", id: "jarvis", name: "Jarvis", lane: "jarvis", color: "#8b5cf6", face: "constellation", voiceId: "bm_george", voiceLabel: "Kokoro, bm_george" },
  { key: "oracle", id: "oracle", name: "Oracle", lane: "oracle", color: "#e9ecf4", face: "galaxy", voiceLabel: "Kokoro, default voice" },
];

async function readSse(res: Response, onEvent: (ev: Record<string, unknown>) => void) {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of frame.split("\n")) if (line.startsWith("data: ")) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* partial */ } }
    }
  }
}

export default function VoiceTab() {
  const [members, setMembers] = useState<Member[]>(BASE);
  const [sel, setSel] = useState(0);
  const [turns, setTurns] = useState<Record<string, Turn[]>>({});
  const [face, setFace] = useState<FaceState>("idle");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mute, setMute] = useState(false);
  const [busy, setBusy] = useState(false);
  const jarvisConv = useRef<string | undefined>(undefined);
  const levelRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Roster: Jarvis, the Oracle, every Mastermind specialist, every crew agent.
  useEffect(() => {
    (async () => {
      const out: Member[] = [...BASE];
      try {
        const r = await (await fetch("/api/room/status", { cache: "no-store" })).json();
        for (const s of r.specialists ?? []) out.push({ key: `room:${s.id}`, id: s.id, name: s.name, lane: "room", color: s.color, face: "constellation", status: s.status, voiceLabel: "Kokoro, default voice" });
      } catch { /* the room is optional */ }
      try {
        const c = await (await fetch("/api/v2/crew", { cache: "no-store" })).json();
        for (const a of c.agents ?? []) out.push({ key: `crew:${a.id}`, id: a.id, name: a.name, lane: "crew", color: "#3b95ff", face: "constellation", status: a.status, voiceLabel: "Kokoro, default voice" });
      } catch { /* no crew yet */ }
      setMembers(out);
    })();
  }, []);

  const m = members[Math.min(sel, members.length - 1)];
  const history = turns[m.key] ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [history.length]);
  const push = useCallback((key: string, t: Turn) => setTurns((x) => ({ ...x, [key]: [...(x[key] ?? []), t] })), []);
  const rotate = useCallback((d: number) => setSel((s) => (s + d + members.length) % members.length), [members.length]);

  // Speak a reply through Kokoro, feeding the face its real audio level.
  const speak = useCallback(async (reply: string, who: Member) => {
    if (mute || !reply.trim()) { setFace("idle"); return; }
    setFace("working");
    const r = await fetch("/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: reply.slice(0, 1200), provider: "local", ...(who.voiceId ? { voiceId: who.voiceId } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.audio) { setFace("error"); setErr(`Could not speak the reply: ${j.error ?? r.status}`); return; }
    const audio = new Audio(j.audio as string);
    audioRef.current = audio;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ctx = new Ctx(); const src = ctx.createMediaElementSource(audio); const an = ctx.createAnalyser(); an.fftSize = 128;
      src.connect(an); an.connect(ctx.destination);
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => { if (audio.paused || audio.ended) { levelRef.current = 0; return; } an.getByteFrequencyData(data); levelRef.current = data.reduce((a, b) => a + b, 0) / data.length / 255; requestAnimationFrame(tick); };
      audio.onplay = () => { setFace("speaking"); tick(); };
      audio.onended = () => { levelRef.current = 0; setFace("idle"); void ctx.close(); };
    } catch { audio.onplay = () => setFace("speaking"); audio.onended = () => setFace("idle"); }
    await audio.play().catch((e) => { setFace("error"); setErr(`Playback blocked: ${String(e)}`); });
  }, [mute]);

  const ask = useCallback(async (said: string, who: Member) => {
    push(who.key, { who: "you", name: "You", text: said, at: Date.now() });
    setBusy(true); setErr(null); setFace("thinking");
    try {
      let reply = "";
      if (who.lane === "jarvis") {
        const r = await fetch("/api/v2/jarvis/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: said, conversationId: jarvisConv.current }) });
        if (!r.ok || !r.body) throw new Error(`Jarvis answered ${r.status}`);
        const parts: string[] = [];
        await readSse(r, (ev) => {
          if (ev.type === "meta" && typeof ev.conversationId === "string") jarvisConv.current = ev.conversationId;
          if (ev.type === "sentence" && typeof ev.text === "string") parts.push(ev.text);
          if (ev.type === "error") throw new Error(String(ev.message));
        });
        reply = parts.join(" ");
      } else if (who.lane === "oracle") {
        const j = await (await fetch("/api/oracle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: said }) })).json();
        if (!j.ok) throw new Error(j.error ?? "the Oracle did not answer");
        reply = j.answer;
      } else if (who.lane === "room") {
        const prior = (turns[who.key] ?? []).map((t) => ({ speaker: t.who === "you" ? "You" : who.name, text: t.text }));
        const r = await fetch("/api/room", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: said, history: prior, agents: [who.id] }) });
        if (!r.ok || !r.body) throw new Error(`the room answered ${r.status}`);
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let nl;
          while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue; const ev = JSON.parse(line); if (ev.t === "msg" && ev.id === who.id) reply = ev.text; }
        }
      } else {
        const r = await fetch(`/api/v2/crew/${encodeURIComponent(who.id)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: said }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
        const deadline = Date.now() + 10 * 60_000;
        for (;;) {
          const g = await (await fetch(`/api/v2/crew/${encodeURIComponent(who.id)}/chat`, { cache: "no-store" })).json();
          const last = [...(g.turns ?? [])].reverse().find((t: { role: string }) => t.role === "agent");
          if (last && !last.pending) { reply = last.text; break; }
          if (Date.now() > deadline) throw new Error("no reply within 10 minutes; it may still finish in the Crew tab");
          await new Promise((res) => setTimeout(res, 3000));
        }
      }
      if (!reply.trim()) throw new Error("the reply came back empty");
      push(who.key, { who: "agent", name: who.name, text: reply, at: Date.now() });
      await speak(reply, who);
    } catch (e) {
      setFace("error"); setErr((e as Error).message);
      push(who.key, { who: "system", name: "", text: `No reply: ${(e as Error).message}`, at: Date.now() });
    } finally { setBusy(false); }
  }, [push, speak, turns]);

  // "talk to Hermes" switches who you are talking to instead of sending.
  const handleUtterance = useCallback((said: string) => {
    const t = said.trim();
    if (!t) return;
    const sw = /^(?:talk|switch|speak|go)\s+(?:to|over to)\s+(?:the\s+)?(.+?)[.!?]*$/i.exec(t);
    if (sw) {
      const want = sw[1].toLowerCase();
      const i = members.findIndex((x) => x.name.toLowerCase() === want) >= 0 ? members.findIndex((x) => x.name.toLowerCase() === want) : members.findIndex((x) => x.name.toLowerCase().includes(want));
      if (i >= 0) { setSel(i); setNotice(`Now talking to ${members[i].name}.`); return; }
      setNotice(`No one called "${sw[1]}" on the dial.`); return;
    }
    void ask(t, m);
  }, [members, m, ask]);

  const capture = useVoiceCapture({ provider: "parakeet", onFinalChunk: handleUtterance });
  const recording = capture.status === "recording";
  useEffect(() => { if (recording) setFace("listening"); else if (face === "listening") setFace("idle"); }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold Space to talk (not while typing); arrows turn the dial.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === "Space" && !e.repeat && !busy) { e.preventDefault(); audioRef.current?.pause(); capture.start(); }
      if (e.key === "ArrowLeft") rotate(-1);
      if (e.key === "ArrowRight") rotate(1);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e)) { e.preventDefault(); capture.stop(); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [capture, rotate, busy]);

  const n = members.length;
  const cards = useMemo(() => members.map((x, i) => {
    const th = ((i - sel) / n) * Math.PI * 2;
    const z = Math.cos(th);
    return { x, i, left: 50 + Math.sin(th) * 42, top: 50 - z * 14, scale: 0.62 + 0.38 * ((z + 1) / 2), opacity: 0.35 + 0.65 * ((z + 1) / 2), zIndex: Math.round((z + 1) * 50) };
  }), [members, sel, n]);

  return (
    <div className="space-y-4" data-voice-tab>
      <section className="glass-strong relative overflow-hidden px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="glass-eyebrow">Voice mode</div>
            <h2 className="type-display mt-1 text-[26px] leading-tight">Talking to {m.name}</h2>
            <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Hold Space (or the mic) to talk. Say "talk to Hermes" to switch. Arrow keys turn the dial.</p>
          </div>
          <button type="button" onClick={() => setMute((v) => !v)} aria-pressed={mute} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass">{mute ? <VolumeX size={13} /> : <Volume2 size={13} />}{mute ? "Replies muted" : "Replies spoken"}</button>
        </div>

        <div className="relative mt-4 h-[150px]" role="listbox" aria-label="Who to talk to" aria-activedescendant={`voice-${m.key}`}>
          {cards.map(({ x, i, left, top, scale, opacity, zIndex }) => (
            <button key={x.key} id={`voice-${x.key}`} type="button" role="option" aria-selected={i === sel} onClick={() => setSel(i)}
              className={`absolute w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-2xl px-3 py-2 text-left transition-all duration-500 ${i === sel ? "glass neon-ring" : "glass-inset"}`}
              style={{ left: `${left}%`, top: `${top}%`, transform: `translate(-50%, -50%) scale(${scale})`, opacity, zIndex }}>
              <div className="flex items-center gap-2">{x.lane === "crew" || x.lane === "room" ? <AgentAvatar agent={x.id} name={x.name} size={20} /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />}<span className="truncate text-[13px]">{x.name}</span></div>
              <div className="mt-0.5 truncate text-[10.5px] text-[var(--fg-dimmer)]">{LANE_WORD[x.lane]}{x.status ? ` · ${x.status}` : ""}</div>
            </button>
          ))}
          <button type="button" aria-label="Previous" onClick={() => rotate(-1)} className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full p-2 glass"><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next" onClick={() => rotate(1)} className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full p-2 glass"><ChevronRight size={16} /></button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]">
        <section className="glass relative flex flex-col items-center px-6 py-6" aria-label={`${m.name}'s face`}>
          <AgentFace variant={m.face} state={face} getLevel={() => levelRef.current} label={`${m.name}, ${face}`} style={{ width: "min(420px, 100%)", aspectRatio: "1 / 1" }} />
          <div className="mt-2 text-[11.5px] text-[var(--fg-dimmer)]">{face === "listening" ? "Listening…" : face === "thinking" ? `${m.name} is thinking…` : face === "speaking" ? `${m.name} is speaking` : face === "working" ? "Getting the voice ready…" : face === "error" ? "Something went wrong (below)" : `Voice: ${m.voiceLabel}`}</div>
          <button type="button" disabled={busy || capture.available !== true}
            onPointerDown={() => { audioRef.current?.pause(); capture.start(); }} onPointerUp={() => capture.stop()} onPointerLeave={() => { if (recording) capture.stop(); }}
            className={`mt-4 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] glass ${recording ? "neon-ring" : ""} disabled:opacity-40`} aria-pressed={recording}>
            {recording ? <Square size={14} /> : <Mic size={14} />} {recording ? "Release to send" : "Hold to talk"}
          </button>
          {capture.available !== true && <p className="mt-2 max-w-md text-center text-[11.5px] text-amber-300">Microphone unavailable: {capture.available}. Typed messages still work.</p>}
          {capture.error && <p role="alert" className="mt-2 text-[11.5px] text-red-300">{capture.error}</p>}
        </section>

        <section className="glass-strong flex h-[560px] flex-col" aria-label={`Conversation with ${m.name}`}>
          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {history.length === 0 && (
              <div>
                <p className="text-[12px] text-[var(--fg-dimmer)]">Try one of these, or just talk.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{PROMPTS[m.lane].map((p) => <button key={p} type="button" disabled={busy} onClick={() => void ask(p, m)} className="rounded-xl px-3 py-1.5 text-left text-[12px] glass-inset hover:bg-white/5">{p}</button>)}</div>
              </div>
            )}
            {history.map((t, i) => (
              <div key={i} className={`flex ${t.who === "you" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${t.who === "you" ? "glass neon-ring" : t.who === "system" ? "text-red-300 glass-inset" : "glass-inset"}`}>{t.text}</div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-dim)]"><Loader2 size={12} className="animate-spin" /> {m.name} is {m.lane === "crew" ? "running" : "thinking"}…</div>}
            <div ref={endRef} />
          </div>
          {notice && <p className="px-5 text-[11.5px] text-[var(--fg-dim)]">{notice}</p>}
          {err && <p role="alert" className="px-5 text-[11.5px] text-red-300">{err}</p>}
          <form className="flex gap-2 border-t border-white/5 px-4 py-3" onSubmit={(e) => { e.preventDefault(); const t = text; setText(""); handleUtterance(t); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Type to ${m.name}, or "talk to …"`} aria-label={`Message ${m.name}`} className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none glass-inset" />
            <button type="submit" disabled={busy || !text.trim()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] glass neon-ring disabled:opacity-40"><Send size={13} /> Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}
