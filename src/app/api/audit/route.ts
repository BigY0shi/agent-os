import { engineAvailable, engineQuery, auditJob, ENGINE_DIR } from "@/lib/auditEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/audit → create a client (shells `cli.mjs new`; the engine owns the write).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { name?: string; slug?: string };
  const name = String(body.name ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  if (!name && !slug) return Response.json({ ok: false, error: "A business name is required." }, { status: 400 });
  try {
    const r = await engineQuery(["new", slug || name, "--name", name || slug]) as { ok?: boolean; slug?: string };
    return Response.json({ ok: r.ok !== false, slug: r.slug ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// GET /api/audit → every engine client (from `cli.mjs list`) + the current job.
// One poll target for the console page. Reads only; audit state stays in the engine.
export async function GET() {
  if (!engineAvailable()) {
    return Response.json({ ok: false, error: `Audit engine not found at ${ENGINE_DIR}`, clients: [], job: auditJob });
  }
  try {
    const list = await engineQuery(["list"]) as { clients?: unknown[] };
    return Response.json({ ok: true, clients: list.clients ?? [], job: publicJob() });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), clients: [], job: publicJob() });
  }
}

function publicJob() {
  const { stage, action, slug, passes, startedAt, finishedAt, error, result, tail } = auditJob;
  return {
    stage, action, slug, passes, error, result, tail,
    startedAt: startedAt || null,
    finishedAt,
    elapsedMs: startedAt ? (finishedAt ?? Date.now()) - startedAt : 0,
  };
}
