import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getConfiguredSessions,
  getMaxSessions,
  createSessionConfig,
  deleteSessionConfig,
} from "@/lib/v2/browser/config";
import { getLiveSession, getSessionCdpInfo } from "@/lib/v2/browser/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-E §5.1 — GET /api/v2/browser/sessions (configured + live flags). */
export async function GET() {
  ensureV2();
  const sessions = getConfiguredSessions().map((s) => {
    const live = getLiveSession(s.name);
    let currentUrl: string | undefined;
    if (live) {
      try {
        currentUrl = live.page.isClosed() ? undefined : live.page.url();
      } catch {
        currentUrl = undefined;
      }
    }
    return {
      name: s.name,
      profile: s.profile,
      allowedDomains: s.allowedDomains,
      live: Boolean(live),
      cdpReady: Boolean(getSessionCdpInfo(s.name)),
      headed: live?.headed ?? false,
      currentUrl,
    };
  });
  return NextResponse.json({ sessions, max: getMaxSessions() }, noStore);
}

export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    profile?: unknown;
    allowedDomains?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const profile = typeof body?.profile === "string" ? body.profile.trim() : "";
  if (!name || !profile) {
    return NextResponse.json({ error: "name and profile are required" }, { status: 400, ...noStore });
  }
  const allowedDomains = Array.isArray(body?.allowedDomains)
    ? (body.allowedDomains as unknown[]).filter((d): d is string => typeof d === "string")
    : undefined;
  const r = createSessionConfig(name, profile, allowedDomains);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 400, ...noStore });
  return NextResponse.json({ ok: true }, noStore);
}

/** Config removal only — profile data (auth state) preserved. */
export async function DELETE(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400, ...noStore });
  const r = deleteSessionConfig(name);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 400, ...noStore });
  return NextResponse.json({ ok: true }, noStore);
}
