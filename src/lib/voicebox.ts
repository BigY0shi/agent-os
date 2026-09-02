// Voicebox — the local AI vocal studio (github.com/jamiepine/voicebox) that is
// now the voice engine for anything in Agent OS that speaks or listens.
//
// One client, server-side only. Text goes OUT to Voicebox and audio comes BACK;
// nothing here ever reaches a hosted provider. The base URL is a setting
// (rule 16: in the Jarvis gear), but it is asserted loopback in code so a typo
// or a pasted remote URL cannot silently ship the owner's dictation off-box.
// If Voicebox is down, every function here throws a plain error with the
// reason; nothing falls back to Kokoro/ElevenLabs/OpenAI on its own
// (AGENTS.md "Fail loudly").
//
// Verified against the live server 2026-09-02 (curl, this box):
//   GET  /health                  { status, model_loaded, gpu_available, ... }
//   GET  /profiles                [{ id, name, description, language, default_engine, ... }]
//   POST /generate                { profile_id, text, language?, engine? }
//                                 -> { id, status: "generating" | "loading_model" | ... }
//                                 Asynchronous. 129 ms to return, then work.
//   GET  /generate/{id}/status    text/event-stream; "data: {status, error, ...}"
//                                 lines until a terminal state. A plain GET
//                                 never returns, which is why this client reads
//                                 the stream instead of polling.
//   GET  /audio/{id}              the finished audio (500 until it is finished)
//   POST /transcribe              multipart { file, model?, language? }
//                                 -> { text, duration }
// Terminal status names were NOT observed live (the CPU backend was still in
// loading_model after four minutes), so the client treats any status outside
// the known in-flight set as terminal and then lets /audio decide.

import { readSettings } from "@/lib/settings";

export const VOICEBOX_CLIENT_ID = "agent-os";
export const VOICEBOX_DEFAULT_URL = "http://127.0.0.1:17493";

/** Statuses that mean "still working". Anything else ends the wait. */
const IN_FLIGHT = new Set(["queued", "pending", "loading_model", "generating", "processing", "running"]);
const FAILED = /fail|error|cancel/i;

export interface VoiceboxProfile {
  id: string;
  name: string;
  description: string | null;
  language: string;
  engine: string | null;
  voiceType: string | null;
}

export interface VoiceboxHealth {
  ok: boolean;
  status: string;
  modelLoaded: boolean;
  gpu: boolean;
  backend: string | null;
}

export interface VoiceboxSpeech {
  /** data:audio/...;base64,... — the type comes from Voicebox's own header. */
  audio: string;
  mime: string;
  generationId: string;
  durationSec: number | null;
}

