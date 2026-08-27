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
export type VoiceProviderId = "webspeech" | "kimi" | "openai-realtime" | "gemini-live";

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

export const VOICE_PROVIDERS: VoiceProviderInfo[] = [
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
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? VOICE_PROVIDERS[0];
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

  const onFinalChunkRef = useRef(opts.onFinalChunk);
  onFinalChunkRef.current = opts.onFinalChunk;

  // Availability is a client-only fact — resolve after mount.
  useEffect(() => {
    setAvailable(info.available());
  }, [info]);

  const teardown = useCallback(() => {
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

  const start = useCallback(() => {
    const availability = info.available();
    if (availability !== true) {
      // Rule-11 spirit: never a silent no-op — surface the reason.
      setError(availability);
      setStatus("error");
      return;
    }
    if (runningRef.current) return; // never two recognizers
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
  }, [info]);

  const stop = useCallback(() => {
    // stop() lets pending FINAL results flush through onresult before onend.
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    teardown();
    setPartial("");
    setStatus("idle");
    setError(null);
  }, [teardown]);

  return { status, partial, error, providerId: info.id, available, start, stop, cancel };
}
