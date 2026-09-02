"use client";

// The one network call the Voicebox capture lane makes: a finished recording
// goes to /api/voicebox/transcribe (local Whisper in the studio) and text comes
// back. It lives outside useVoiceCapture on purpose: that hook is CAPTURE ONLY
// and its smoke asserts it performs no sends. Transcription is still capture -
// the text is handed to the caller as a final chunk and is never dispatched to
// the brain from here.

export async function transcribeRecording(blob: Blob): Promise<string> {
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
  const fd = new FormData();
  fd.append("audio", blob, `recording.${ext}`);
  const r = await fetch("/api/voicebox/transcribe", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
  if (!r.ok || !j.ok) throw new Error(j.error || `transcribe ${r.status}`);
  return (j.text ?? "").trim();
}
