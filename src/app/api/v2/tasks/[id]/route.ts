import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getTask,
  resolveTaskId,
  updateTask,
  changeTaskStatus,
  deleteTask,
  listSubtasks,
  listTaskEvents,
  listTaskSessions,
  listTaskConversations,
} from "@/lib/v2/tasks/store";
import { applySchedule } from "@/lib/v2/tasks/recurrence";
import { TASK_STATUSES, type TaskStatus } from "@/lib/v2/tasks/types";
import type { UpdateTaskInput } from "@/lib/v2/tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** :id accepts a uuid OR a 'tk-N(.M)' display id (resolveTaskId at the boundary). */
function resolveParam(raw: string | undefined): string | null {
  if (!raw || !/^[0-9a-zA-Z.-]{1,64}$/.test(raw)) return null;
  return resolveTaskId(raw);
}

/**
 * GET /api/v2/tasks/[id] — detail: task + subtasks + events + sessions +
 * conversation list (messages come from /chat). → 404 when unknown.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = resolveParam((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });

  return NextResponse.json(
    {
      task,
      subtasks: listSubtasks(id),
      events: listTaskEvents(id, 50),
      sessions: listTaskSessions(id),
      conversations: listTaskConversations(id),
    },
    noStore,
  );
}

/**
 * PATCH /api/v2/tasks/[id] — update (SPEC-B §5 + B3.4 discipline):
 *  - status → changeTaskStatus actor 'user'; illegal transition → 409 with the
 *    phase-rule reason. 'Working' is runtime-owned: dropping on In Progress
 *    sets Ready, the worker flips Working — direct Working PATCHes 409.
 *  - schedule / isActive / endDate / maxOccurrences / runAt → applySchedule
 *    (the ONLY path that touches the wake queue);
 *  - everything else (title/spec/plan/date/agent/metadata) → updateTask, which
 *    NEVER touches the queue (title edits mid-pending-fire stay armed).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = resolveParam((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });
  const current = getTask(id);
  if (!current) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }

  try {
    // ---- field updates (queue-blind) ----
    const patch: UpdateTaskInput = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (body.specMd === null || typeof body.specMd === "string") patch.specMd = body.specMd as string | null;
    if (body.descriptionMd === null || typeof body.descriptionMd === "string") patch.descriptionMd = body.descriptionMd as string | null;
    if (body.planMd === null || typeof body.planMd === "string") patch.planMd = body.planMd as string | null;
    if (body.agentId === null || typeof body.agentId === "string") patch.agentId = body.agentId as string | null;
    if (body.scheduledDate === null || typeof body.scheduledDate === "string") patch.scheduledDate = body.scheduledDate as string | null;
    if (body.metadata && typeof body.metadata === "object") {
      patch.metadata = { ...current.metadata, ...(body.metadata as Record<string, unknown>) };
    }
    if (Object.keys(patch).length > 0) updateTask(id, patch, "user");

    // ---- schedule block (queue touched ONLY here — B3.4) ----
    const scheduleTouched =
      body.schedule !== undefined ||
      body.runAt !== undefined ||
      body.isActive !== undefined ||
      body.endDate !== undefined ||
      body.maxOccurrences !== undefined;
    if (scheduleTouched) {
      const fresh = getTask(id)!;
      applySchedule(id, {
        // isActive toggles must re-derive runAt from the STORED schedule, so a
        // disabled seed re-arms correctly — pass the schedule through unless
        // the caller is changing it.
        schedule:
          body.schedule === null || typeof body.schedule === "string"
            ? (body.schedule as string | null)
            : fresh.schedule,
        runAt: body.runAt === null || typeof body.runAt === "string" ? (body.runAt as string | null) : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
        endDate: body.endDate === null || typeof body.endDate === "string" ? (body.endDate as string | null) : undefined,
        maxOccurrences:
          body.maxOccurrences === null || typeof body.maxOccurrences === "number"
            ? (body.maxOccurrences as number | null)
            : undefined,
      });
    }

    // ---- status transition (last, so field edits land either way) ----
    if (typeof body.status === "string") {
      if (!(TASK_STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: `invalid status '${body.status}'` }, { status: 400, ...noStore });
      }
      if (body.status === "Working") {
        return NextResponse.json(
          { error: "'Working' is runtime-owned — drop on In Progress sets Ready; the worker flips Working when the run starts." },
          { status: 409, ...noStore },
        );
      }
      try {
        changeTaskStatus(id, body.status as TaskStatus, "user");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("Invalid transition")) {
          return NextResponse.json({ error: message }, { status: 409, ...noStore });
        }
        throw err;
      }
    }

    return NextResponse.json({ task: getTask(id) }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

/**
 * DELETE /api/v2/tasks/[id] — exile-delete (global rule 1): full bundle to
 * ~/.agentic-os/.exile/tasks/ verified on disk BEFORE any row is removed.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = resolveParam((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });
  try {
    const result = deleteTask(id);
    return NextResponse.json(result, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
