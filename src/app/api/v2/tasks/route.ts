import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { createTask, listTasks } from "@/lib/v2/tasks/store";
import { applySchedule } from "@/lib/v2/tasks/recurrence";
import { TASK_STATUSES, type TaskStatus } from "@/lib/v2/tasks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/tasks — list/search (SPEC-B §5, filters per store.listTasks).
 *   ?status=Todo,Working  ?source=seed  ?agentId=  ?parent=null|<uuid>
 *   ?scheduledDate=YYYY-MM-DD  ?q=<FTS>  ?limit=
 * → { tasks }
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const p = req.nextUrl.searchParams;

  const statusRaw = (p.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s));

  const parentRaw = p.get("parent");
  const limitRaw = parseInt(p.get("limit") ?? "", 10);

  const tasks = listTasks({
    status: statusRaw.length ? statusRaw : undefined,
    source: p.get("source") ?? undefined,
    agentId: p.get("agentId") ?? undefined,
    parent: parentRaw === null ? undefined : parentRaw === "null" ? null : parentRaw,
    scheduledDate: p.get("scheduledDate") ?? undefined,
    q: p.get("q") ?? undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
  });
  return NextResponse.json({ tasks }, noStore);
}

/**
 * POST /api/v2/tasks — create (SPEC-B §5).
 * body { title?, specMd?, descriptionMd?, status?='Todo', parentId?, source?,
 *        agentId?, scheduledDate?, metadata?, schedule?, runAt?,
 *        maxOccurrences?, endDate? }
 * schedule|runAt route through applySchedule (arms the wake job).
 * → 201 { task }
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }

  const status = typeof body.status === "string" ? body.status : undefined;
  if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `invalid status '${status}'` }, { status: 400, ...noStore });
  }

  try {
    let task = createTask({
      title: typeof body.title === "string" ? body.title : undefined,
      specMd: typeof body.specMd === "string" ? body.specMd : undefined,
      descriptionMd: typeof body.descriptionMd === "string" ? body.descriptionMd : undefined,
      status: status as TaskStatus | undefined,
      parentId: typeof body.parentId === "string" ? body.parentId : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      scheduledDate: typeof body.scheduledDate === "string" ? body.scheduledDate : undefined,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : undefined,
      actor: "user",
    });

    if (typeof body.schedule === "string" || typeof body.runAt === "string") {
      task = applySchedule(task.id, {
        schedule: typeof body.schedule === "string" ? body.schedule : undefined,
        runAt: typeof body.runAt === "string" ? body.runAt : undefined,
        maxOccurrences: typeof body.maxOccurrences === "number" ? body.maxOccurrences : undefined,
        endDate: typeof body.endDate === "string" ? body.endDate : undefined,
        isActive: true,
      });
    }
    return NextResponse.json({ task }, { status: 201, ...noStore });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("depth limit") || message.includes("not found") ? 400 : 500;
    return NextResponse.json({ error: message }, { status: code, ...noStore });
  }
}
