import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { IntegrationError, getAccount } from "@/lib/v2/integrations/store";
import { callTool } from "@/lib/v2/integrations/runtime";
import { ConnectorConfigError } from "@/lib/v2/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/integrations/accounts/[id]/call (§5.6) — { tool, args?,
 * source? } → { result: { text, isError? }, durationMs }. Every call is
 * logged to integration_call_logs by the runtime (redacted args + the source
 * tag — G4.2's ?source= from /api/mcp lands here too). Error split (decision
 * 6): API failures come back 200 with result.isError; contract/config
 * failures (ConnectorConfigError, unknown account) are LOUD HTTP errors.
 * Responses never contain secrets: the runtime hands connectors decrypted
 * config server-side only; nothing here serializes config.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });

  const tool = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!tool) return NextResponse.json({ error: "tool is required" }, { status: 400, ...noStore });
  const args =
    body.args === undefined
      ? {}
      : typeof body.args === "object" && body.args !== null && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : null;
  if (args === null) {
    return NextResponse.json({ error: "args must be a JSON object" }, { status: 400, ...noStore });
  }
  const source = typeof body.source === "string" && body.source ? body.source : "ui";

  try {
    if (!getAccount(id)) {
      return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
    }
    const started = Date.now();
    const result = await callTool(id, tool, args, { source });
    return NextResponse.json({ result, durationMs: Date.now() - started }, noStore);
  } catch (err) {
    const status =
      err instanceof IntegrationError || err instanceof ConnectorConfigError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
