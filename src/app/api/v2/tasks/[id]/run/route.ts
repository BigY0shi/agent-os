import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getTask, resolveTaskId } from "@/lib/v2/tasks/store";
import { enqueueTask, tickOnce } from "@/lib/v2/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/tasks/[id]/run — manual run-now (fire-override enqueue).
 * Enqueues an immediate task.wake carrying payload.immediate (bypasses the
 * run_at staleness guard; runTask's expectedUpdatedAt claim covers races) and
 * nudges the scheduler so it starts promptly. → { ok, runAt } (202-style).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const raw = (await ctx.params).id;
  const id = raw && /^[0-9a-zA-Z.-]{1,64}$/.test(raw) ? resolveTaskId(raw) : null;
  const task = id ? getTask(id) : null;
  if (!id || !task) {
    return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });
  }
  if (task.status === "Done" || !task.isActive) {
    return NextResponse.json(
      { error: `task is ${task.status === "Done" ? "Done" : "inactive"} — reopen it before running` },
      { status: 409, ...noStore },
    );
  }

  const job = enqueueTask(id, { immediate: true, expectedUpdatedAt: task.updatedAt });
  setTimeout(() => void tickOnce().catch(() => {}), 50);
  return NextResponse.json({ ok: true, jobId: job.id, runAt: job.run_at }, { status: 202, ...noStore });
}
