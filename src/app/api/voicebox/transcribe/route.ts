import { NextResponse } from "next/server";
import { voiceboxTranscribe } from "@/lib/voicebox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/voicebox/transcribe  multipart { audio: Blob, model?, language? }
//   -> { ok, text, durationSec } | { ok:false, error }
// Speech-to-text through the local Voicebox studio (Whisper). This is the mic
// path that does not depend on the browser's Web Speech API, which Opera ships
// disabled. The recording is forwarded to loopback only (asserted in
// lib/voicebox.ts) and never stored here.
export async function POST(req: Request) {
  let fd: FormData;
  try { fd = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "expected multipart form data with an `audio` file" }, { status: 400 }); }
  const audio = fd.get("audio");
  if (!(audio instanceof Blob) || !audio.size) {
    return NextResponse.json({ ok: false, error: "missing or empty `audio` file" }, { status: 400 });
  }
  const model = typeof fd.get("model") === "string" ? String(fd.get("model")) : undefined;
  const language = typeof fd.get("language") === "string" ? String(fd.get("language")) : undefined;
  const filename = audio instanceof File && audio.name ? audio.name : "recording.webm";
  try {
    const out = await voiceboxTranscribe(audio, { model, language, filename });
    return NextResponse.json({ ok: true, text: out.text, durationSec: out.durationSec });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
