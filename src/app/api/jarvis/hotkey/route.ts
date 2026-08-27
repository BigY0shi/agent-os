import { NextResponse } from "next/server";
import { fireHotkey, hotkeySubscriberCount, hotkeyLastFireAt } from "@/lib/v2/jarvis/hotkeyBus";
import { readHotkeySecret, verifyHotkeySecret } from "@/lib/v2/jarvis/hotkeySecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPEC-C C2 (C1.1) — the OS-global hotkey endpoint.
//
//   POST (from the AutoHotkey helper; proxy-exempt when the secret header is
//        present — src/proxy.ts — and the ROUTE validates strictly here):
//        headers: x-agentos-hotkey-secret: <hex>
//        body:    { key?: string }
//        → 200 { ok, subscribers }  — subscribers = live /hotkey/stream count,
//          so the helper knows whether to open a browser tab (0 = nobody
//          listening). 401 on bad/missing secret. 503 when no secret is
//          configured yet (run GET /api/jarvis/hotkey/setup first).
//   GET  (cookie-authed via the normal proxy gate) → status for the settings
//        panel: { configured, lastFireAt, subscribers }.

export async function GET() {
  return NextResponse.json(
    {
      configured: !!readHotkeySecret(),
      lastFireAt: hotkeyLastFireAt(),
      subscribers: hotkeySubscriberCount(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  if (!readHotkeySecret()) {
    return NextResponse.json(
      { error: "Hotkey secret not configured — open Agent OS and GET /api/jarvis/hotkey/setup first." },
      { status: 503 },
    );
  }
  const presented = req.headers.get("x-agentos-hotkey-secret");
  if (!verifyHotkeySecret(presented)) {
    return NextResponse.json({ error: "Unauthorized — bad or missing x-agentos-hotkey-secret." }, { status: 401 });
  }

  let key: string | undefined;
  try {
    const body = (await req.json()) as { key?: unknown };
    if (typeof body?.key === "string") key = body.key.slice(0, 32);
  } catch {
    /* empty body is fine — the press itself is the payload */
  }

  fireHotkey(key);
  return NextResponse.json(
    { ok: true, subscribers: hotkeySubscriberCount() },
    { headers: { "cache-control": "no-store" } },
  );
}
