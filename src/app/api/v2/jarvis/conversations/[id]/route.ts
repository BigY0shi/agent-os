import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getConversation,
  listMessages,
  renameConversation,
  archiveConversation,
  restoreConversation,
  setConversationEffort,
  parseEffort,
  JARVIS_EFFORTS,
} from "@/lib/v2/jarvis/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * SPEC-C C3.6 — one conversation.
 *  GET    → { conversation, messages } (messages incl. toolCalls from tool_calls_json)
 *  PATCH  { title } → { conversation }   rename
 *  PATCH  { archived: false } → { conversation }   restore an archived one (S13)
 *  DELETE → archive semantics, NEVER hard delete (archived_at flag; rows kept)
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404, ...noStore });
  }
  return NextResponse.json({ conversation, messages: listMessages(id) }, noStore);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { title?: unknown; archived?: unknown; effort?: unknown } | null;
  if (body && body.archived === false && body.title === undefined) {
    const restored = restoreConversation(id);
    if (!restored) return NextResponse.json({ error: "conversation not found" }, { status: 404, ...noStore });
    return NextResponse.json({ conversation: restored }, noStore);
  }
  // S34: PATCH { effort } sets the session's thinking level ("" or null clears it).
  if (body && body.effort !== undefined && body.title === undefined) {
    const effort = parseEffort(body.effort);
    if (effort === undefined) {
      return NextResponse.json({ error: `effort must be one of ${JARVIS_EFFORTS.join(", ")} or empty` }, { status: 400, ...noStore });
    }
    const updated = setConversationEffort(id, effort);
    if (!updated) return NextResponse.json({ error: "conversation not found" }, { status: 404, ...noStore });
    return NextResponse.json({ conversation: updated }, noStore);
  }
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "body needs { title }, { effort } or { archived: false }" }, { status: 400, ...noStore });
  }
  const conversation = renameConversation(id, body.title);
  if (!conversation) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404, ...noStore });
  }
  return NextResponse.json({ conversation }, noStore);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  const conversation = archiveConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404, ...noStore });
  }
  return NextResponse.json({ ok: true, archived: true, conversation }, noStore);
}
