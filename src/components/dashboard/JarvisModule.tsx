"use client";

// The homepage Jarvis module — the merged voice assistant, front and center.
//
// CR.1 (SPEC-C): talks to the V2 brain lane (POST /api/v2/jarvis/ask —
// persona-loaded, tool-wielding, conversation-persisted; the old
// /api/jarvis/brain is deprecated). SSE superset parsed: sentence/done/error
// unchanged, meta threads the conversationId, tool events render as activity
// lines, navigate performs the client-side jump. Keeps the standalone rig's
// best habits: sentence-streamed replies spoken as they arrive, and — per the
// operator's explicit ask — SPEECH IS REVIEWED BEFORE IT SENDS: the mic drops
// its transcript into the editable input; only the Send button (or Enter)
// actually submits.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Send, Settings2, RotateCcw, Volume2, VolumeX, Maximize2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Msg = { role: "you" | "jarvis"; text: string; tool?: boolean };
type Persona = { name: string; userAddress: string; voiceRules: string; spokenStyle: string; bannedPhrases: string[] };

type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
};
function getSR(): { new (): SR } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: { new (): SR }; webkitSpeechRecognition?: { new (): SR } };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const PHASE_HUE: Record<Phase, string> = {
  idle: "rgba(111,255,155,0.55)",
  listening: "rgba(80,200,255,0.75)",
  thinking: "rgba(255,190,80,0.8)",
  speaking: "rgba(111,255,155,0.95)",
};

