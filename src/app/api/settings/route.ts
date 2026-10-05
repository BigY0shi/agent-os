import { readSettings, writeSettings, type Settings } from "@/lib/settings";
import { redactSettings, stripPlaceholders } from "@/lib/settingsRedact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/settings        → settings (defaults merged with ~/.agentic-os/settings.json), secrets MASKED
// PATCH /api/settings  body  → deep-merge the patch into settings.json and return the masked result.
// Key material never leaves through this door (AGENTS.md): every secret-looking field comes
// back as its mask (first 5 characters + "********", see lib/settingsRedact.ts), and a
// masked value in a PATCH is dropped, so a form that saves back what it loaded keeps the
// stored key. The MCP secret has its own cookie-only reveal: /api/v2/memory/mcp-secret/reveal.

export async function GET() {
  return Response.json({ ok: true, settings: redactSettings(readSettings()) }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(req: Request) {
  let patch: Partial<Settings>;
  try { patch = await req.json(); }
  catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!patch || typeof patch !== "object") {
    return Response.json({ ok: false, error: "patch must be an object" }, { status: 400 });
  }
  const settings = writeSettings(stripPlaceholders(patch));
  return Response.json({ ok: true, settings: redactSettings(settings) }, { headers: { "cache-control": "no-store" } });
}

// Allow POST as an alias for PATCH (some fetch helpers default to POST).
export const POST = PATCH;
