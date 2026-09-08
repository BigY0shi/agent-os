"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** The route's own fallback label (rule 20): who actually spoke, and why it was not the chosen voice. */
export interface SpokeVia { provider: string; fellBackFrom: string; reason: string }

/** Ordered speech through the user's selected server-side TTS configuration. */
export function useReadAloud(provider: string) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [spokeVia, setSpokeVia] = useState<SpokeVia | null>(null);
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
    stop(); setError(""); setSpokeVia(null);
    const current = generation.current;
    const controller = new AbortController(); abort.current = controller;
    setSpeaking(true);
    try {
      // TTS route has bounded input; split without dropping any listing text.
      const chunks = text.match(/[\s\S]{1,500}(?:\s|$)|[\s\S]{1,500}/g) ?? [];
      // The route decides the fallback and labels it. Once it has told us the
      // chosen voice failed for this reply, the remaining chunks go straight to
      // the voice it picked, instead of paying the failing provider's stall on
      // every chunk (Voicebox: ~8 s of loading_model before the error, per chunk).
      let speakWith = provider;
      for (const chunk of chunks) {
        if (generation.current !== current) break;
        const response = await fetch("/api/hermes/tts", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: chunk, provider: speakWith }) });
        const result = await response.json();
        if (!response.ok || !result.audio) throw new Error(result.error || "Speech provider returned no audio");
        if (typeof result.fellBackFrom === "string" && typeof result.provider === "string") {
          speakWith = result.provider;
          setSpokeVia({ provider: result.provider, fellBackFrom: result.fellBackFrom, reason: String(result.fallbackReason ?? "") });
        }
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
  return { speaking, error, spokeVia, read, stop };
}
