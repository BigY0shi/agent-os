import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v2/memory/mcp-secret/reveal -> { secret }
// The one door the MCP endpoint's secret leaves by, for the Memory gear's "Copy secret"
// button (GET /api/settings masks it). Session-cookie only: proxy.ts lets the MCP header
// through for /api/mcp alone, so this path is already cookie-gated, and a request that
// carries an MCP header or a bearer is refused here as well, so a client holding the
// secret (or any agent token) can never use it to read the secret back. Every reveal is
// logged; the value itself never is.

const noStore = { "cache-control": "no-store" };

export async function POST(req: Request) {
  if (req.headers.has("x-agentos-mcp-secret") || req.headers.has("authorization")) {
    console.warn(`[mcp-secret] reveal REFUSED (agent credential on the request) at ${new Date().toISOString()}`);
    return Response.json({ ok: false, error: "the MCP secret is revealed to a signed-in session only" }, { status: 403, headers: noStore });
  }
  const secret = readSettings().mcp?.secret;
  if (typeof secret !== "string" || !secret) {
    return Response.json({ ok: false, error: "no MCP secret yet; one is generated when the MCP endpoint is first used" }, { status: 404, headers: noStore });
  }
  console.info(`[mcp-secret] revealed to a signed-in session at ${new Date().toISOString()}`);
  return Response.json({ ok: true, secret }, { headers: noStore });
}
