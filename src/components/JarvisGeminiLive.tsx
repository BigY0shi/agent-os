"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, X, Radio } from "lucide-react";
import { GoogleGenAI, Modality, type Session, type LiveServerMessage } from "@google/genai";

const BLUE = "#60a5fa";
const TEAL = "#34d399";

type Status = "idle" | "connecting" | "live" | "error";
interface Line { id: string; role: "you" | "jarvis"; text: string; }

// Real-time speech-to-speech on the Gemini Live API — the free-tier / Google AI
// Pro–boosted sibling of the OpenAI realtime panel. Direct WebSocket from the
// browser using a server-minted EPHEMERAL token (the real key never leaves the
// server). Mic → 16kHz PCM16 chunks in; 24kHz PCM16 audio out with barge-in.
export default function JarvisGeminiLive({ onClose }: { onClose?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playingRef = useRef<AudioBufferSourceNode[]>([]);
  const nextTimeRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userTextRef = useRef("");      // accumulating input transcription
  const asstTextRef = useRef("");      // accumulating output transcription
  const asstLineRef = useRef<string | null>(null);
  const idRef = useRef(0);
  const nid = () => `g${(idRef.current++).toString(36)}`;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [lines]);

  function logTurn(you: string, jarvis: string) {
    if (!you && !jarvis) return;
    fetch("/api/hermes/jarvis-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ you, jarvis, kind: "realtime-gemini" }) }).catch(() => {});
  }

  const asstDelta = (delta: string) => {
    asstTextRef.current += delta;
    setLines((l) => {
      if (asstLineRef.current) return l.map((x) => x.id === asstLineRef.current ? { ...x, text: x.text + delta } : x);
      const id = nid(); asstLineRef.current = id; return [...l, { id, role: "jarvis", text: delta }];
    });
  };

  // ── Audio out: queue 24kHz PCM16 chunks back-to-back; kill the queue on barge-in.
  function playChunk(b64: string) {
    const ctx = outCtxRef.current;
    if (!ctx) return;
    const raw = atob(b64);
    const pcm = new Int16Array(new Uint8Array([...raw].map((c) => c.charCodeAt(0))).buffer);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime, nextTimeRef.current);
    src.start(at);
    nextTimeRef.current = at + buf.duration;
    playingRef.current.push(src);
    src.onended = () => { playingRef.current = playingRef.current.filter((s) => s !== src); if (!playingRef.current.length) setSpeaking(false); };
    setSpeaking(true);
  }

  function stopPlayback() {
    for (const s of playingRef.current) { try { s.stop(); } catch { /* already done */ } }
    playingRef.current = [];
    nextTimeRef.current = 0;
    setSpeaking(false);
  }

  function onMessage(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc?.interrupted) { stopPlayback(); return; }   // barge-in: user spoke over it
    if (sc?.inputTranscription?.text) userTextRef.current += sc.inputTranscription.text;
    if (sc?.outputTranscription?.text) asstDelta(sc.outputTranscription.text);
    for (const p of sc?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) playChunk(p.inlineData.data as string);
    }
    if (sc?.turnComplete) {
      const you = userTextRef.current.trim();
      if (you) setLines((l) => {
        // Input transcription arrives in parallel with output — render the user
        // line just before the assistant line it produced.
        const idx = asstLineRef.current ? l.findIndex((x) => x.id === asstLineRef.current) : -1;
        const line: Line = { id: nid(), role: "you", text: you };
        return idx >= 0 ? [...l.slice(0, idx), line, ...l.slice(idx)] : [...l, line];
      });
      logTurn(you, asstTextRef.current.trim());
      userTextRef.current = ""; asstTextRef.current = ""; asstLineRef.current = null;
    }
    // The butler called a tool — run it, hand the result back so it confirms out loud.
    if (msg.toolCall?.functionCalls?.length) void handleTools(msg.toolCall.functionCalls);
  }

  async function handleTools(calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>) {
    const session = sessionRef.current; if (!session) return;
    const responses = [];
    for (const fc of calls) {
      if (fc.name === "open_app_or_site") {
        const target = String(fc.args?.target ?? "");
        if (target) setLines((l) => [...l, { id: nid(), role: "jarvis", text: `⚙️ Opening ${target}…` }]);
        let ok = false;
        try { ok = (await fetch("/api/hermes/realtime/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) }).then((r) => r.json()))?.ok; } catch { /* ignore */ }
        responses.push({ id: fc.id, name: fc.name, response: { success: ok, target } });
      } else {
        responses.push({ id: fc.id, name: fc.name, response: { error: "unknown tool" } });
      }
    }
    try { session.sendToolResponse({ functionResponses: responses }); } catch { /* session gone */ }
  }

  const connect = useCallback(async () => {
    setErr(null); setStatus("connecting");
    try {
      const j = await fetch("/api/hermes/realtime/gemini-session", { method: "POST" }).then((r) => r.json());
      if (!j?.token) throw new Error(j?.error || "couldn't mint a Gemini Live token");

      // Ephemeral token auth requires v1alpha (SDK routes it to the constrained endpoint).
      const ai = new GoogleGenAI({ apiKey: j.token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model: j.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: j.persona,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          tools: [{
            functionDeclarations: [{
              name: "open_app_or_site",
              description: "Open a website or an installed application on the user's computer. Call this whenever they ask to open, launch, go to, or pull up something.",
              parametersJsonSchema: {
                type: "object",
                properties: { target: { type: "string", description: "A full https:// URL, or an installed app name (e.g. 'Notepad', 'Opera')." } },
                required: ["target"],
              },
            }],
          }],
        },
        callbacks: {
          onopen: () => setStatus("live"),
          onmessage: (m: LiveServerMessage) => onMessage(m),
          onerror: (e: ErrorEvent) => { setErr(e.message || "live session error"); setStatus("error"); },
          onclose: () => setStatus((s) => (s === "live" ? "idle" : s)),
        },
      });
      sessionRef.current = session;

      // Mic → 16kHz PCM16 → base64 chunks. VAD is server-side; just stream.
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = ms;
      const micCtx = new AudioContext({ sampleRate: 16000 });
      micCtxRef.current = micCtx;
      outCtxRef.current = new AudioContext({ sampleRate: 24000 });
      const srcNode = micCtx.createMediaStreamSource(ms);
      const proc = micCtx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (e) => {
        const s = sessionRef.current; if (!s) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
        let bin = "";
        const bytes = new Uint8Array(pcm.buffer);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        try { s.sendRealtimeInput({ media: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" } }); } catch { /* session closing */ }
      };
      srcNode.connect(proc);
      proc.connect(micCtx.destination); // required for onaudioprocess to fire; proc outputs silence
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setStatus("error"); cleanup();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function cleanup() {
    stopPlayback();
    try { sessionRef.current?.close(); } catch {}
    try { procRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { micCtxRef.current?.close(); } catch {}
    try { outCtxRef.current?.close(); } catch {}
    sessionRef.current = null; procRef.current = null; streamRef.current = null;
    micCtxRef.current = null; outCtxRef.current = null; asstLineRef.current = null;
  }
  const disconnect = useCallback(() => { cleanup(); setStatus("idle"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startedRef = useRef(false);
  useEffect(() => { if (!startedRef.current) { startedRef.current = true; void connect(); } }, [connect]);

  function sendText() {
    const text = input.trim(); const s = sessionRef.current;
    if (!text || !s || status !== "live") return;
    setLines((l) => [...l, { id: nid(), role: "you", text }]);
    userTextRef.current = text; setInput("");
    try { s.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true }); } catch { /* session gone */ }
  }

  const dot = status === "live" ? TEAL : status === "connecting" ? "#f59e0b" : status === "error" ? "#f87171" : "var(--fg-dimmer)";
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: `${BLUE}55`, background: "rgba(96,165,250,0.04)" }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `${BLUE}33` }}>
        <span className="text-[12px] font-mono flex items-center gap-2" style={{ color: BLUE }}>
          <span className="w-2 h-2 rounded-full" style={{ background: dot, boxShadow: status === "live" ? `0 0 8px ${TEAL}` : undefined }} />
          GEMINI LIVE · {status === "live" ? (speaking ? "JARVIS SPEAKING" : "LISTENING — just talk") : status.toUpperCase()}
        </span>
        <div className="flex items-center gap-2">
          {status === "idle" || status === "error" ? (
            <button onClick={connect} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5" style={{ borderColor: TEAL, color: TEAL, background: "rgba(52,211,153,0.12)" }}>
              <Radio size={13} /> Go live
            </button>
          ) : (
            <button onClick={disconnect} className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)" }}>
              <X size={13} /> End
            </button>
          )}
          {onClose && <button onClick={() => { disconnect(); onClose(); }} title="Close" className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300/80"><X size={14} /></button>}
        </div>
      </div>

      <div ref={scrollRef} className="px-4 py-3 space-y-2 overflow-y-auto" style={{ maxHeight: 320, minHeight: 120 }}>
        {status === "connecting" && <div className="text-[12.5px] text-[var(--fg-dim)] flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Opening the Gemini live link… allow the mic if asked.</div>}
        {err && <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2">{err}</div>}
        {lines.map((l) => (
          <div key={l.id} className="text-[14px] leading-relaxed">
            <span className="text-[10px] uppercase tracking-widest mr-2" style={{ color: l.role === "you" ? "var(--gold)" : BLUE }}>{l.role === "you" ? "You" : "JARVIS"}</span>
            <span className="text-[var(--fg)]">{l.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: `${BLUE}22` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
          placeholder={status === "live" ? "Talk, or type any time and press Enter…" : "Go live first to chat"}
          disabled={status !== "live"}
          className="flex-1 bg-[rgba(0,0,0,0.3)] border border-[var(--panel-border)] rounded-lg px-3.5 h-10 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] disabled:opacity-40" />
        <button onClick={sendText} disabled={status !== "live" || !input.trim()} className="px-4 h-10 rounded-lg border border-[var(--panel-border)] text-[13px] text-[var(--fg-dim)] disabled:opacity-30 flex items-center gap-1.5"><Send size={14} /> Send</button>
      </div>
    </div>
  );
}
