import { NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { subscribeSse } from "@/lib/v2/events";
import type { V2Event } from "@/lib/v2/eventTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE live event feed. `?types=a,b` filters (CONVENTIONS §5). */
export async function GET(req: NextRequest) {
  ensureV2();
  const typesCsv = req.nextUrl.searchParams.get("types");
  const types = typesCsv
    ? new Set(typesCsv.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: V2Event) => {
        if (types && !types.has(event.type)) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          /* closed */
        }
      };
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      unsubscribe = subscribeSse(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 25000);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
