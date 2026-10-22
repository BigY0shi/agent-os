import { addServer, listRetired, listServers, McpError, restoreServer, retireServer, setEnabled } from "@/lib/v2/jarvis/mcpServers";
import { listClaudeCodeServers } from "@/lib/claudeMcpServers";
import { listCatalog, listInstalled, loadManifest } from "@/lib/hermesMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/jarvis/mcp                -> { jarvis, retired, builtin, claudeCode, hermes }
// GET  /api/v2/jarvis/mcp?catalog=1      -> { catalog }  the approved Hermes catalogue (runs the hermes CLI)
// GET  /api/v2/jarvis/mcp?manifest=<name> -> { manifest } for prefilling the install wizard
// POST /api/v2/jarvis/mcp { action: "add" | "enable" | "disable" | "retire" | "restore", ... }
// Header and env VALUES never appear in any response; only their names.
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof McpError
    ? Response.json({ error: e.message }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

// Jarvis's built-in tools (tools.ts buildJarvisToolHandlers), for the "Installed" view.
// Not exported: a route file may only export handlers and route config. Kept in step by the smoke.
const BUILTIN_TOOLS = ["ui_control", "module_kit", "memory_search", "memory_ingest", "get_actions", "execute_action", "navigate"];

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    if (q.get("catalog") === "1") {
      try { return Response.json({ catalog: await listCatalog() }, noStore); }
      catch (e) { return Response.json({ catalog: [], error: `the Hermes catalogue could not be read: ${String((e as Error)?.message ?? e)}` }, noStore); }
    }
    const manifest = q.get("manifest");
    if (manifest !== null) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(manifest)) return Response.json({ error: "bad manifest name" }, { status: 400, ...noStore });
      const m = await loadManifest(manifest);
      return m ? Response.json({ manifest: m }, noStore) : Response.json({ error: `no manifest for ${manifest}` }, { status: 404, ...noStore });
    }
    let hermes: { name: string; enabled: boolean; transport: string; url?: string; command?: string }[] = [];
    let hermesError: string | null = null;
    try { hermes = (await listInstalled()).map(({ name, enabled, transport, url, command }) => ({ name, enabled, transport, url, command })); }
    catch (e) { hermesError = String((e as Error)?.message ?? e); }
    const cc = listClaudeCodeServers();
    return Response.json({
      jarvis: listServers(),
      retired: listRetired(),
      builtin: { name: "agentos", tools: BUILTIN_TOOLS, note: "Jarvis's own tools, gated by capability, Human-Gate and taint rules." },
      claudeCode: cc.servers, claudeCodeError: cc.error,
      hermes, hermesError,
    }, noStore);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ({ action?: unknown; name?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.action !== "string") return Response.json({ error: "expected { action, ... }" }, { status: 400, ...noStore });
  const name = typeof body.name === "string" ? body.name : "";
  try {
    switch (body.action) {
      case "add": return Response.json({ server: addServer(body) }, { status: 201, ...noStore });
      case "enable": return Response.json({ server: setEnabled(name, true) }, noStore);
      case "disable": return Response.json({ server: setEnabled(name, false) }, noStore);
      case "retire": retireServer(name); return Response.json({ ok: true, retired: name }, noStore);
      case "restore": return Response.json({ server: restoreServer(name) }, noStore);
      default: return Response.json({ error: `unknown action "${body.action}"` }, { status: 400, ...noStore });
    }
  } catch (e) { return fail(e); }
}
