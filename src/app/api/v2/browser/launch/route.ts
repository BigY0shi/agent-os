import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getOrLaunchSession, getSessionCdpInfo } from "@/lib/v2/browser/manager";
import { isBrowserCapabilityEnabled } from "@/lib/v2/browser/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-E §5.1 — POST /api/v2/browser/launch { session } → idempotent
 *  always-headless launch (mirrors AOC POST /api/browser/launch). The headed
 *  relaunch lives on the /handoff route (E2).
 *
 *  Chunk-2 decision (settles chunk-1 delta 3): gated behind the browser
 *  capability slot like /tool — one toggle governs everything that starts or
 *  drives Chromium (tool dispatch, launch, handoff). The /browser page shows
 *  the disabled state with an enable hint instead of a dead button. */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { session?: unknown } | null;
  const session = typeof body?.session === "string" ? body.session.trim() : "";
  if (!session) return NextResponse.json({ error: "session is required" }, { status: 400, ...noStore });

  if (!isBrowserCapabilityEnabled()) {
    return NextResponse.json(
      {
        error:
          "The browser capability is disabled. Enable it in Browser settings (settings.capability.browserEnabled).",
        code: "CAPABILITY_DISABLED",
      },
      { status: 403, ...noStore },
    );
  }

  const { session: live, error } = await getOrLaunchSession(session, false, { caller: "user" });
  if (error || !live) {
    return NextResponse.json({ error: error ?? "launch failed" }, { status: 400, ...noStore });
  }
  return NextResponse.json(
    {
      ok: true,
      session: {
        name: live.sessionName,
        profile: live.profile,
        cdpReady: Boolean(getSessionCdpInfo(session)),
      },
    },
    noStore,
  );
}
