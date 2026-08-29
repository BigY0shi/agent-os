import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getConversation,
  listMessages,
  renameConversation,
  archiveConversation,
} from "@/lib/v2/jarvis/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * SPEC-C C3.6 — one conversation.
 *  GET    → { conversation, messages } (messages incl. toolCalls from tool_calls_json)
 *  PATCH  { title } → { conversation }
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
  const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "body needs { title }" }, { status: 400, ...noStore });
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
