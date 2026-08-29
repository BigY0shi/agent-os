import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { askJarvisV2, jarvisAskStatus, type JarvisAskEvent } from "@/lib/v2/jarvis/brain";
import { sanitizePageContext } from "@/lib/v2/jarvis/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SPEC-C C3 — the Jarvis V2 ask lane.
 *   POST { text, conversationId?, pageContext? } → SSE stream:
 *     {type:"meta",conversationId,engine,note?} {type:"sentence",text}
 *     {type:"tool",name,state,summary?} {type:"navigate",route}
 *     {type:"done",costUsd?,turns?,durationMs} {type:"error",message}
 *   GET → { busy, engine, conversationId? }
 * A new POST while busy interrupts the running turn (warm-brain behavior kept).
 * pageContext is per-request ONLY — never persisted (C5 privacy rule).
 * CR.1 done: the /jarvis page, homepage JarvisModule and the overlay all use
 * THIS lane; /api/jarvis/brain is deprecated (kept serving for external
 * callers only).
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  ensureV2();
  return NextResponse.json(jarvisAskStatus(), { headers: NO_STORE });
}

export async function POST(req: Request) {
  ensureV2();
  let body: { text?: unknown; conversationId?: unknown; pageContext?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400, headers: NO_STORE });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 8000) : "";
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400, headers: NO_STORE });
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : undefined;
  const pageContext = sanitizePageContext(body.pageContext);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (ev: JarvisAskEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true; // client went away mid-turn — the brain finishes + persists anyway
        }
      };
      try {
        await askJarvisV2({ text, conversationId, pageContext, channel: "overlay" }, send, {
          signal: req.signal,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message.slice(0, 300) : "brain failure" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
