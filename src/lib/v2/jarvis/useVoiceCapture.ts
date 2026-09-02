"use client";

// SPEC-C C3 (C2.1/C2.2/C2.3): provider-agnostic voice CAPTURE hook — the C2b
// seam. Uniform shape ported from the upstream use-voice-chat contract:
//   { status, partial, error, start(), stop(), cancel() } + onFinalChunk(text).
//
// CAPTURE ONLY: this hook never sends anything anywhere — finalized transcript
// chunks are handed to the caller (ChatboxOverlay inserts them at the cursor);
// what happens on stop is entirely the caller's decision (C2b: nothing, unless
// the user opted into jarvis.voice.autoSend).
//
// Provider registry (SPEC-C C3): 'webspeech' + 'kimi' are live (the existing
// JarvisKimiVoice "plumbing" IS browser SpeechRecognition — Kimi is the brain,
// not the STT — so its capture path is the same recognizer); realtime/gemini
// are declared stubs whose available() returns a REASON string (grayed out in
// the UI with a tooltip — never a silent no-op; Opera ships SpeechRecognition
// disabled, see availability check).

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceCaptureStatus = "idle" | "recording" | "error";
export type VoiceProviderId = "webspeech" | "kimi" | "openai-realtime" | "gemini-live" | "voicebox";

export interface VoiceProviderInfo {
  id: VoiceProviderId;
  label: string;
  isLocal: boolean;
  /** true = usable now; a string = human-readable reason it is unavailable. */
  available: () => true | string;
}

// Minimal SpeechRecognition surface (same local typing style as JarvisView).
type SR = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error?: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
};

function getSRCtor(): { new (): SR } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): SR };
    webkitSpeechRecognition?: { new (): SR };
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isOpera(): boolean {
  if (typeof navigator === "undefined") return false;
  return / OPR\//.test(navigator.userAgent) || /Opera/.test(navigator.userAgent);
}

/**
 * Web Speech availability. Opera is the documented trap (SPEC-C §8.4): it
 * exposes webkitSpeechRecognition but ships it DISABLED (no speech backend) —
 * feature-detecting the constructor alone would silently no-op the mic.
 */
function webSpeechAvailability(): true | string {
  if (typeof window === "undefined") return "server render";
  if (isOpera()) {
    return "Opera ships SpeechRecognition disabled (no speech backend) — use Chrome/Edge, or a non-browser voice provider once wired.";
  }
  if (!getSRCtor()) return "SpeechRecognition is not available in this browser — try Chrome or Edge.";
  return true;
}

/**
 * Voicebox capture needs only a microphone and MediaRecorder: the recording is
 * posted to /api/voicebox/transcribe (Whisper in the local studio). No browser
 * speech backend involved, so it is the path that works in Opera.
 */
function mediaRecorderAvailability(): true | string {
  if (typeof window === "undefined") return "server render";
  if (!navigator.mediaDevices?.getUserMedia) {
    // The usual reason on this LAN: the app is open at http://<ip>:3737.
    // Browsers only expose the microphone on https or on localhost. Say so,
    // with the two ways out, instead of a generic "no microphone API".
    const origin = window.location.origin;
    const secure = window.isSecureContext;
    if (!secure) {
      return `Mic blocked on ${origin}: browsers only allow the microphone on https or localhost. On this PC open http://localhost:3737; from another device, in Opera/Chrome open opera://flags/#unsafely-treat-insecure-origin-as-secure (chrome://flags in Chrome), add ${origin}, enable, relaunch.`;
    }
    return "This browser exposes no microphone API.";
  }
  if (typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === "undefined") return "MediaRecorder is not available in this browser.";
  return true;
}

export const VOICE_PROVIDERS: VoiceProviderInfo[] = [
  // Local Whisper via Voicebox. Listed first because it is the one that works
  // in the owner's browser (Opera) and keeps audio on this machine.
  { id: "voicebox", label: "Voicebox (local Whisper)", isLocal: true, available: mediaRecorderAvailability },
  { id: "webspeech", label: "Browser (Web Speech)", isLocal: false, available: webSpeechAvailability },
  // Kimi's existing capture plumbing (JarvisKimiVoice) is browser STT feeding
  // the Kimi brain — capture-wise it is the same recognizer.
  { id: "kimi", label: "Kimi (browser STT)", isLocal: false, available: webSpeechAvailability },
  // TODO(C3 chunk 2): adapt JarvisRealtime's data-channel transcript deltas
  // (input_audio_transcription events) into partial/final chunks. The full
  // Realtime session is conversation-coupled (WebRTC + session token + replies),
  // so transcript-only capture needs its own lean session — stubbed until then.
  {
    id: "openai-realtime",
    label: "OpenAI Realtime",
    isLocal: false,
    available: () => "Realtime transcript-only capture not wired yet (lands with the C3 brain chunk).",
  },
  // TODO(C3 chunk 2): Gemini Live transcription adapter.
  {
    id: "gemini-live",
    label: "Gemini Live",
    isLocal: false,
    available: () => "Gemini Live capture not wired yet (lands with the C3 brain chunk).",
  },
];

export function providerInfo(id: string | undefined): VoiceProviderInfo {
  // Unknown/unset falls back to Web Speech (the historical default), not to
  // whatever sits first in the list.
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS.find((p) => p.id === "webspeech")!;
}

export interface UseVoiceCaptureOptions {
  /** Provider id from settings.jarvis.voice.provider (default "webspeech"). */
  provider?: string;
  /** Finalized transcript chunk — caller inserts it (never auto-sent here). */
  onFinalChunk?: (text: string) => void;
}

