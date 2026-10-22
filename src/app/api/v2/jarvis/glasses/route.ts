import { NextResponse } from "next/server";
import {
  glassesSettings,
  glassesStatus,
  glassesTokenConfigured,
  revokeGlassesToken,
  rotateGlassesToken,
} from "@/lib/v2/jarvis/glasses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Settings-panel side of the G2 glasses lane (cookie-gated by the normal proxy
// check; NOT covered by the /api/glasses exemption).
//   GET    → { configured, enabled, lastRequestAt, lastError, path } — no key material
//   POST   { action: "rotate" } → { token } — the only time the plaintext exists
//   DELETE → revoke the token (the lane answers 503 until a new one is minted)

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(
    {
      configured: glassesTokenConfigured(),
      enabled: glassesSettings().enabled,
      ...glassesStatus(),
      path: "/api/glasses/v1",
    },
    { headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* handled below */
  }
  if (body.action !== "rotate") {
    return NextResponse.json({ error: 'Expected { "action": "rotate" }.' }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json({ token: rotateGlassesToken() }, { headers: NO_STORE });
}

export async function DELETE() {
  revokeGlassesToken();
  return NextResponse.json({ ok: true, configured: false }, { headers: NO_STORE });
}
