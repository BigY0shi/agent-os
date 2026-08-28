import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getStatusSnapshot, subscribeStatus, type AgentStatusEvent } from "@/lib/v2/agents/statusFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const HEARTBEAT_MS = 25_000;

/**
 * GET /api/v2/agents/status — SPEC-E F2.2.
 *
 * SSE: a `snapshot` event on connect, then `event` frames on every status
 * change (via statusFeed → the Fd2 bus), with a comment heartbeat every 25s.
 * `?once=1` returns the JSON snapshot instead — the client's poll fallback
 * when SSE drops.
 */
export async function GET(req: NextRequest) {
  ensureV2();

  if (req.nextUrl.searchParams.get("once")) {
    try {
      const agents = await getStatusSnapshot();
      return NextResponse.json({ agents }, noStore);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ agents: [], error: message }, { status: 500, ...noStore });
    }
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const agents = await getStatusSnapshot();
        send({ type: "snapshot", agents });
      } catch (err) {
        send({ type: "snapshot", agents: [], error: err instanceof Error ? err.message : String(err) });
      }

      unsubscribe = subscribeStatus((ev: AgentStatusEvent) => {
        send({ type: "event", ...ev });
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
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
