import { NextResponse } from "next/server";
import { hotkeyConfig } from "@/lib/v2/jarvis/hotkeyConfig";
import { readHotkeySecret, verifyHotkeySecret } from "@/lib/v2/jarvis/hotkeySecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// S38 — what the AutoHotkey helper needs to know, read from the Jarvis gear
// (settings.jarvis.hotkey) so the gear is the one place to change the key.
//
//   GET  headers: x-agentos-hotkey-secret: <hex>   (proxy-exempt with the
//        header — src/proxy.ts — and validated strictly here, like the POST)
//        → 200 { key, mode }   mode: "hold" (push-to-talk) | "open" (press opens)
//        401 on a bad/missing secret, 503 before the secret exists.
//
// Nothing else is returned: no secret, no other settings, no booleans the
// helper does not act on. sendOnRelease is the PAGE's decision, not the helper's.

export async function GET(req: Request) {
  if (!readHotkeySecret()) {
    return NextResponse.json(
      { error: "Hotkey secret not configured — open Agent OS and GET /api/jarvis/hotkey/setup first." },
      { status: 503 },
    );
  }
  if (!verifyHotkeySecret(req.headers.get("x-agentos-hotkey-secret"))) {
    return NextResponse.json({ error: "Unauthorized — bad or missing x-agentos-hotkey-secret." }, { status: 401 });
  }
  return NextResponse.json(hotkeyConfig(), { headers: { "cache-control": "no-store" } });
}
