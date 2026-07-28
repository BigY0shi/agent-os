import { auditJob, engineQuery, startAuditJob, type AuditAction } from "@/lib/auditEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/audit/run → start an engine command in the background, return immediately.
// GET  /api/audit/run?slug= → job heartbeat + the engine's own per-agent status.
//
// Mirrors /api/deals/scrape: an audit stage runs 4-8 minutes per agent and a multi-pass
// run tens of minutes, so this can never be a synchronous request. The client polls and
// re-attaches on mount — a reload mid-run loses nothing because the job lives on
// globalThis and the real state lives in the engine's run.json.

const ACTIONS = new Set<AuditAction>(["run", "distill", "warroom"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { slug?: string; action?: string; passes?: number };
  const slug = String(body.slug ?? "").trim();
  const action = (body.action ?? "run") as AuditAction;
  if (!slug) return Response.json({ ok: false, error: "slug is required" }, { status: 400 });
  if (!ACTIONS.has(action)) return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });

  const passes = Number.isInteger(body.passes) && (body.passes as number) >= 1 ? (body.passes as number) : null;
  const started = startAuditJob(action, slug, passes);
  if (!started.ok) return Response.json(started, { status: 409 });
  return Response.json({ ok: true, started: true, action, slug, passes });
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? auditJob.slug;
  let engine: unknown = null;
  if (slug) {
    // The engine is the source of truth — run state, per-agent envelope statuses, log tail.
    try { engine = await engineQuery(["status", slug]); } catch { engine = null; }
  }
  const { stage, action, slug: jobSlug, passes, startedAt, finishedAt, error, result, tail } = auditJob;
  return Response.json({
    ok: true,
    job: {
      stage, action, slug: jobSlug, passes, error, result, tail,
      running: stage === "running",
      startedAt: startedAt || null,
      finishedAt,
      elapsedMs: startedAt ? (finishedAt ?? Date.now()) - startedAt : 0,
    },
    engine,
  });
}
