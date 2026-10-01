import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { askJarvisV2, jarvisAskStatus, type JarvisAskEvent } from "@/lib/v2/jarvis/brain";
import { sanitizePageContext } from "@/lib/v2/jarvis/context";
import { requestUi } from "@/lib/v2/jarvis/uiRequests";
import { parseEffort, JARVIS_EFFORTS, type JarvisAttachmentRef } from "@/lib/v2/jarvis/conversations";

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
  let body: {
    text?: unknown;
    conversationId?: unknown;
    pageContext?: unknown;
    uiControl?: unknown;
    effort?: unknown;
    attachments?: unknown;
  };
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
  // S34: effort absent = leave the session's own; "" or null = model default; else one of the levels.
  let effort: ReturnType<typeof parseEffort> = undefined;
  if (body.effort !== undefined) {
    effort = parseEffort(body.effort);
    if (effort === undefined) {
      return NextResponse.json({ error: `effort must be one of ${JARVIS_EFFORTS.join(", ")} or empty` }, { status: 400, headers: NO_STORE });
    }
  }
  // S34: attachment refs from POST /api/v2/jarvis/attachments (ids; names are display only).
  let attachments: JarvisAttachmentRef[] | undefined;
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) {
      return NextResponse.json({ error: "attachments must be an array of { id, name? }" }, { status: 400, headers: NO_STORE });
    }
    attachments = [];
    for (const a of body.attachments as unknown[]) {
      const id = typeof a === "string" ? a : a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string" ? (a as { id: string }).id : "";
      if (!id.trim()) return NextResponse.json({ error: "attachment needs an id" }, { status: 400, headers: NO_STORE });
      const name = a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string" ? (a as { name: string }).name : "";
      attachments.push({ id: id.trim(), name, mime: "image/png", bytes: 0 }); // mime/bytes re-read from disk by the brain
    }
    if (attachments.length > 1) {
      return NextResponse.json({ error: "one image per message" }, { status: 400, headers: NO_STORE });
    }
  }

  const enc = new TextEncoder();
  const uiAbort = new AbortController();
  const onAbort = () => uiAbort.abort();
  req.signal.addEventListener("abort", onAbort, { once: true });
  if (req.signal.aborted) uiAbort.abort();
  const stream = new ReadableStream({
    cancel() { uiAbort.abort(); },
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
        await askJarvisV2({ text, conversationId, pageContext, channel: "overlay", effort, attachments,
          uiRequest: body.uiControl === true ? (command) => requestUi(command, send, uiAbort.signal) : undefined,
        }, send, {
          signal: req.signal,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message.slice(0, 300) : "brain failure" });
      } finally {
        uiAbort.abort();
        req.signal.removeEventListener("abort", onAbort);
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