function loopback(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/**
 * The base URL, validated. Throws rather than returning a remote host: the
 * owner's dictation and every reply Jarvis speaks pass through here.
 */
export function voiceboxBase(): string {
  const raw = (readSettings().voicebox?.url ?? "").trim() || VOICEBOX_DEFAULT_URL;
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Voicebox URL is not a URL: ${raw}`); }
  if (!loopback(u)) throw new Error(`Voicebox URL must be loopback (127.0.0.1 / localhost), got ${u.hostname}`);
  return u.origin;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "X-Voicebox-Client-Id": VOICEBOX_CLIENT_ID, ...extra };
}

async function vbFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const base = voiceboxBase();
  const { timeoutMs = 10_000, ...rest } = init;
  let r: Response;
  try {
    r = await fetch(`${base}${path}`, { ...rest, headers: headers((rest.headers as Record<string, string>) ?? {}), signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(`Voicebox unreachable at ${base} (${(e as Error)?.message ?? e}). Is the studio running?`);
  }
  return r;
}

export async function voiceboxHealth(): Promise<VoiceboxHealth> {
  const r = await vbFetch("/health", { timeoutMs: 4_000 });
  if (!r.ok) throw new Error(`Voicebox /health ${r.status}`);
  const j = (await r.json()) as { status?: string; model_loaded?: boolean; gpu_available?: boolean; backend_type?: string | null; backend_variant?: string | null };
  return {
    ok: j.status === "healthy",
    status: j.status ?? "unknown",
    modelLoaded: !!j.model_loaded,
    gpu: !!j.gpu_available,
    backend: j.backend_type ? `${j.backend_type}${j.backend_variant ? "/" + j.backend_variant : ""}` : null,
  };
}

export async function listVoiceboxProfiles(): Promise<VoiceboxProfile[]> {
  const r = await vbFetch("/profiles", { timeoutMs: 6_000 });
  if (!r.ok) throw new Error(`Voicebox /profiles ${r.status}`);
  const arr = (await r.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(arr)) throw new Error("Voicebox /profiles did not return a list");
  return arr.map((p) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    description: typeof p.description === "string" ? p.description : null,
    language: typeof p.language === "string" ? p.language : "en",
    engine: typeof p.default_engine === "string" ? p.default_engine : null,
    voiceType: typeof p.voice_type === "string" ? p.voice_type : null,
  })).filter((p) => p.id);
}

/**
 * Resolve a profile from an id, a name, or nothing (settings default, then the
 * first profile). Throws with the list of names when nothing matches, so the
 * error tells the user what they could have typed.
 */
export async function resolveVoiceboxProfile(ref?: string | null): Promise<VoiceboxProfile> {
  const want = (ref ?? "").trim() || (readSettings().voicebox?.profile ?? "").trim();
  const profiles = await listVoiceboxProfiles();
  if (!profiles.length) throw new Error("Voicebox has no voice profiles yet. Clone or design one in the studio first.");
  if (!want) return profiles[0];
  const hit = profiles.find((p) => p.id === want) ?? profiles.find((p) => p.name.toLowerCase() === want.toLowerCase());
  if (!hit) throw new Error(`Voicebox profile "${want}" not found. Available: ${profiles.map((p) => p.name).join(", ")}`);
  return hit;
}

interface StatusEvent { status?: string; error?: string | null; duration?: number | null }

/** Read the SSE status stream until a terminal event, an error, or the deadline. */
async function followStatus(id: string, deadline: number): Promise<StatusEvent> {
  const remaining = Math.max(1_000, deadline - Date.now());
  // An explicit controller + a referenced timer, not AbortSignal.timeout: Node
  // unrefs that timer, so a process with nothing else pending (a smoke, a CLI)
  // exits before the deadline ever fires.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), remaining);
  let r: Response;
  try {
    r = await vbFetch(`/generate/${encodeURIComponent(id)}/status`, { signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  if (!r.ok || !r.body) { clearTimeout(timer); throw new Error(`Voicebox status stream ${r.status}`); }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let last: StatusEvent = {};
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        try { last = JSON.parse(line.slice(5).trim()) as StatusEvent; } catch { continue; }
        const st = String(last.status ?? "");
        if (last.error) return last;
        if (st && !IN_FLIGHT.has(st)) return last;
      }
      if (Date.now() > deadline) return last;
    }
  } catch (e) {
    // AbortSignal.timeout fires here — the deadline is reported by the caller
    // with the last status seen, which is the useful part of the message.
    if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") return last;
    throw e;
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* closed */ }
  }
  return last;
}

/**
 * Speak `text` in a profile's voice. Resolves when the audio exists, or throws
 * with what Voicebox was doing when time ran out ("still loading_model after
 * 120s") so a slow CPU box reads as slow, not as broken.
 */
export async function voiceboxSynthesize(text: string, opts: { profile?: string | null; engine?: string | null; language?: string | null; timeoutMs?: number } = {}): Promise<VoiceboxSpeech> {
  const clean = text.trim();
  if (!clean) throw new Error("nothing to say");
  const settings = readSettings().voicebox ?? {};
  const timeoutMs = opts.timeoutMs ?? settings.timeoutMs ?? 120_000;
  const profile = await resolveVoiceboxProfile(opts.profile);
  const engine = (opts.engine ?? settings.engine ?? "").trim() || profile.engine || undefined;
  const body: Record<string, unknown> = { profile_id: profile.id, text: clean.slice(0, 5_000), language: opts.language ?? profile.language ?? "en" };
  if (engine) body.engine = engine;

  const start = Date.now();
  const deadline = start + timeoutMs;
  const r = await vbFetch("/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 15_000 });
  const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; error?: string | null; detail?: unknown };
  if (!r.ok || !j.id) throw new Error(`Voicebox /generate ${r.status}: ${j.error ?? JSON.stringify(j.detail ?? j).slice(0, 200)}`);

  let last: StatusEvent = { status: j.status ?? "generating" };
  if (IN_FLIGHT.has(String(last.status))) last = await followStatus(j.id, deadline);
  if (last.error) throw new Error(`Voicebox generation failed: ${last.error}`);
  if (FAILED.test(String(last.status ?? ""))) throw new Error(`Voicebox generation ${last.status}`);

  const a = await vbFetch(`/audio/${encodeURIComponent(j.id)}`, { timeoutMs: Math.max(5_000, deadline - Date.now()) });
  if (!a.ok) {
    const st = String(last.status ?? "unknown");
    const secs = Math.round((Date.now() - start) / 1000);
    throw new Error(IN_FLIGHT.has(st)
      ? `Voicebox still ${st} after ${secs}s (profile "${profile.name}"). The studio is working; raise the timeout or wait for the model to load.`
      : `Voicebox /audio ${a.status} after status "${st}"`);
  }
  const mime = (a.headers.get("content-type") || "audio/wav").split(";")[0].trim();
  const buf = Buffer.from(await a.arrayBuffer());
  if (!buf.length) throw new Error("Voicebox returned empty audio");
  return { audio: `data:${mime};base64,${buf.toString("base64")}`, mime, generationId: j.id, durationSec: typeof last.duration === "number" && last.duration > 0 ? last.duration : null };
}

/** Speech-to-text through Voicebox's Whisper. `file` is whatever the browser recorded. */
export async function voiceboxTranscribe(file: Blob, opts: { model?: string; language?: string; filename?: string } = {}): Promise<{ text: string; durationSec: number | null }> {
  if (!file.size) throw new Error("empty recording");
  const fd = new FormData();
  fd.append("file", file, opts.filename ?? "recording.webm");
  if (opts.model) fd.append("model", opts.model);
  if (opts.language) fd.append("language", opts.language);
  const r = await vbFetch("/transcribe", { method: "POST", body: fd, timeoutMs: 120_000 });
  const j = (await r.json().catch(() => ({}))) as { text?: string; duration?: number; detail?: unknown };
  if (!r.ok) throw new Error(`Voicebox /transcribe ${r.status}: ${JSON.stringify(j.detail ?? j).slice(0, 200)}`);
  return { text: String(j.text ?? "").trim(), durationSec: typeof j.duration === "number" ? j.duration : null };
}
