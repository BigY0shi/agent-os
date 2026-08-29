import { NextRequest } from "next/server";
import { subscribeHotkey, type HotkeyEvent } from "@/lib/v2/jarvis/hotkeyBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPEC-C C2 (C1.3) — SSE push of hotkey events to connected JarvisOmnipresence
// clients. Cookie-authed (NO proxy exemption — only the POST endpoint is
// exempt). Tracks ITS OWN subscriber count via hotkeyBus (globalThis) so the
// helper's POST can report it; heartbeat comment every 25s keeps proxies from
// closing the pipe.

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: HotkeyEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* closed */
        }
      };
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      unsubscribe = subscribeHotkey(send);
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
