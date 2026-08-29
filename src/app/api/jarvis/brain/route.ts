import { NextResponse } from "next/server";
import { askJarvis, brainStatus, resetBrain } from "@/lib/jarvisBrain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠ DEPRECATED (SPEC-C CR.1, 2026-08-27): the V1 warm Jarvis brain endpoint.
// Superseded by POST /api/v2/jarvis/ask (persona-loaded, tool-wielding,
// conversation-persisted; SSE superset — sentence/done/error unchanged,
// meta/tool/navigate additive). Every in-repo caller has been repointed
// (ChatboxOverlay chunk 3; JarvisModule + JarvisView in CR.1) — as of CR.1
// nothing in src/ fetches this route. KEPT SERVING deliberately: external
// scripts/bookmarks may still hit it. Exile only once confirmed unused
// (grep "/api/jarvis/brain" first — do not delete, exile per house rule).
//   POST { utterance } → SSE stream: {type:"sentence",text} … {type:"done",costUsd,turns}
//   GET                → { warm, busy, turns, model, uptimeMs }
//   DELETE             → tear the session down (fresh conversation next ask)

export async function GET() {
  return NextResponse.json(brainStatus());
}

export async function DELETE() {
  await resetBrain();
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  let body: { utterance?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const utterance = typeof body.utterance === "string" ? body.utterance.trim().slice(0, 8000) : "";
  if (!utterance) return NextResponse.json({ error: "missing utterance" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        for await (const ev of askJarvis(utterance)) send(ev);
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message.slice(0, 300) : "brain failure" });
      }
      controller.close();
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
