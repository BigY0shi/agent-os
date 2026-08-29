import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getTask, resolveTaskId } from "@/lib/v2/tasks/store";
import { approvePlan, rejectPlan } from "@/lib/v2/tasks/engine";
import { tickOnce } from "@/lib/v2/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/tasks/[id]/approve — plan approval loop (B2.6 semantics).
 *  { edits?, note? }                → approvePlan: drafted-only, optional
 *    plan_md edit + user note, enqueues an immediate run; status untouched —
 *    the worker flips Working.
 *  { action: 'reject', reason }     → rejectPlan: plan cleared back to 'none'.
 * Wrong plan state → 409 with the engine's message.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const raw = (await ctx.params).id;
  const id = raw && /^[0-9a-zA-Z.-]{1,64}$/.test(raw) ? resolveTaskId(raw) : null;
  if (!id || !getTask(id)) {
    return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (body.action === "reject") {
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "rejected";
      const task = rejectPlan(id, reason);
      return NextResponse.json({ ok: true, task }, noStore);
    }

    const task = approvePlan(id, {
      edits: typeof body.edits === "string" ? body.edits : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    // Nudge the scheduler so the enqueued immediate run starts without waiting
    // for the next tick interval (fire-and-forget; tickOnce is re-entrancy-safe).
    setTimeout(() => void tickOnce().catch(() => {}), 50);
    return NextResponse.json({ ok: true, task }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("nothing to approve") || message.includes("nothing to reject") ? 409 : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
