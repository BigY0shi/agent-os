import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { isSessionConfigured } from "@/lib/v2/browser/config";
import { mintTicket } from "@/lib/v2/browser/tickets";
import { ensureBrowserWs, getBrowserWsInfo } from "@/lib/v2/browser/wsBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-E §5.1 — POST /api/v2/browser/ticket { session } →
 * { wsUrl: "ws://<reqHost>:<wsPort>/cdp/<session>?ticket=<t>", expiresAt }.
 *
 * This route is behind proxy.ts's password gate — that is exactly why the WS
 * bridge (NOT behind the gate, §8 risk 1b) can trust its tickets. The host
 * comes from the request's Host header so LAN clients get a reachable URL;
 * the port is the bridge's ACTUAL bound port (honors ephemeral wsPort 0).
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { session?: unknown } | null;
  const session = typeof body?.session === "string" ? body.session.trim() : "";
  if (!session) return NextResponse.json({ error: "session is required" }, { status: 400, ...noStore });
  if (!isSessionConfigured(session)) {
    return NextResponse.json({ error: `Session "${session}" is not configured` }, { status: 404, ...noStore });
  }

  // Bridge may still be coming up (or was reconfigured) — ensure before minting.
  await ensureBrowserWs();
  const ws = getBrowserWsInfo();
  if (!ws) {
    return NextResponse.json(
      { error: "CDP WS bridge is not running (port conflict? — see server logs / Browser settings)" },
      { status: 503, ...noStore },
    );
  }

  const minted = mintTicket(session);
  if ("error" in minted) {
    // Fail-closed without AGENTOS_PASSWORD (mirrors proxy.ts 503).
    return NextResponse.json({ error: minted.error }, { status: 503, ...noStore });
  }

  const host = req.headers.get("host") ?? "127.0.0.1";
  const hostname = host.includes(":") ? host.slice(0, host.lastIndexOf(":")) : host;
  const wsUrl = `ws://${hostname}:${ws.port}/cdp/${encodeURIComponent(session)}?ticket=${encodeURIComponent(minted.ticket)}`;
  return NextResponse.json({ wsUrl, expiresAt: minted.expiresAt }, noStore);
}
