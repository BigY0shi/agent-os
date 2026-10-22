"use client";

// The one network call the recorder capture lanes make: a finished recording
// goes to the local transcriber for the selected provider and text comes back.
// It lives outside useVoiceCapture on purpose: that hook is CAPTURE ONLY and its
// smoke asserts it performs no sends. Transcription is still capture - the text
// is handed to the caller as a final chunk and is never dispatched to the brain
// from here.
//
// Providers (settings.jarvis.voice.provider):
//   parakeet -> /api/stt/transcribe       (Parakeet-TDT on ONNX Runtime, 8881; the default)
//   voicebox -> /api/voicebox/transcribe  (Voicebox studio's Whisper; kept, no longer default)
// No provider falls back to the other: the reply names the door that failed.

export const RECORDER_PROVIDERS = ["parakeet", "voicebox"] as const;
export type RecorderProviderId = (typeof RECORDER_PROVIDERS)[number];

export function transcribeEndpoint(provider: string): string {
  if (provider === "voicebox") return "/api/voicebox/transcribe";
  if (provider === "parakeet") return "/api/stt/transcribe";
  throw new Error(`No local transcriber for voice provider "${provider}"`);
}

export async function transcribeRecording(blob: Blob, provider: string = "parakeet"): Promise<string> {
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
  const fd = new FormData();
  fd.append("audio", blob, `recording.${ext}`);
  const r = await fetch(transcribeEndpoint(provider), { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
  if (!r.ok || !j.ok) throw new Error(j.error || `transcribe ${r.status}`);
  return (j.text ?? "").trim();
}
