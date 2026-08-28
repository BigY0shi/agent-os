import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listConnectors } from "@/lib/v2/integrations/registry";
import {
  definitionConfiguredKeys,
  listAccounts,
  toAccountSummary,
} from "@/lib/v2/integrations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/integrations (§5.1) → { connectors: [...] }. NEVER returns
 * secrets — `configured` is a boolean projection. ?all=1 includes '_'-prefixed
 * internal fixture connectors (smokes/dev).
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const includeHidden = req.nextUrl.searchParams.get("all") === "1";
  const connectors = listConnectors({ includeHidden }).map((connector) => {
    const spec = connector.spec;
    const configured = definitionConfiguredKeys(spec.slug);
    return {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      icon: spec.icon ?? "",
      category: spec.category ?? "",
      auth: spec.auth.oauth2 ? "oauth2" : spec.auth.apiKey ? "api_key" : "local",
      // G3 additive: connectors that offer BOTH OAuth and an api-key path
      // (notion) — the ConnectDialog shows both lanes.
      hasApiKey: !!spec.auth.apiKey,
      // G3 additive (G1 UI needs): api-key field defs (Param — no secrets) +
      // the connect-dialog hint (§6.1 renders spec.uiHint).
      authFields: spec.auth.apiKey?.fields ?? [],
      uiHint: spec.uiHint ?? "",
      hasSchedule: !!spec.schedule,
      triggers: spec.triggers ?? [],
      configured: configured.clientId || spec.auth.oauth2 === undefined,
      accounts: listAccounts(spec.slug).map(toAccountSummary),
    };
  });
  return NextResponse.json({ connectors }, noStore);
}
