import { NextResponse } from "next/server";
import { getModuleRun, dismissModuleRun } from "@/lib/moduleRuns";

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
 * POST /api/runs/:id  { action: "dismiss" } — hide a FINISHED run from the
 * tray. A running run cannot be dismissed; stopping it is the module's own
 * verb (roadmap S3), not this one's.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "dismiss") return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400, ...noStore });
  const run = getModuleRun(id);
  if (!run) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404, ...noStore });
  if (run.status === "running") return NextResponse.json({ ok: false, error: "run is still in flight; it cannot be dismissed" }, { status: 409, ...noStore });
  dismissModuleRun(id);
  return NextResponse.json({ ok: true, run: getModuleRun(id) }, noStore);
}
