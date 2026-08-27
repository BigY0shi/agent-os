import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { IntegrationError } from "@/lib/v2/integrations/store";
import { startOAuth } from "@/lib/v2/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/integrations/oauth/start { slug, returnTo? } → { url } (§5.3).
 * The client does `window.location = url`; the state row is persisted so the
 * flow survives a server restart between start and callback.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.slug !== "string") {
    return NextResponse.json({ error: "body needs { slug }" }, { status: 400, ...noStore });
  }
  try {
    const { url } = startOAuth(
      body.slug,
      typeof body.returnTo === "string" ? body.returnTo : undefined,
    );
    return NextResponse.json({ url }, noStore);
  } catch (err) {
    const status = err instanceof IntegrationError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
