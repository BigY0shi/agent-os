/**
 * E2.4 — minimal Chrome DevTools Protocol client over a WebSocket (VERBATIM
 * port of AOC apps/webapp cdp-client.ts per SPEC-E §4). Adds id-based
 * request/response correlation and per-sessionId event subscriptions on top of
 * the raw WS connection.
 *
 * Divergence from upstream: buildCdpWsUrl is GONE — the wsUrl comes from
 * POST /api/v2/browser/ticket (ws://<host>:<wsPort>/cdp/<session>?ticket=…),
 * minted per connection because tickets are short-lived.
 *
 * `CdpClient` is intentionally framework-agnostic — the React layer drives it
 * through `useCdpScreencast`.
 */

export type CdpListener = (method: string, params: unknown) => void;

interface CdpResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}
interface CdpEvent {
  method: string;
  params: unknown;
  sessionId?: string;
}

export class CdpClient {
  private nextId = 1;
  private pending = new Map<
    number,
    (msg: { result?: unknown; error?: { message: string } }) => void
  >();
  /**
   * Keyed by `sessionId` from `Target.attachToTarget {flatten: true}`.
   * Empty string ("") routes browser-level events.
   */
  private listeners = new Map<string, Set<CdpListener>>();

  constructor(private ws: WebSocket) {
    // Default `binaryType` is "blob" in browsers — but the bridge relays CDP
    // frames as TEXT, so `event.data` should be a string. We still pin
    // `arraybuffer` so any binary frame can be decoded synchronously rather
    // than via the async `Blob.text()` API.
    try {
      ws.binaryType = "arraybuffer";
    } catch {
      /* not all environments allow setting after construction */
    }
    ws.addEventListener("message", (e) => this.onMessage(e));
  }

  private async onMessage(e: MessageEvent): Promise<void> {
    let data: string;
    if (typeof e.data === "string") {
      data = e.data;
    } else if (e.data instanceof ArrayBuffer) {
      data = new TextDecoder().decode(e.data);
    } else if (typeof Blob !== "undefined" && e.data instanceof Blob) {
      data = await e.data.text();
    } else {
      console.warn("[cdp-viewer] dropped frame with unsupported type", typeof e.data);
      return;
    }

    let msg: CdpResponse | CdpEvent;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if ("id" in msg && typeof msg.id === "number") {
      const r = this.pending.get(msg.id);
      if (r) {
        this.pending.delete(msg.id);
        r({ result: msg.result, error: msg.error });
      }
      return;
    }

    const evt = msg as CdpEvent;
    const sid = evt.sessionId ?? "";
    const subs = this.listeners.get(sid);
    if (subs) {
      for (const sub of subs) sub(evt.method, evt.params);
    }
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId++;
    const frame = JSON.stringify({ id, method, params, sessionId });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result as T);
      });
      this.ws.send(frame);
    });
  }

  on(sessionId: string, listener: CdpListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }
}

/** Bitmask matching CDP's `Input.dispatchKeyEvent.modifiers` field. */
export function eventModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (e.altKey ? 1 : 0) |
    (e.ctrlKey ? 2 : 0) |
    (e.metaKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0)
  );
}
