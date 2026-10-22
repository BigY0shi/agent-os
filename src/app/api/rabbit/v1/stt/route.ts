// Rabbit R1 Creation — POST /api/rabbit/v1/stt  multipart { audio }  → { ok, text }
// The Creation records the PTT hold with the WebView's MediaRecorder and sends
// it here; transcription is the same local Parakeet server /api/stt/transcribe
// uses (loopback only, never stored). Key REQUIRED regardless of requireKey.
import { NextResponse } from "next/server";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import { parakeetTranscribe } from "@/lib/parakeet";
import { rabbitLog } from "@/lib/v2/rabbit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = rabbitAuthFailure(req, true);
  if (denied) return denied;
  let fd: FormData;
  try { fd = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "expected multipart form data with an `audio` file" }, { status: 400 }); }
  const audio = fd.get("audio");
  if (!(audio instanceof Blob) || !audio.size) {
    return NextResponse.json({ ok: false, error: "missing or empty `audio` file" }, { status: 400 });
  }
  const filename = audio instanceof File && audio.name ? audio.name : "recording.webm";
  const t0 = Date.now();
  try {
    const out = await parakeetTranscribe(audio, { filename });
    rabbitLog(`stt 200 ${audio.size}B → ${out.text.length}ch ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, text: out.text, durationSec: out.durationSec }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    rabbitLog(`stt 502 ${msg.slice(0, 120)}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
