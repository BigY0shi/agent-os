// Rabbit R1 Creation — POST /api/rabbit/v1/tts  { text, voice? }  → { ok, audio: dataURI }
// Speaks a reply through the local Kokoro server (~/.agentic-os/kokoro-tts,
// port 8880) — the same backend /api/hermes/tts uses for provider "local".
// Free, offline, no key leaves the box. Key REQUIRED regardless of requireKey.
import { NextResponse } from "next/server";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import { rabbitLog } from "@/lib/v2/rabbit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8880";

export async function POST(req: Request) {
  const denied = rabbitAuthFailure(req, true);
  if (denied) return denied;
  let body: { text?: unknown; voice?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* fallthrough */ }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, error: "`text` is required" }, { status: 400 });
  const voice = typeof body.voice === "string" && /^[ab][fm]_[a-z]+$/.test(body.voice) ? body.voice : undefined;
  const t0 = Date.now();
  try {
    const r = await fetch(`${LOCAL_TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1200), ...(voice ? { voice } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { audio?: string; error?: string };
    if (!r.ok || !j.audio) {
      rabbitLog(`tts 502 kokoro ${r.status} ${String(j.error ?? "").slice(0, 80)}`);
      return NextResponse.json({ ok: false, error: `Kokoro TTS ${r.status}${j.error ? `: ${j.error}` : ""} — start it with kokoro-start.ps1` }, { status: 502 });
    }
    rabbitLog(`tts 200 ${text.length}ch ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, audio: j.audio }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    rabbitLog(`tts 502 ${msg.slice(0, 120)}`);
    return NextResponse.json({ ok: false, error: `Kokoro TTS is not answering on ${LOCAL_TTS_URL} (${msg})` }, { status: 502 });
  }
}
