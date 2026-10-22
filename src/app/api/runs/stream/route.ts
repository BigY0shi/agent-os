import { listModuleRuns, subscribeModuleRuns, type ModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/runs/stream — SSE for the RunsTray.
 *
 * A `snapshot` frame on connect (the current list), then one `run` frame per
 * change carrying the whole run row, and a comment heartbeat every 25 s. Same
 * shape as /api/v2/agents/status; the tray falls back to polling /api/runs
 * when the stream drops.
 */
export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (data: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      };
      send({ type: "snapshot", runs: listModuleRuns({ limit: 60 }) });
      unsubscribe = subscribeModuleRuns((run: ModuleRun) => send({ type: "run", run }));
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: hb\n\n`)); } catch { cleanup(); }
      }, HEARTBEAT_MS);
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
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
