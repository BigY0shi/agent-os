import { getModuleKit, setKitItem, KitError, type KitToggle } from "@/lib/moduleKit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/modules/kit?module=<id> -> the module's skills and workflows, each with
//      activeHere / activeGlobal, plus whether the module's code reads skills at all.
// POST /api/modules/kit { module, kind: "skill"|"workflow", name, active, scope? }
//      switches one on or off for that module (scope "module", the default) or for
//      every module (scope "global"); returns the refreshed kit.
const noStore = { headers: { "Cache-Control": "no-store" } };

function fail(e: unknown) {
  if (e instanceof KitError) return Response.json({ error: e.message }, { status: e.status, ...noStore });
  return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("module");
  if (!id) return Response.json({ error: "module is required, e.g. ?module=deals" }, { status: 400, ...noStore });
  try { return Response.json(getModuleKit(id), noStore); } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<KitToggle> | null;
  if (!body || typeof body.module !== "string" || typeof body.name !== "string") {
    return Response.json({ error: "expected { module, kind, name, active, scope? }" }, { status: 400, ...noStore });
  }
  try { return Response.json(setKitItem(body as KitToggle), noStore); } catch (e) { return fail(e); }
}
