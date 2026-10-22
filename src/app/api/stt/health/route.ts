import { NextResponse } from "next/server";
import { parakeetHealth } from "@/lib/parakeet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stt/health -> { ok, model, loaded, provider, quantization } | { ok:false, error }
// Non-secret status of the local Parakeet server for the Jarvis gear.
export async function GET() {
  try {
    return NextResponse.json(await parakeetHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
