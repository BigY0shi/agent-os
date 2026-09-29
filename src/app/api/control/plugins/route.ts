import { listClaudePlugins, setClaudePlugin, PluginError, claudeSettingsPath } from "@/lib/claudePlugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/control/plugins -> { plugins: [{ id, name, marketplace, enabled }], source }
// POST /api/control/plugins { id, enabled } -> { plugin, backup }
// Claude Code plugins are global to Claude Code (every session, not per module) and
// take effect in the NEXT Claude Code session. Each change keeps a backup copy.
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof PluginError
    ? Response.json({ error: e.message }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

export async function GET() {
  try { return Response.json({ plugins: listClaudePlugins(), source: claudeSettingsPath() }, noStore); } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null;
  if (!body) return Response.json({ error: "expected { id, enabled }" }, { status: 400, ...noStore });
  try { return Response.json(setClaudePlugin(body.id as string, body.enabled as boolean), noStore); } catch (e) { return fail(e); }
}
