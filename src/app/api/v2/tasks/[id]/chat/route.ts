import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getTask,
  resolveTaskId,
  listTaskConversations,
  getOrCreateTaskConversation,
  listMessages,
  appendMessage,
} from "@/lib/v2/tasks/store";
import { checkWaitingTaskReply } from "@/lib/v2/tasks/engine";
import { ingestFromModule } from "@/lib/v2/memory/queue";
import type { Conversation } from "@/lib/v2/tasks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function resolve(raw: string | undefined): string | null {
  if (!raw || !/^[0-9a-zA-Z.-]{1,64}$/.test(raw)) return null;
  return resolveTaskId(raw);
}

/** The thread a user reply lands in: recurring tasks get one per run — use the
 *  latest; one-shot tasks share a single lazily-created thread (B1.5 policy). */
function activeConversation(taskId: string, isRecurring: boolean): Conversation {
  const existing = listTaskConversations(taskId);
  if (existing.length > 0) return existing[existing.length - 1];
  // No conversation yet (task never ran) — create the shared thread. Fine for
  // recurring too: the engine's next run reuses/creates per policy.
  void isRecurring;
  return getOrCreateTaskConversation(taskId);
}

/**
 * GET /api/v2/tasks/[id]/chat → { conversationId, runNo, messages } — the
 * active thread's visible messages (ephemeral trigger turns hidden), plus the
 * full runs list for recurring tasks.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = resolve((await ctx.params).id);
  const task = id ? getTask(id) : null;
  if (!id || !task) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });

  const conv = activeConversation(id, !!task.schedule);
  const runs = listTaskConversations(id).map((c) => ({
    conversationId: c.id,
    runNo: c.runNo,
    createdAt: c.createdAt,
  }));
  return NextResponse.json(
    {
      conversationId: conv.id,
      runNo: conv.runNo,
      messages: listMessages(conv.id, { includeEphemeral: false }),
      runs,
    },
    noStore,
  );
}

/**
 * POST /api/v2/tasks/[id]/chat { text } — append a user turn; if the task is
 * Waiting, checkWaitingTaskReply flips it Ready (actor user) and the Ready
 * buffer re-runs it (B2.6 auto-unblock). → { message, unblocked }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = resolve((await ctx.params).id);
  const task = id ? getTask(id) : null;
  if (!id || !task) return NextResponse.json({ error: "task not found" }, { status: 404, ...noStore });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400, ...noStore });

  const conv = activeConversation(id, !!task.schedule);
  const message = appendMessage(conv.id, { role: "user", content: text, userType: "human" });
  const unblocked = checkWaitingTaskReply(conv.id);
  // B6: task chat exchanges ingest into Memory V2 (labels task + tk-N,
  // session task-<uuid> — same bucket as the engine's run-summary ingest).
  void ingestFromModule({
    episodeBody: `Task ${task.displayId} (${task.title || "untitled"}) chat — user: ${text}`,
    source: "task",
    labelNames: ["task", task.displayId],
    sessionId: `task-${task.id}`,
    metadata: { taskId: task.id, displayId: task.displayId, conversationId: conv.id },
  }).catch((err) => {
    console.warn(`[v2/tasks] chat ingest failed for ${task.displayId} (message still saved):`, err);
  });
  return NextResponse.json({ message, unblocked }, noStore);
}