export function JarvisModule() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const [status, setStatus] = useState<{ busy: boolean; engine: string | null; conversationId: string | null }>({ busy: false, engine: null, conversationId: null });
  const [gearOpen, setGearOpen] = useState(false);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [saving, setSaving] = useState(false);

  const recRef = useRef<SR | null>(null);
  // V2 conversation thread — handed back by the meta event, threaded on sends.
  const conversationIdRef = useRef<string | null>(null);
  const listeningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakQ = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const voiceOnRef = useRef(true);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);
  useEffect(() => {
    fetch("/api/v2/jarvis/ask").then((r) => r.json()).then((j) => setStatus({ busy: !!j?.busy, engine: j?.engine ?? null, conversationId: j?.conversationId ?? null })).catch(() => {});
    fetch("/api/jarvis/persona").then((r) => r.json()).then((j) => setPersona(j.persona)).catch(() => {});
  }, []);
  useEffect(() => { logBoxRef.current?.scrollTo({ top: 1e9 }); }, [log]);

  // ---- voice out: sentence queue → one audio element, in order ----
  async function pump() {
    if (speakingRef.current) return;
    const next = speakQ.current.shift();
    if (!next) { if (phase === "speaking") setPhase("idle"); return; }
    speakingRef.current = true;
    setPhase("speaking");
    try {
      const r = await fetch("/api/hermes/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: next.slice(0, 600), provider: "auto" }),
      });
      const j = await r.json();
      if (j.audio && audioRef.current) {
        const a = audioRef.current;
        a.src = j.audio;
        await new Promise<void>((done) => {
          a.onended = () => done(); a.onerror = () => done();
          a.play().catch(() => done());
        });
      }
    } catch { /* sentence dropped, keep the queue moving */ }
    speakingRef.current = false;
    void pump();
  }
  function enqueueSpeech(s: string) {
    if (!voiceOnRef.current) return;
    speakQ.current.push(s);
    void pump();
  }

  // ---- mic in: transcript lands in the input FOR REVIEW, never auto-sends ----
  function toggleMic() {
    if (listeningRef.current) { recRef.current?.stop(); return; }
    const Ctor = getSR();
    if (!Ctor) { setLog((l) => [...l, { role: "jarvis", text: "This browser has no speech recognition — type instead." }]); return; }
    const rec = new Ctor();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setInput((finalText + " " + interim).replace(/\s+/g, " ").trim());
    };
    rec.onerror = () => { listeningRef.current = false; setPhase("idle"); };
    rec.onend = () => { listeningRef.current = false; setPhase("idle"); };
    recRef.current = rec;
    listeningRef.current = true;
    setPhase("listening");
    rec.start();
  }

  // ---- the ask: POST → SSE sentences → transcript + speech queue ----
  async function sendUtterance() {
    const utterance = input.trim();
    if (!utterance || phase === "thinking") return;
    recRef.current?.stop();
    setInput("");
    setLog((l) => [...l, { role: "you", text: utterance }]);
    setPhase("thinking");
    try {
      const r = await fetch("/api/v2/jarvis/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: utterance, conversationId: conversationIdRef.current ?? undefined }),
      });
      if (!r.ok || !r.body) throw new Error(`brain ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let carry = "";
      let reply = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const frames = carry.split("\n\n");
        carry = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((ln) => ln.startsWith("data: "));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type: string; text?: string; error?: string; message?: string;
              conversationId?: string; name?: string; state?: string; summary?: string; route?: string;
            };
            if (ev.type === "meta" && ev.conversationId) {
              conversationIdRef.current = ev.conversationId;
            } else if (ev.type === "sentence" && ev.text) {
              reply += (reply ? " " : "") + ev.text;
              setLog((l) => {
                const last = l[l.length - 1];
                if (last?.role === "jarvis" && !last.tool && l.length && reply.startsWith(last.text)) {
                  return [...l.slice(0, -1), { role: "jarvis", text: reply }];
                }
                return [...l, { role: "jarvis", text: reply }];
              });
              enqueueSpeech(ev.text);
            } else if (ev.type === "tool" && ev.name && ev.state !== "start") {
              setLog((l) => [...l, { role: "jarvis", tool: true, text: `⚙ ${ev.name}${ev.state === "error" ? " ✗" : ""}${ev.summary ? ` — ${ev.summary}` : ""}` }]);
            } else if (ev.type === "navigate" && ev.route && ev.route.startsWith("/")) {
              window.location.href = ev.route;
            } else if (ev.type === "error") {
              setLog((l) => [...l, { role: "jarvis", text: `Brain error: ${ev.message ?? ev.error ?? "failure"}` }]);
            }
            // meta/done extras and unknown types are ignored (forward-compat).
          } catch { /* partial frame */ }
        }
      }
      fetch("/api/v2/jarvis/ask").then((res) => res.json()).then((j) => setStatus({ busy: !!j?.busy, engine: j?.engine ?? null, conversationId: j?.conversationId ?? null })).catch(() => {});
    } catch (e) {
      setLog((l) => [...l, { role: "jarvis", text: `Unreachable: ${e instanceof Error ? e.message : "unknown"}` }]);
    }
    setPhase((p) => (p === "thinking" ? "idle" : p));
  }

  function resetSession() {
    // V2: a "reset" is simply a fresh conversation — drop the thread id locally.
    conversationIdRef.current = null;
    speakQ.current = [];
    setLog([]);
    setStatus((s) => ({ ...s, conversationId: null }));
  }

  async function savePersona() {
    if (!persona) return;
    setSaving(true);
    try {
      const r = await fetch("/api/jarvis/persona", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persona),
      });
      const j = await r.json();
      if (j.persona) setPersona(j.persona);
      setGearOpen(false);
    } finally { setSaving(false); }
  }

  const hue = PHASE_HUE[phase];

  return (
    <GlassCard strong hudCorners glow className="relative overflow-hidden p-0">
      <audio ref={audioRef} className="hidden" />
      {/* status glow tracks the phase, like the standalone rig's face states */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -right-16 -top-16 h-64 w-64 rounded-full blur-3xl transition-all duration-700"
          style={{ background: `radial-gradient(circle, ${hue} 0%, transparent 60%)`, opacity: phase === "idle" ? 0.5 : 0.9 }}
        />
      </div>

      {/* Mini console strip — photobashed from the operator's sci-fi asset pack
          (scifi-elements: Consoles #5 "Gravitic Stabilizer" + Greebles #19
          energy module). The phase orb is socketed into the console's central
          bore; the readout is a CRT screen whose phosphor tracks the phase. */}
      <div className="flex items-stretch gap-3 p-5 pb-3">
        <div className="relative h-28 w-[140px] shrink-0 select-none">
          {/* Under-glow BEHIND the artwork: bleeds through any pixels of the
              console PNG that are (or get erased to) semi-transparent — thin
              the copper coil seams in the source art and this is the light
              that leaks out. Sized to cover the whole core ring. */}
          <div
            className="absolute h-16 w-16 rounded-full transition-all duration-700"
            style={{
              left: "50%", top: "51.5%", transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, ${hue} 0%, transparent 70%)`,
              opacity: phase === "idle" ? 0.5 : 0.95,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/jarvis/console-core.png" alt="" className="relative h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]" />
          {/* the orb, seated in the console's central bore (bore center ≈ 50% / 51.5%) */}
          <div
            className={`absolute h-6 w-6 rounded-full transition-all duration-700 ${phase === "thinking" || phase === "listening" ? "animate-pulse" : ""}`}
            style={{
              left: "50%", top: "51.5%", transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, #eaffef 0%, ${hue} 45%, transparent 75%)`,
              boxShadow: `0 0 ${phase === "idle" ? 10 : 26}px 4px ${hue}`,
            }}
          />
        </div>

        {/* CRT readout screen */}
        <div
          className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-[rgba(120,160,170,0.35)] bg-[#050d0f] px-4 py-2.5"
          style={{ boxShadow: `inset 0 0 24px rgba(0,0,0,0.9), inset 0 0 60px ${hue.replace(/[\d.]+\)$/, "0.07)")}` }}
        >
          {/* scanlines + vignette */}
          <div className="pointer-events-none absolute inset-0" style={{
            background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
          }} />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] uppercase tracking-[0.25em]" style={{ color: hue, textShadow: `0 0 8px ${hue}` }}>
                  {persona?.name ?? "Jarvis"} <span className="opacity-70">// {phase}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[10px] tracking-wider text-[rgba(160,210,190,0.75)]">
                  {status.engine
                    ? `V2 BRAIN · ${status.engine.toUpperCase()} · ${status.busy ? "BUSY" : "IDLE"}${conversationIdRef.current ? " · THREADED" : ""}`
                    : "CORE COLD — FIRST ASK IGNITES SESSION"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setVoiceOn((v) => !v)} title={voiceOn ? "Mute voice" : "Voice on"}
                  className="rounded border border-[rgba(120,160,170,0.3)] p-1 text-[rgba(160,210,190,0.7)] hover:text-[var(--color-neon)]">
                  {voiceOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                </button>
                <button onClick={resetSession} title="Reset conversation"
                  className="rounded border border-[rgba(120,160,170,0.3)] p-1 text-[rgba(160,210,190,0.7)] hover:text-[var(--color-neon)]">
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button onClick={() => setGearOpen((v) => !v)} title="Persona settings"
                  className="rounded border border-[rgba(120,160,170,0.3)] p-1 text-[rgba(160,210,190,0.7)] hover:text-[var(--color-neon)]">
                  <Settings2 className="h-3 w-3" />
                </button>
                <Link href="/jarvis" title="Full Jarvis HUD"
                  className="rounded border border-[rgba(120,160,170,0.3)] p-1 text-[rgba(160,210,190,0.7)] hover:text-[var(--color-neon)]">
                  <Maximize2 className="h-3 w-3" />
                </Link>
              </div>
            </div>
            {/* phase trace — a thin activity bar along the screen bottom */}
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded bg-[rgba(120,160,170,0.15)]">
              <div
                className="h-full rounded transition-all duration-700"
                style={{
                  width: phase === "idle" ? "18%" : phase === "listening" ? "55%" : phase === "thinking" ? "85%" : "100%",
                  background: hue, boxShadow: `0 0 8px ${hue}`,
                }}
              />
            </div>
          </div>
        </div>

        {/* energy module greeble — flavor, hidden when narrow */}
        <div className="relative hidden h-28 w-[150px] shrink-0 select-none xl:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/jarvis/energy-module.png" alt="" className="h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
            style={{ filter: phase === "idle" ? "saturate(0.7) brightness(0.85)" : "saturate(1.1)" }} />
        </div>
      </div>

      {gearOpen && persona && (
        <div className="mx-5 mb-3 rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.35)] p-3 text-[12px]">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">Persona — editable data, applied on next session</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[var(--color-ink-dim)]">Name
              <input value={persona.name} onChange={(e) => setPersona({ ...persona, name: e.target.value })}
                className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--color-ink)]" />
            </label>
            <label className="flex flex-col gap-1 text-[var(--color-ink-dim)]">Addresses you as
              <input value={persona.userAddress} onChange={(e) => setPersona({ ...persona, userAddress: e.target.value })}
                className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--color-ink)]" />
            </label>
          </div>
          <label className="mt-2 flex flex-col gap-1 text-[var(--color-ink-dim)]">Voice rules (character)
            <textarea rows={3} value={persona.voiceRules} onChange={(e) => setPersona({ ...persona, voiceRules: e.target.value })}
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--color-ink)]" />
          </label>
          <label className="mt-2 flex flex-col gap-1 text-[var(--color-ink-dim)]">Spoken style
            <textarea rows={2} value={persona.spokenStyle} onChange={(e) => setPersona({ ...persona, spokenStyle: e.target.value })}
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--color-ink)]" />
          </label>
          <label className="mt-2 flex flex-col gap-1 text-[var(--color-ink-dim)]">Banned phrases (comma-separated)
            <input value={persona.bannedPhrases.join(", ")}
              onChange={(e) => setPersona({ ...persona, bannedPhrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[var(--color-ink)]" />
          </label>
          <button onClick={savePersona} disabled={saving}
            className="mt-3 rounded-lg border border-[var(--color-neon)] px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[var(--color-neon)] hover:bg-[rgba(111,255,155,0.1)] disabled:opacity-50">
            {saving ? "Saving…" : "Save persona"}
          </button>
        </div>
      )}

      <div ref={logBoxRef} className="mx-5 mb-3 h-44 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] p-3">
        {log.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
            Speak or type. The mic drops what it hears into the box below so you can
            review and edit before sending — nothing goes out until you hit send.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {log.map((m, i) => (
              <div key={i} className="text-[13px] leading-relaxed">
                <span className={`font-mono text-[10px] uppercase tracking-widest ${m.role === "you" ? "text-[var(--color-ink-faint)]" : "text-[var(--color-neon)]"}`}>
                  {m.role === "you" ? "you" : (persona?.name ?? "jarvis")}
                </span>
                <span className="ml-2 text-[var(--color-ink)]">{m.text}</span>
              </div>
            ))}
            {phase === "thinking" && (
              <div className="font-mono text-[11px] text-[var(--color-ink-faint)]">…thinking</div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-5 pb-5">
        <button onClick={toggleMic}
          title={phase === "listening" ? "Stop listening" : "Speak (reviewed before send)"}
          className="rounded-xl border p-2.5 transition-colors"
          style={{
            borderColor: phase === "listening" ? PHASE_HUE.listening : "var(--color-border)",
            color: phase === "listening" ? PHASE_HUE.listening : "var(--color-ink-dim)",
            boxShadow: phase === "listening" ? `0 0 12px ${PHASE_HUE.listening}` : "none",
          }}>
          <Mic className="h-4 w-4" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendUtterance(); } }}
          placeholder={phase === "listening" ? "Listening — edit freely, then send…" : "Ask Jarvis…"}
          className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-[13.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-neon)]"
        />
        <button onClick={() => void sendUtterance()} disabled={!input.trim() || phase === "thinking"}
          className="rounded-xl border border-[var(--color-neon)] p-2.5 text-[var(--color-neon)] hover:bg-[rgba(111,255,155,0.1)] disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </GlassCard>
  );
}
