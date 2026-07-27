import { subscribe } from "@/lib/ptySessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/terminal/stream?id=<session> → Server-Sent Events carrying shell output.
//
// Each chunk is JSON-encoded rather than sent raw: SSE frames are newline-delimited,
// and terminal output is full of newlines and ANSI control bytes that would otherwise
// split a single chunk across frames and corrupt the escape sequences.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const encoder = new TextEncoder();

  let off: (() => void) | null = null;
  let backlog = "";
  try {
    // Attach BEFORE the stream starts so nothing emitted between now and the first
    // enqueue is lost.
    const sub = subscribe(id, (chunk) => push(chunk));
    off = sub.off;
    backlog = sub.backlog;
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const pending: string[] = [];

  function frame(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function push(chunk: string) {
    // Output can arrive before start() runs; queue it rather than drop it.
    if (!controller) { pending.push(chunk); return; }
    if (closed) return;
    try { controller.enqueue(frame("out", chunk)); } catch { closed = true; }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (backlog) c.enqueue(frame("out", backlog));
      for (const chunk of pending.splice(0)) c.enqueue(frame("out", chunk));

      // Comment-only keepalive. Without traffic an idle shell's connection gets
      // reaped by the browser or an intermediary, and the terminal silently stops
      // updating with no visible error.
      const ping = setInterval(() => {
        if (closed) return;
        try { c.enqueue(encoder.encode(": ping\n\n")); } catch { closed = true; }
      }, 20_000);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        off?.();
        try { c.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", shutdown, { once: true });
    },
    cancel() {
      closed = true;
      off?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Belt and braces for any reverse proxy that would otherwise buffer SSE.
      "X-Accel-Buffering": "no",
    },
  });
}
