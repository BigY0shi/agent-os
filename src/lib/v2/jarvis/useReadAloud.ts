"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Ordered speech through the user's selected server-side TTS configuration. */
export function useReadAloud(provider: string) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const finishAudio = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    abort.current?.abort();
    audio.current?.pause();
    finishAudio.current?.();
    finishAudio.current = null;
    setSpeaking(false);
  }, []);
  useEffect(() => () => { stop(); }, [stop]);
  const read = useCallback(async (text: string) => {
    stop(); setError("");
    const current = generation.current;
    const controller = new AbortController(); abort.current = controller;
    setSpeaking(true);
    try {
      // TTS route has bounded input; split without dropping any listing text.
      const chunks = text.match(/[\s\S]{1,500}(?:\s|$)|[\s\S]{1,500}/g) ?? [];
      for (const chunk of chunks) {
        if (generation.current !== current) break;
        const response = await fetch("/api/hermes/tts", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: chunk, provider }) });
        const result = await response.json();
        if (!response.ok || !result.audio) throw new Error(result.error || "Speech provider returned no audio");
        if (generation.current !== current) break;
        const player = new Audio(result.audio); audio.current = player;
        await new Promise<void>((resolve, reject) => {
          finishAudio.current = resolve;
          player.onended = () => resolve();
          player.onerror = () => reject(new Error("Audio playback failed"));
          player.play().catch(reject);
        });
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === current) { setSpeaking(false); finishAudio.current = null; }
    }
  }, [provider, stop]);
  return { speaking, error, read, stop };
}
