import { NextResponse } from "next/server";
import { listVoiceboxProfiles, voiceboxHealth } from "@/lib/voicebox";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/voicebox/profiles — the studio's voice profiles for the pickers
// (Jarvis gear, Jarvis reply-voice select, later the Oracle and Video).
// Returns { ok, profiles, defaultProfileId, health } or { ok:false, error }
// with a 502 when the studio is not answering. No fallback list: an empty
// picker with the reason beside it is honest, an invented one is not.
export async function GET() {
  try {
    const [profiles, health] = await Promise.all([listVoiceboxProfiles(), voiceboxHealth().catch(() => null)]);
    const want = (readSettings().voicebox?.profile ?? "").trim();
    const def = profiles.find((p) => p.id === want || p.name.toLowerCase() === want.toLowerCase()) ?? profiles[0] ?? null;
    return NextResponse.json({ ok: true, profiles, defaultProfileId: def?.id ?? null, health }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e), profiles: [] }, { status: 502 });
  }
}
