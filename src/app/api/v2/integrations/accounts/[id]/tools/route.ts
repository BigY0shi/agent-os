import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { IntegrationError, getAccount } from "@/lib/v2/integrations/store";
import { getTools } from "@/lib/v2/integrations/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/integrations/accounts/[id]/tools (§5.6) → { tools:
 * ConnectorTool[] } — ALL tools, unfiltered, for the UI tool browser (the
 * AccountDetail Tools tab). Names are already slug-prefixed; schemas carry no
 * secrets by construction.
 */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  try {
    const account = getAccount(id);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
    }
    return NextResponse.json({ tools: getTools(account.definitionSlug) }, noStore);
  } catch (err) {
    const status = err instanceof IntegrationError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
