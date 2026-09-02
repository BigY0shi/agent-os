import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { minimaxToken } from "@/lib/hermesStudio";
import { readHermesEnv } from "@/lib/hermesPhone";
import { readSettings, JARVIS_TTS_VOICE_ID } from "@/lib/settings";
import { voiceboxSynthesize } from "@/lib/voicebox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/tts  { text, voiceId?, provider? }  → { audio: dataURI } | { error }
// Speaks arbitrary text. provider:
//   "voicebox"                    — the local Voicebox studio (lib/voicebox.ts), cloned
//                                   profiles; voiceId is a profile id or name. The voice
//                                   engine since 2026-09-02. Never falls back.
//   "local"                       — Kokoro-82M on this machine (~/.agentic-os/kokoro-tts,
//                                   port 8880, British bm_george). Free, offline, GPU-fast.
//   "auto"                        — local first, then ElevenLabs, then OpenAI — the first
//                                   backend that actually produces audio wins.
//   "openai" (default for Jarvis) — gpt-4o-mini-tts, steered to a refined English butler.
//   "elevenlabs"                  — Flash v2.5.
//   "minimax"                     — speech-02-turbo (legacy fallback).
// Keys read SERVER-SIDE — never from the client, never logged.

// OpenAI key — same one the image-gen (gpt-image-2) uses, then Hermes profile, then env.
function openaiKey(): string | null {
  for (const f of [path.join(os.homedir(), ".claude", "skills", "youtube-thumbnails", ".env")]) {
    try { const m = readFileSync(f, "utf8").match(/^OPENAI_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); } catch { /* next */ }
  }
  try { const k = readHermesEnv().OPENAI_API_KEY; if (k && k.trim()) return k.trim(); } catch { /* ignore */ }
  return process.env.OPENAI_API_KEY?.trim() || null;
}

const BUTLER_INSTRUCTIONS =
  "Speak as JARVIS — a refined, composed English butler. Crisp Received Pronunciation (BBC English), " +
  "calm and unflappable, warm but precise, with a touch of dry wit. Measured, natural pace; never rushed, never robotic.";

// OpenAI TTS — gpt-4o-mini-tts lets us steer accent + character via `instructions`.
async function openaiTts(text: string, voiceId: string): Promise<NextResponse> {
  const key = openaiKey();
  if (!key) return NextResponse.json({ error: "OpenAI key not found — add OPENAI_API_KEY to ~/.claude/skills/youtube-thumbnails/.env" }, { status: 400 });
  // Steerable voices that suit a male butler: ash (default), onyx, ballad, echo.
  const voice = /^(alloy|ash|ballad|coral|echo|fable|onyx|nova|sage|shimmer|verse)$/.test(voiceId) ? voiceId : "ash";
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text.slice(0, 2000), instructions: BUTLER_INSTRUCTIONS, response_format: "mp3" }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return NextResponse.json({ error: `OpenAI TTS ${r.status}`, detail: detail.slice(0, 200) }, { status: 502 });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return NextResponse.json({ audio: `data:audio/mp3;base64,${buf.toString("base64")}` });
}

function elevenKey(): string | null {
  try {
    const fromProfile = readHermesEnv().ELEVENLABS_API_KEY;
    if (fromProfile && fromProfile.trim()) return fromProfile.trim();
  } catch { /* ignore */ }
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

async function elevenTts(text: string, voiceId: string): Promise<NextResponse> {
  const key = elevenKey();
  if (!key) {
    return NextResponse.json(
      { error: "ElevenLabs not connected — add ELEVENLABS_API_KEY to ~/.hermes/profiles/<active>/.env" },
      { status: 400 },
    );
  }
  // Caller wins; then the user's configured voice; then Jarvis's named default.
  // The old fallback was a hardcoded Daniel id, so any request that omitted a
  // voice silently spoke in the wrong one.
  const configured = readSettings().jarvis?.voice?.ttsVoiceId ?? "";
  const vid = /^[A-Za-z0-9]{16,}$/.test(voiceId)
    ? voiceId
    : /^[A-Za-z0-9]{16,}$/.test(configured)
      ? configured
      : JARVIS_TTS_VOICE_ID;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128&optimize_streaming_latency=3`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: "eleven_flash_v2_5",                 // lowest-latency model
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return NextResponse.json({ error: `ElevenLabs ${r.status}`, detail: detail.slice(0, 200) }, { status: 502 });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return NextResponse.json({ audio: `data:audio/mp3;base64,${buf.toString("base64")}` });
}

async function minimaxTts(text: string, voiceId: string): Promise<NextResponse> {
  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected (run `hermes auth add minimax-oauth`)." }, { status: 400 });
  const vid = /^[a-z0-9_-]+$/i.test(voiceId) ? voiceId : "male-qn-qingse";
  const tr = await fetch("https://api.minimax.io/v1/t2a_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "speech-02-turbo", text: text.slice(0, 4000), stream: false,
      voice_setting: { voice_id: vid, speed: 1.05, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 },
    }),
  });
  const tj = await tr.json();
  const hex = tj?.data?.audio;
  if (!hex) return NextResponse.json({ error: "no audio", detail: tj?.base_resp ?? tj }, { status: 502 });
  return NextResponse.json({ audio: `data:audio/mp3;base64,${Buffer.from(hex, "hex").toString("base64")}` });
}

// Local Kokoro server (see ~/.agentic-os/kokoro-tts). Only kokoro-style voice
// names (bm_george, af_bella, …) are forwarded; an ElevenLabs id falls back to
// the server's default butler voice.
const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8880";

async function localTts(text: string, voiceId: string): Promise<NextResponse> {
  const voice = /^[ab][fm]_[a-z]+$/.test(voiceId) ? voiceId : undefined;
  const r = await fetch(`${LOCAL_TTS_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 1200), ...(voice ? { voice } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.audio) {
    return NextResponse.json({ error: `local TTS ${r.status}`, detail: j?.error }, { status: 502 });
  }
  return NextResponse.json({ audio: j.audio });
}

// Voicebox: voiceId is a profile id or name; blank = settings.voicebox.profile,
// then the studio's first profile. A down or slow studio is reported as such.
async function voiceboxTts(text: string, profileRef: string): Promise<NextResponse> {
  try {
    const out = await voiceboxSynthesize(text, { profile: profileRef || null });
    return NextResponse.json({ audio: out.audio, provider: "voicebox", generationId: out.generationId, durationSec: out.durationSec });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e), provider: "voicebox" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { text, voiceId, provider } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }
  try {
    const v = typeof voiceId === "string" ? voiceId : "";
    if (provider === "voicebox") return await voiceboxTts(text, v);
    if (provider === "local") return await localTts(text, v);
    if (provider === "auto") {
      // First backend that actually yields audio wins: free local Kokoro, then
      // ElevenLabs (keyed on this box), then OpenAI. Errors cascade silently —
      // the caller only cares that SOMETHING speaks.
      for (const fn of [localTts, elevenTts, openaiTts]) {
        const res = await fn(text, v);
        if (res.ok) return res;
      }
      return NextResponse.json({ error: "no TTS backend produced audio (local server down, no ElevenLabs/OpenAI key?)" }, { status: 502 });
    }
    if (provider === "minimax") return await minimaxTts(text, v);
    if (provider === "elevenlabs") return await elevenTts(text, v || "onwK4e9ZLuTAKqWW03F9");
    return await openaiTts(text, v);   // default — OpenAI English butler
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
