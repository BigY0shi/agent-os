import { readSettings, writeSettings, type Settings } from "@/lib/settings";
import { redactSettings, stripPlaceholders } from "@/lib/settingsRedact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET   /api/control/settings            -> { settings }  every module's settings, secrets masked
// PATCH /api/control/settings { key, value } -> { settings } replaces ONE top-level module
//       block (deep-merged), placeholders stripped so a masked secret stays as it was.
// The Control Room edits through this door only; it never sees key material.
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  return Response.json({ settings: redactSettings(readSettings()) }, noStore);
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== "string" || !/^[A-Za-z][\w-]*$/.test(body.key)) {
    return Response.json({ error: "expected { key: <top-level settings key>, value }" }, { status: 400, ...noStore });
  }
  const current = readSettings() as unknown as Record<string, unknown>;
  if (!(body.key in current)) return Response.json({ error: `no settings block named "${body.key}"` }, { status: 404, ...noStore });
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(current[body.key]) !== isObj(body.value) || (Array.isArray(current[body.key]) && !Array.isArray(body.value))) {
    return Response.json({ error: `"${body.key}" must keep its shape (${Array.isArray(current[body.key]) ? "a list" : isObj(current[body.key]) ? "an object" : typeof current[body.key]})` }, { status: 400, ...noStore });
  }
  const patch = stripPlaceholders({ [body.key]: body.value } as Record<string, unknown>);
  writeSettings(patch as Partial<Settings>);
  // writeSettings swallows disk errors; confirm a changed scalar actually landed.
  const after = readSettings() as unknown as Record<string, unknown>;
  const want = (patch as Record<string, unknown>)[body.key];
  if (!isObj(want) && JSON.stringify(after[body.key]) !== JSON.stringify(want)) {
    return Response.json({ error: "the settings file could not be saved; nothing changed" }, { status: 500, ...noStore });
  }
  return Response.json({ settings: redactSettings(after) }, noStore);
}
