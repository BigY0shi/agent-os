import { NextResponse } from "next/server";
import { parakeetTranscribe } from "@/lib/parakeet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/stt/transcribe  multipart { audio: Blob }
//   -> { ok, text, durationSec, provider: "parakeet" } | { ok:false, error }
// Speech-to-text through the local Parakeet server (NVIDIA Parakeet-TDT 0.6B v2
// on ONNX Runtime, 127.0.0.1:8881). This is the mic path that does not depend on
// the browser's Web Speech API (Opera ships it disabled) and does not depend on
// Voicebox. The recording is forwarded to loopback only (asserted in
// lib/parakeet.ts) and never stored here.
export async function POST(req: Request) {
  let fd: FormData;
  try { fd = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "expected multipart form data with an `audio` file" }, { status: 400 }); }
  const audio = fd.get("audio");
  if (!(audio instanceof Blob) || !audio.size) {
    return NextResponse.json({ ok: false, error: "missing or empty `audio` file" }, { status: 400 });
  }
  const filename = audio instanceof File && audio.name ? audio.name : "recording.webm";
  try {
    const out = await parakeetTranscribe(audio, { filename });
    return NextResponse.json({ ok: true, text: out.text, durationSec: out.durationSec, provider: "parakeet" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e), provider: "parakeet" }, { status: 502 });
  }
}
