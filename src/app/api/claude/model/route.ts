import { claudeModel, claudeModelSource } from "@/lib/claudeModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/claude/model → the Claude chat model in force right now and where it comes from
// ("settings" = the Claude page's gear; "env" / "config.json" = the back-compat overrides, which
// win over the gear; "default" = nothing set, claude-opus-4-8). Lets the gear say when a
// saved choice is being overridden instead of silently showing a value that is not in use.
export async function GET() {
  return Response.json({ ok: true, model: claudeModel(), source: claudeModelSource() }, { headers: { "cache-control": "no-store" } });
}
