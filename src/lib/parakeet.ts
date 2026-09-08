// Parakeet: the local speech-to-text server (NVIDIA Parakeet-TDT 0.6B v2 on ONNX
// Runtime) at 127.0.0.1:8881, started by parakeet-start.ps1 from the launchers.
// Replaces the Voicebox/Whisper transcribe lane (owner, 2026-09-08: "switch off
// Voicebox ... Parakeet TDT ... and call it a day").
//
// If the server is down, transcribe throws with the reason; nothing falls back
// to another recogniser on its own (AGENTS.md "Fail loudly").
//
// Server contract (~/.agentic-os/parakeet-stt/server.py):
//   GET  /health      -> { ok, model, quantization, provider, loaded }
//   POST /transcribe  multipart { file } -> { ok, text, duration, seconds } | { ok:false, error }

import { readSettings } from "@/lib/settings";

const DEFAULT_URL = "http://127.0.0.1:8881";

/** Loopback only: a recording never leaves this machine through this door. */
export function parakeetBase(): string {
  const raw = (readSettings().stt?.parakeetUrl ?? "").trim() || DEFAULT_URL;
  const u = new URL(raw);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)) {
    throw new Error(`Parakeet URL must be loopback (got ${u.hostname}); dictation audio stays on this machine`);
  }
  return u.origin;
}

export interface ParakeetHealth { ok: boolean; model: string; loaded: boolean; provider: string; quantization: string | null }

export async function parakeetHealth(): Promise<ParakeetHealth> {
  const r = await fetch(`${parakeetBase()}/health`, { signal: AbortSignal.timeout(4_000) });
  if (!r.ok) throw new Error(`Parakeet /health ${r.status}`);
  const j = (await r.json()) as Partial<ParakeetHealth>;
  return { ok: j.ok === true, model: String(j.model ?? ""), loaded: j.loaded === true, provider: String(j.provider ?? ""), quantization: j.quantization ?? null };
}

export async function parakeetTranscribe(file: Blob, opts: { filename?: string; timeoutMs?: number } = {}): Promise<{ text: string; durationSec: number | null }> {
  if (!file.size) throw new Error("empty recording");
  const fd = new FormData();
  fd.append("file", file, opts.filename ?? "recording.webm");
  // First request after a start loads the model (seconds); allow for it.
  const r = await fetch(`${parakeetBase()}/transcribe`, { method: "POST", body: fd, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) })
    .catch((e) => { throw new Error(`Parakeet STT is not answering on ${parakeetBase()} (${(e as Error)?.message ?? e}); start it with parakeet-start.ps1`); });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; duration?: number; error?: string; detail?: unknown };
  if (!r.ok || j.ok === false) throw new Error(`Parakeet /transcribe ${r.status}: ${j.error ?? JSON.stringify(j.detail ?? j).slice(0, 200)}`);
  return { text: String(j.text ?? "").trim(), durationSec: typeof j.duration === "number" ? j.duration : null };
}
