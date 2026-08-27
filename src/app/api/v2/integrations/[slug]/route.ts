import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getConnector } from "@/lib/v2/integrations/registry";
import {
  IntegrationError,
  definitionConfiguredKeys,
  patchDefinitionConfig,
} from "@/lib/v2/integrations/store";
import { redirectUri } from "@/lib/v2/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ slug: string }> };

const PATCH_KEYS = new Set(["clientId", "clientSecret", "webhookSecret", "enabled"]);

function errResponse(err: unknown) {
  const status = err instanceof IntegrationError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * GET /api/v2/integrations/[slug] (§5.2) → { slug, configured: {booleans},
 * redirectUri }. Booleans ONLY — values never leave the server.
 */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const { slug } = await ctx.params;
  if (!getConnector(slug)) {
    return NextResponse.json({ error: "unknown connector" }, { status: 404, ...noStore });
  }
  return NextResponse.json(
    { slug, configured: definitionConfiguredKeys(slug), redirectUri: redirectUri() },
    noStore,
  );
}

/**
 * PATCH /api/v2/integrations/[slug] { clientId?, clientSecret?, webhookSecret?,
 * enabled? } → merges into the encrypted config_enc. 400 on unknown keys
 * (§5.2). Empty string clears a key. Response repeats the boolean projection.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { slug } = await ctx.params;
  if (!getConnector(slug)) {
    return NextResponse.json({ error: "unknown connector" }, { status: 404, ...noStore });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  const unknown = Object.keys(body).filter((k) => !PATCH_KEYS.has(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `unknown keys: ${unknown.join(", ")}` },
      { status: 400, ...noStore },
    );
  }
  const patch: Record<string, string> = {};
  for (const key of ["clientId", "clientSecret", "webhookSecret"] as const) {
    if (key in body) {
      if (typeof body[key] !== "string") {
        return NextResponse.json({ error: `${key} must be a string` }, { status: 400, ...noStore });
      }
      patch[key] = body[key] as string;
    }
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400, ...noStore });
  }
  try {
    patchDefinitionConfig(slug, patch, body.enabled as boolean | undefined);
    return NextResponse.json(
      { slug, configured: definitionConfiguredKeys(slug), redirectUri: redirectUri() },
      noStore,
    );
  } catch (err) {
    return errResponse(err);
  }
}
