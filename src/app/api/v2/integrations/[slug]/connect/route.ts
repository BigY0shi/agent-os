import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getConnector } from "@/lib/v2/integrations/registry";
import { IntegrationError, toAccountSummary } from "@/lib/v2/integrations/store";
import { setupAccount } from "@/lib/v2/integrations/runtime";
import { ensureAccountSyncJob } from "@/lib/v2/integrations/schedule";
import { ConnectorConfigError } from "@/lib/v2/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/v2/integrations/[slug]/connect (§5.3) — API-key / local path.
 * Body { fields: Record<string,string> } per spec.auth.apiKey.fields (local
 * connectors take {}). 422 with the connector's error text when the key fails
 * validation (setup probes the API). OAuth connectors use /oauth/start.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { slug } = await ctx.params;
  const connector = getConnector(slug);
  if (!connector) {
    return NextResponse.json({ error: "unknown connector" }, { status: 404, ...noStore });
  }
  if (!connector.spec.auth.apiKey && !connector.spec.auth.local) {
    return NextResponse.json(
      { error: `connector '${slug}' connects via OAuth — use /oauth/start` },
      { status: 400, ...noStore },
    );
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const fields =
    body && typeof body.fields === "object" && body.fields !== null
      ? Object.fromEntries(
          Object.entries(body.fields as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : {};
  try {
    const account = await setupAccount(slug, { fields });
    ensureAccountSyncJob(account);
    return NextResponse.json({ ok: true, account: toAccountSummary(account) }, noStore);
  } catch (err) {
    const status =
      err instanceof IntegrationError || err instanceof ConnectorConfigError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
