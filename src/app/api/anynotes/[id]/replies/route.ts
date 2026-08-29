// SPEC-F I3.2 — GET thread / POST reply (may queue a jarvis turn).
//
// jarvisQueued=true when the body matches /@jarvis\b/i: a jarvis Reply row with
// pending=1 is inserted synchronously (so the client's very next poll sees the
// "thinking…" bubble) and generation is kicked fire-and-forget. The POST's 200
// is about ACCEPTING the reply — a generation failure lands in that row's
// `error` column, never in this status code (rule 11: loud, but in the thread).
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { kickJarvisReply } from "@/lib/v2/anynotes/jarvisReply";
import { addReply, getNote, listReplies } from "@/lib/v2/anynotes/store";
import { mentionsJarvis } from "@/lib/v2/anynotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const ID_RE = /^[a-z0-9]{4,32}$/;
const MAX_REPLY_CHARS = 20_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad note id" }, { status: 400, ...noStore });
  try {
    if (!getNote(id)) return NextResponse.json({ error: "note not found" }, { status: 404, ...noStore });
    return NextResponse.json({ replies: listReplies(id) }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "bad note id" }, { status: 400, ...noStore });

  const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "body is required" }, { status: 400, ...noStore });
  if (text.length > MAX_REPLY_CHARS) {
    return NextResponse.json(
      { error: `reply is ${text.length} chars — the cap is ${MAX_REPLY_CHARS}` },
      { status: 400, ...noStore },
    );
  }

  try {
    if (!getNote(id)) return NextResponse.json({ error: "note not found" }, { status: 404, ...noStore });

    const reply = addReply({ noteId: id, author: "user", body: text });
    const jarvisQueued = mentionsJarvis(text);
    if (jarvisQueued) {
      const pending = addReply({ noteId: id, author: "jarvis", body: "", pending: true });
      kickJarvisReply(id, pending.id);
      return NextResponse.json({ reply, jarvisQueued, jarvisReplyId: pending.id }, noStore);
    }
    return NextResponse.json({ reply, jarvisQueued }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, ...noStore });
  }
}
