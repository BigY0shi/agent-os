import { planBriefBatch, runBriefBatch, briefBatchStatus } from "@/lib/briefBatch";
import { startModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual bulk brief. Normally this runs automatically — a feed pull briefs the new
// leads, and "Clear passed & refill" tops the queue back up. This route exists to work
// the tail, or to re-run after a failed pass. POST starts, GET polls; a pass is ~a
// minute, so it cannot be a synchronous request.
//
// NOTE: the job spread goes FIRST in every response. BriefJob carries its own `error`
// field, so spreading it last would silently overwrite the error message being reported.
export function GET() {
  return Response.json({ ...briefBatchStatus(), ok: true });
}

// POST { source?: "remoteok" | "wwr" | "upwork", limit?: number, target?: number }
//
// The pass is registered as a module run (roadmap S2 backlog) so the tray shows
// it with a lead counter and STOP ends it (ctx.signal reaches every claude
// child through generateBrief). The response is still immediate: this route
// never awaited the pass, so it does not start now; runId is the only new field.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { source?: string; limit?: number; target?: number };
  const plan = await planBriefBatch(body);
  if (!plan.ok) {
    if (plan.reason === "already running") {
      return Response.json(
        { ...briefBatchStatus(), ok: false, error: "A brief pass is already running." },
        { status: 409 },
      );
    }
    return Response.json({ ...briefBatchStatus(), started: false, total: plan.total, reason: plan.reason, ok: true });
  }
  const run = startModuleRun(
    { module: "deals", label: `Brief pass: ${plan.targets.length} leads${body.source ? ` (${body.source})` : ""}`, href: "/deals" },
    (ctx) => runBriefBatch(plan.targets, { target: body.target, runId: ctx.id, signal: ctx.signal, onProgress: ctx.progress, log: ctx.log }),
    { summarize: () => { const s = briefBatchStatus(); return { succeeded: s.succeeded, failed: s.failed, total: s.total }; } },
  );
  return Response.json({ ...briefBatchStatus(), started: true, total: plan.targets.length, runId: run.id, ok: true });
}
