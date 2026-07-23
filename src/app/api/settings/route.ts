import { readSettings, writeSettings, type Settings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/settings        → the full settings object (defaults merged with ~/.agentic-os/settings.json)
// PATCH /api/settings  body  → deep-merge the patch into settings.json and return the result.
// Single-user localhost dashboard, so values (incl. user-pasted Suno fields) are returned as-is
// for the config menus to edit.

export async function GET() {
  return Response.json({ ok: true, settings: readSettings() }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(req: Request) {
  let patch: Partial<Settings>;
  try { patch = await req.json(); }
  catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!patch || typeof patch !== "object") {
    return Response.json({ ok: false, error: "patch must be an object" }, { status: 400 });
  }
  const settings = writeSettings(patch);
  return Response.json({ ok: true, settings }, { headers: { "cache-control": "no-store" } });
}

// Allow POST as an alias for PATCH (some fetch helpers default to POST).
export const POST = PATCH;
