import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { launchSession, getSessionCdpInfo } from "@/lib/v2/browser/manager";
import { isBrowserCapabilityEnabled } from "@/lib/v2/browser/tools";
import { recordToolCall } from "@/lib/v2/browser/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-E §5.1 — POST /api/v2/browser/handoff { session, headed }.
 *  headed:true  = force-relaunch VISIBLE on the desktop ("Let me log in").
 *  headed:false = relaunch headless after the human finishes; the profile
 *                 keeps the auth state (cookies live in the profile dir).
 * §8 risk 4: the headed window opens on the WINDOWS DESKTOP (a normal window,
 * remote-control visible) — the UI banner says so, it is never embedded.
 *
 * Chunk-2 decision (settles chunk-1 delta 3): launch-class routes (/launch and
 * this one) are gated behind the browser capability slot exactly like /tool —
 * one toggle governs everything that starts or drives Chromium. The /browser
 * page surfaces the disabled state with an enable hint.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as {
    session?: unknown;
    headed?: unknown;
  } | null;
  const session = typeof body?.session === "string" ? body.session.trim() : "";
  if (!session) return NextResponse.json({ error: "session is required" }, { status: 400, ...noStore });
  const headed = body?.headed === true;

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

  const { session: live, error } = await launchSession(session, headed, { caller: "user" });
  // E4.1c audit note: handoffs are state changes worth a row (pseudo-tool name).
  recordToolCall({
    sessionName: session,
    tool: "browser_handoff",
    caller: "user",
    args: { headed },
    ok: !error && Boolean(live),
    error: error ?? undefined,
  });
  if (error || !live) {
    return NextResponse.json({ error: error ?? "handoff failed" }, { status: 400, ...noStore });
  }
  return NextResponse.json(
    {
      ok: true,
      session: {
        name: live.sessionName,
        headed: live.headed,
        cdpReady: Boolean(getSessionCdpInfo(session)),
      },
    },
    noStore,
  );
}
