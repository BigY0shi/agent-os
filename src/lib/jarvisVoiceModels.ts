// The model ids behind Jarvis's hosted voice lanes, as settings (S30 settings sweep; owner
// 2026-09-30: "every parameter needs to be in the settings for every module").
//
// They were literals in three routes: the Gemini Live session (`GEMINI_LIVE_MODEL` env or
// gemini-live-2.5-flash-preview), the OpenAI Realtime session (gpt-realtime, with
// gpt-4o-mini-transcribe for the user's side) and the OpenAI reply voice (gpt-4o-mini-tts).
// Now settings.jarvis.voice.* from the Jarvis models gear, read per request. A blank field is
// the lane's old default; Gemini keeps honouring GEMINI_LIVE_MODEL before that default, as it
// did, so an install that set it is unchanged.

import { readSettings } from "./settings";

export const JARVIS_VOICE_MODEL_DEFAULTS = {
  geminiLiveModel: "gemini-live-2.5-flash-preview",
  openaiRealtimeModel: "gpt-realtime",
  openaiTranscribeModel: "gpt-4o-mini-transcribe",
  openaiTtsModel: "gpt-4o-mini-tts",
} as const;
type Key = keyof typeof JARVIS_VOICE_MODEL_DEFAULTS;

function pick(key: Key, envName?: string): string {
  const voice = (readSettings().jarvis?.voice ?? {}) as Partial<Record<Key, unknown>>;
  const v = voice[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  const e = envName ? process.env[envName]?.trim() : "";
  return e || JARVIS_VOICE_MODEL_DEFAULTS[key];
}

/** Gemini Live lane: settings, else GEMINI_LIVE_MODEL, else gemini-live-2.5-flash-preview. */
export const geminiLiveModel = (): string => pick("geminiLiveModel", "GEMINI_LIVE_MODEL");
/** OpenAI Realtime speech-to-speech model: settings, else gpt-realtime. */
export const openaiRealtimeModel = (): string => pick("openaiRealtimeModel");
/** Transcription of the user's side of a Realtime session: settings, else gpt-4o-mini-transcribe. */
export const openaiTranscribeModel = (): string => pick("openaiTranscribeModel");
/** The OpenAI reply voice model: settings, else gpt-4o-mini-tts. */
export const openaiTtsModel = (): string => pick("openaiTtsModel");
