"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, X, Radio } from "lucide-react";

const PINK = "#f472b6";
const TEAL = "#34d399";

type Status = "idle" | "listening" | "thinking" | "speaking" | "error";
interface Line { id: string; role: "you" | "jarvis"; text: string; }

interface SR extends EventTarget {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

// Voice provider #3: Kimi-K3 + Butler TTS. Turn-based — browser STT hears you,
// kimi-k3 (Ollama Cloud) thinks, ElevenLabs speaks the reply in the British
// butler voice. No barge-in (that needs native speech-to-speech), but zero
// per-minute billing: it rides the Ollama Cloud plan + ElevenLabs.
export default function JarvisKimiVoice({ voice, onClose }: { voice?: string; onClose?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const recRef = useRef<SR | null>(null);
  const liveRef = useRef(false);
  const busyRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const histRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const nid = () => `k${(idRef.current++).toString(36)}`;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [lines]);
  useEffect(() => { liveRef.current = live; }, [live]);

  function logTurn(you: string, jarvis: string) {
    if (!you && !jarvis) return;
    fetch("/api/hermes/jarvis-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ you, jarvis, kind: "realtime-kimi" }) }).catch(() => {});
  }

  const speak = useCallback(async (text: string) => {
    setStatus("speaking");
    try {
      const j = await fetch("/api/hermes/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // "auto": local Kokoro (bm_george) first, then ElevenLabs (Daniel), then
        // OpenAI — the butler character survives every hop.
        body: JSON.stringify({ text: text.slice(0, 600), ...(voice ? { voiceId: voice } : {}), provider: "auto" }),
      }).then((r) => r.json());
      if (j.audio && audioRef.current) {
        await new Promise<void>((done) => {
          const a = audioRef.current!;
          a.src = j.audio;
          a.onended = () => done();
          a.onerror = () => done();
          a.play().catch(() => done());
        });
      }
    } catch { /* silent butler beats a crashed one */ }
  }, [voice]);

  const takeTurn = useCallback(async (prompt: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus("thinking");
    setLines((l) => [...l, { id: nid(), role: "you", text: prompt }]);
    try {
      const j = await fetch("/api/hermes/realtime/kimi-turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history: histRef.current.slice(-8) }),
      }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || "kimi turn failed");
      setModel(j.model || null);
      const reply = String(j.text || "").trim();
      setLines((l) => [...l, { id: nid(), role: "jarvis", text: reply }]);
      histRef.current.push({ role: "user", content: prompt }, { role: "assistant", content: reply });
      histRef.current = histRef.current.slice(-16);
      logTurn(prompt, reply);
      await speak(reply);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    busyRef.current = false;
    // Back to the mic — small delay so it doesn't catch the audio tail.
    if (liveRef.current) { setStatus("listening"); setTimeout(() => { try { recRef.current?.start(); } catch { /* already running */ } }, 300); }
    else setStatus("idle");
  }, [speak]);

  const startLive = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { setErr("This browser has no speech recognition — Opera/Chrome needed, or just type."); setStatus("error"); return; }
    setErr(null);
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "en-US"; rec.interimResults = false; rec.continuous = false;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const text = last?.[0]?.transcript?.trim();
      if (text && last.isFinal) { try { rec.stop(); } catch { /* fine */ } void takeTurn(text); }
    };
    // One utterance per recognition run; restart between turns unless busy thinking/speaking.
    rec.onend = () => { if (liveRef.current && !busyRef.current) { setTimeout(() => { try { rec.start(); } catch { /* already running */ } }, 150); } };
    rec.onerror = (e) => { if (e.error === "not-allowed") { setErr("Mic permission denied."); setLive(false); setStatus("error"); } };
    setLive(true); liveRef.current = true;
    setStatus("listening");
    try { rec.start(); } catch { /* already running */ }
  }, [takeTurn]);

  const stopLive = useCallback(() => {
    setLive(false); liveRef.current = false;
    try { recRef.current?.abort(); } catch { /* fine */ }
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } } catch { /* fine */ }
    setStatus("idle");
  }, []);

  useEffect(() => () => { liveRef.current = false; try { recRef.current?.abort(); } catch { /* unmount */ } }, []);

  function sendText() {
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput("");
    void takeTurn(text);
  }

  const dot = status === "listening" ? TEAL : status === "thinking" ? "#f59e0b" : status === "speaking" ? PINK : status === "error" ? "#f87171" : "var(--fg-dimmer)";
  const label = status === "listening" ? "LISTENING — just talk" : status === "thinking" ? "KIMI THINKING…" : status === "speaking" ? "JARVIS SPEAKING" : status.toUpperCase();
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${PINK}55`, background: "rgba(244,114,182,0.04)" }}>
      <audio ref={audioRef} hidden />
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `${PINK}33` }}>
        <span className="text-[12px] font-mono flex items-center gap-2" style={{ color: PINK }}>
          <span className="w-2 h-2 rounded-full" style={{ background: dot, boxShadow: status === "listening" ? `0 0 8px ${TEAL}` : undefined }} />
          KIMI K3 · {label}{model ? ` · ${model}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {!live ? (
            <button onClick={startLive} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5" style={{ borderColor: TEAL, color: TEAL, background: "rgba(52,211,153,0.12)" }}>
              <Radio size={13} /> Go live
            </button>
          ) : (
            <button onClick={stopLive} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)" }}>
              <X size={13} /> End
            </button>
          )}
          {onClose && <button onClick={() => { stopLive(); onClose(); }} title="Close" className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300/80"><X size={14} /></button>}
        </div>
      </div>

      <div ref={scrollRef} className="px-4 py-3 space-y-2 overflow-y-auto" style={{ maxHeight: 320, minHeight: 120 }}>
        {status === "idle" && lines.length === 0 && (
          <div className="text-[12.5px] text-[var(--fg-dimmer)] text-center py-6">
            Hit <b style={{ color: TEAL }}>Go live</b> and talk — Kimi thinks, the butler speaks. Turn-based: let it finish before you reply. Type any time too.
          </div>
        )}
        {err && <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2">{err}</div>}
        {lines.map((l) => (
          <div key={l.id} className="text-[14px] leading-relaxed">
            <span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: l.role === "you" ? "var(--gold)" : PINK }}>{l.role === "you" ? "You" : "JARVIS"}</span>
            <span className="text-[var(--fg)]">{l.text}</span>
          </div>
        ))}
        {status === "thinking" && <div className="text-[12.5px] text-[var(--fg-dim)] flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Thinking…</div>}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: `${PINK}22` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
          placeholder="Talk when live, or type and press Enter…"
          className="flex-1 bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-lg px-3.5 h-10 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]" />
        <button onClick={sendText} disabled={!input.trim()} className="px-4 h-10 rounded-lg border border-[var(--panel-border)] text-[13px] text-[var(--fg-dim)] disabled:opacity-30 flex items-center gap-1.5"><Send size={14} /> Send</button>
      </div>
    </div>
  );
}