export interface UseVoiceCaptureReturn {
  status: VoiceCaptureStatus;
  /** Live interim transcript while recording (ghost text at the cursor). */
  partial: string;
  error: string | null;
  providerId: VoiceProviderId;
  /** true, or the reason the active provider can't capture. */
  available: true | string;
  start: () => void;
  /** Stop recording; pending finals still flush. NEVER sends. */
  stop: () => void;
  /** Abort recording and discard any pending partial/final. */
  cancel: () => void;
}

export function useVoiceCapture(opts: UseVoiceCaptureOptions = {}): UseVoiceCaptureReturn {
  const info = providerInfo(opts.provider);
  const [status, setStatus] = useState<VoiceCaptureStatus>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<true | string>("server render");

  const recRef = useRef<SR | null>(null);
  const runningRef = useRef(false); // never-two-recognizers guard (JarvisView lifecycle)
  const cancelledRef = useRef(false);
  // Voicebox (MediaRecorder) lane.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onFinalChunkRef = useRef(opts.onFinalChunk);
  onFinalChunkRef.current = opts.onFinalChunk;

  // Availability is a client-only fact — resolve after mount.
  useEffect(() => {
    setAvailable(info.available());
  }, [info]);

  const teardownRecorder = useCallback(() => {
    const mr = recorderRef.current;
    recorderRef.current = null;
    if (mr) { mr.ondataavailable = null; mr.onstop = null; mr.onerror = null; try { if (mr.state !== "inactive") mr.stop(); } catch { /* already */ } }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    runningRef.current = false;
  }, []);

  const teardown = useCallback(() => {
    teardownRecorder();
    const rec = recRef.current;
    recRef.current = null;
    runningRef.current = false;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  /** Voicebox lane: record, then transcribe on stop. The transcript is a FINAL chunk, never sent here. */
  const startRecorder = useCallback(async () => {
    if (runningRef.current) return;
    cancelledRef.current = false;
    setError(null);
    setPartial("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as Error)?.name ?? "";
      setError(name === "NotAllowedError" ? "Mic blocked — allow Microphone in the address bar, then try again." : "Mic error: " + ((e as Error)?.message ?? name));
      setStatus("error");
      return;
    }
    if (cancelledRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    streamRef.current = stream;
    recorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data); };
    mr.onerror = () => { setError("Recorder error"); setStatus("error"); teardownRecorder(); };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      const wasCancelled = cancelledRef.current;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      runningRef.current = false;
      if (wasCancelled || !blob.size) { setPartial(""); setStatus("idle"); return; }
      setPartial("(transcribing…)");
      try {
        const fd = new FormData();
        fd.append("audio", blob, "recording." + (blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"));
        const r = await fetch("/api/voicebox/transcribe", { method: "POST", body: fd });
        const j = (await r.json()) as { ok?: boolean; text?: string; error?: string };
        if (!r.ok || !j.ok) throw new Error(j.error || `transcribe ${r.status}`);
        setPartial("");
        setStatus("idle");
        if (j.text) onFinalChunkRef.current?.(j.text);
      } catch (e) {
        setPartial("");
        setError("Voicebox transcription failed: " + ((e as Error)?.message ?? e));
        setStatus("error");
      }
    };
    mr.start(250);
    runningRef.current = true;
    setStatus("recording");
  }, [teardownRecorder]);

  const start = useCallback(() => {
    const availability = info.available();
    if (availability !== true) {
      // Rule-11 spirit: never a silent no-op — surface the reason.
      setError(availability);
      setStatus("error");
      return;
    }
    if (runningRef.current) return; // never two recognizers
    if (info.id === "voicebox") { void startRecorder(); return; }
    const Ctor = getSRCtor();
    if (!Ctor) {
      setError("SpeechRecognition constructor vanished — cannot record.");
      setStatus("error");
      return;
    }
    cancelledRef.current = false;
    setError(null);
    setPartial("");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.onstart = () => {
      runningRef.current = true;
      setStatus("recording");
    };
    rec.onresult = (e) => {
      if (cancelledRef.current) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = (res?.[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (res.isFinal) {
          // Finalized chunk → hand to the caller (cursor insert). No sending here.
          onFinalChunkRef.current?.(text);
        } else {
          interim += (interim ? " " : "") + text;
        }
      }
      setPartial(interim);
    };
    rec.onerror = (e) => {
      const err = e?.error || "unknown";
      runningRef.current = false;
      setPartial("");
      if (err === "no-speech" || err === "aborted") {
        setStatus("idle"); // benign — user just didn't speak / we aborted
        return;
      }
      setError(
        err === "not-allowed" || err === "service-not-allowed"
          ? "Mic blocked — allow Microphone in the address bar, then try again."
          : "Mic error: " + err,
      );
      setStatus("error");
    };
    rec.onend = () => {
      runningRef.current = false;
      setPartial("");
      setStatus((s) => (s === "error" ? s : "idle"));
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already running — the guard should have caught this */
    }
  }, [info, startRecorder]);

  const stop = useCallback(() => {
    if (info.id === "voicebox") {
      // The recorder's onstop posts the clip for transcription; the transcript
      // arrives as one final chunk. Nothing is sent from here.
      const mr = recorderRef.current;
      try { if (mr && mr.state !== "inactive") mr.stop(); } catch { /* not running */ }
      return;
    }
    // stop() lets pending FINAL results flush through onresult before onend.
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
  }, [info]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    teardown();
    setPartial("");
    setStatus("idle");
    setError(null);
  }, [teardown]);

  return { status, partial, error, providerId: info.id, available, start, stop, cancel };
}
