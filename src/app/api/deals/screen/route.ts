import { planScreenBatch, runScreenBatch, screenBatchStatus } from "@/lib/dealScreen";
import { startModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The quick pass/not screen over every lead nothing has judged yet.
//
// Normally this runs itself: a feed pull screens the leads the brief pass did not
// reach. This route works the tail, or re-runs after a pass that failed. POST starts,
// GET polls - a pass over a few hundred leads cannot be a synchronous request.
//
// NOTE: the job spread goes FIRST in every response. ScreenJob carries its own
// `error` field, so spreading it last would overwrite the error being reported.
export function GET() {
  return Response.json({ ...screenBatchStatus(), ok: true });
}

// POST { source?: string, limit?: number }
//
// Registered as a module run so the tray shows it with a lead counter and STOP ends
// it (ctx.signal reaches every claude child through screenDeal). Leads already
// started finish; leads not yet started stay NA and are picked up next pass.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { source?: string; limit?: number };
  const plan = await planScreenBatch(body);
  if (!plan.ok) {
    if (plan.reason === "already running") {
      return Response.json(
        { ...screenBatchStatus(), ok: false, error: "A screen pass is already running." },
        { status: 409 },
      );
    }
    return Response.json({ ...screenBatchStatus(), started: false, total: plan.total, reason: plan.reason, ok: true });
  }
  const run = startModuleRun(
    { module: "deals", label: `Screen pass: ${plan.targets.length} leads${body.source ? ` (${body.source})` : ""}`, href: "/deals" },
    (ctx) => runScreenBatch(plan.targets, { runId: ctx.id, signal: ctx.signal, onProgress: ctx.progress, log: ctx.log }),
    { summarize: () => { const s = screenBatchStatus(); return { succeeded: s.succeeded, failed: s.failed, total: s.total }; } },
  );
  return Response.json({ ...screenBatchStatus(), started: true, total: plan.targets.length, runId: run.id, ok: true });
}
