import { NextResponse } from "next/server";
import { getModuleRun, dismissModuleRun, stopModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/runs/:id — one run with its events. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getModuleRun(id);
  if (!run) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404, ...noStore });
  return NextResponse.json({ ok: true, run }, noStore);
}

/**
 * POST /api/runs/:id
 *   { action: "stop" }    — STOP a RUNNING run (roadmap S3): the one mid-run
 *                           control. Aborts the run's signal so the child CLI
 *                           dies; status becomes "stopped", never "done".
 *   { action: "dismiss" } — hide a FINISHED (done / error / lost / stopped)
 *                           run from the tray. A running run cannot be
 *                           dismissed; stop it first.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "dismiss" && body.action !== "stop") {
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400, ...noStore });
  }
  const run = getModuleRun(id);
  if (!run) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404, ...noStore });

  if (body.action === "stop") {
    if (run.status !== "running") {
      return NextResponse.json({ ok: false, error: `run is not in flight (status ${run.status})`, run }, { status: 409, ...noStore });
    }
    stopModuleRun(id, "owner");
    return NextResponse.json({ ok: true, run: getModuleRun(id) }, noStore);
  }

  if (run.status === "running") return NextResponse.json({ ok: false, error: "run is still in flight; STOP it first" }, { status: 409, ...noStore });
  dismissModuleRun(id);
  return NextResponse.json({ ok: true, run: getModuleRun(id) }, noStore);
}
