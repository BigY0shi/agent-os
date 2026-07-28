import { engineQuery, engineQueryStdin } from "@/lib/auditEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client brief, via the engine's own `intake` CLI surface — this side never writes
// engine files. GET returns intake + validation + BRIEF_FIELDS (so the form renders from
// the engine's contract and can never drift); POST pipes the full intake JSON to
// `cli.mjs intake <slug> --set`, which validates with exactly the code `check` uses.

export async function GET(req: Request) {
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug) return Response.json({ ok: false, error: "slug is required" }, { status: 400 });
  try {
    return Response.json(await engineQuery(["intake", slug]));
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { slug?: string; intake?: Record<string, unknown> } | null;
  const slug = String(body?.slug ?? "").trim();
  if (!slug || !body?.intake || typeof body.intake !== "object") {
    return Response.json({ ok: false, error: "Body must be { slug, intake }" }, { status: 400 });
  }
  try {
    return Response.json(await engineQueryStdin(["intake", slug, "--set"], JSON.stringify(body.intake)));
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
