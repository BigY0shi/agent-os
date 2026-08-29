import type { WebSocketServer, WebSocket as WsSocket } from "ws";
import { readSettings } from "../../settings";
import { verifyTicket } from "./tickets";
import { getSessionCdpInfo } from "./manager";

/**
 * E2.2 — the CDP WS bridge. Next 16 route handlers cannot host a WebSocket
 * upgrade (§8 risk 1), so this is a SECOND in-process ws.Server on
 * settings.browser.wsPort (default 3738), started from the V2 boot path
 * (boot.ts ensureV2 → ensureBrowserWs). Same Node process ⇒ it sees
 * globalThis.__agentosBrowser (the live session map).
 *
 * Path: /cdp/<session>?ticket=<t>  →  verify ticket (close 4400) →
 * getSessionCdpInfo (close 4404) → dial the captured browser-level CDP ws and
 * relay both directions.
 *
 * THE FOUR MANDATORY MECHANICS (§8 risk 3 — regressions here look like
 * "blank viewer" or "Chromium closes instantly"; check these first):
 *  1. every relayed frame is normalized to a UTF-8 STRING and sent as a TEXT
 *     frame (Chromium closes the socket on a binary frame against CDP);
 *  2. client frames arriving before the upstream socket opens are BUFFERED and
 *     flushed in order on 'open' (the viewer sends Target.setDiscoverTargets
 *     immediately);
 *  3. close codes are sanitized — only 1000 / 3000-4999 are sendable; the
 *     receive-only codes (1005/1006/1015…) become 1000;
 *  4. 25s ping timers run on BOTH hops and are cleared on close (keeps LAN
 *     middleboxes from idling the socket out mid-screencast).
 * Upstream error mid-stream → client closed 4502.
 *
 * Bind: 127.0.0.1 unless settings.browser.wsBind === 'lan' (CONVENTIONS §9.2);
 * the LAN firewall one-liner lives in NOTES-E-F.md and the BrowserSettings gear.
 * wsPort 0 is honored as "ephemeral" (smokes use it — NEVER 3738, Yoshi's live
 * app may be running).
 */

const PING_MS = 25_000;

interface BridgeState {
  wss: WebSocketServer;
  /** Actual bound port (resolves wsPort 0 → the ephemeral pick). */
  port: number;
  /** The settings values the server was created from (for change detection). */
  configuredPort: number;
  bind: "local" | "lan";
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosBrowserWss: BridgeState | undefined;
}

/** Sendable close codes only (mechanic 3). */
export function sanitizeCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

/** Normalize any ws frame payload to a UTF-8 string (mechanic 1). */
export function frameToText(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
}

function handleConnection(client: WsSocket, reqUrl: string, WsCtor: typeof import("ws").WebSocket): void {
  let session = "";
  let ticket = "";
  try {
    const url = new URL(reqUrl || "/", "http://bridge.local");
    const m = url.pathname.match(/^\/cdp\/([A-Za-z0-9_-]+)$/);
    session = m?.[1] ?? "";
    ticket = url.searchParams.get("ticket") ?? "";
  } catch {
    /* fall through to 4400 */
  }

  if (!session || !verifyTicket(ticket, session)) {
    client.close(4400, "bad or expired ticket");
    return;
  }
  const info = getSessionCdpInfo(session);
  if (!info) {
    client.close(4404, `browser session "${session}" is not running`);
    return;
  }

  const upstream = new WsCtor(info.wsEndpoint, { perMessageDeflate: false });

  // Mechanic 4: 25s heartbeats both directions, cleared on close.
  const clientPing = setInterval(() => {
    if (client.readyState === client.OPEN) client.ping();
  }, PING_MS);
  const upstreamPing = setInterval(() => {
    if (upstream.readyState === upstream.OPEN) upstream.ping();
  }, PING_MS);

  let closed = false;
  const closeBoth = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearInterval(clientPing);
    clearInterval(upstreamPing);
    const safe = sanitizeCloseCode(code);
    try {
      client.close(safe, reason);
    } catch {
      /* already closing */
    }
    try {
      upstream.close(safe, reason);
    } catch {
      /* already closing */
    }
  };

  // Mechanic 2: buffer client frames until upstream opens, then flush IN ORDER.
  const queue: string[] = [];
  let upstreamReady = false;

  client.on("message", (data) => {
    const frame = frameToText(data);
    if (upstreamReady && upstream.readyState === upstream.OPEN) {
      upstream.send(frame);
    } else {
      queue.push(frame);
    }
  });

  upstream.on("open", () => {
    upstreamReady = true;
    for (const frame of queue) {
      if (upstream.readyState === upstream.OPEN) upstream.send(frame);
    }
    queue.length = 0;
    upstream.on("message", (data) => {
      const frame = frameToText(data);
      if (client.readyState === client.OPEN) client.send(frame);
    });
  });

  upstream.on("close", (code, reason) => closeBoth(code, reason?.toString() ?? ""));
  client.on("close", (code, reason) => closeBoth(code, reason?.toString() ?? ""));

  upstream.on("error", (err) => {
    console.warn(`[browser/ws] upstream CDP error (session "${session}"):`, err?.message ?? err);
    closeBoth(4502, "upstream cdp error");
  });
  client.on("error", () => closeBoth(1011, "client error"));
}

/**
 * Idempotent: one ws.Server per process on globalThis. Re-creates the server
 * when settings.browser.wsPort / wsBind changed since the last ensure (next
 * dev restarts recreate it anyway; live viewers reconnect via the viewer's
 * Reconnect button, which re-mints a ticket). Never throws — a port collision
 * logs the exact conflict loudly and leaves the bridge down (§8 risk 1a).
 */
export async function ensureBrowserWs(): Promise<BridgeState | null> {
  const browser = readSettings().browser ?? {};
  const configuredPort = typeof browser.wsPort === "number" ? browser.wsPort : 3738;
  const bind: "local" | "lan" = browser.wsBind === "lan" ? "lan" : "local";

  const existing = globalThis.__agentosBrowserWss;
  if (existing) {
    if (existing.configuredPort === configuredPort && existing.bind === bind) return existing;
    // Settings changed — close the old server and re-listen.
    try {
      existing.wss.close();
    } catch {
      /* already down */
    }
    globalThis.__agentosBrowserWss = undefined;
  }

  const { WebSocketServer, WebSocket } = await import("ws");
  const host = bind === "lan" ? "0.0.0.0" : "127.0.0.1";

  return new Promise((resolve) => {
    let settled = false;
    const wss = new WebSocketServer({ port: configuredPort, host, perMessageDeflate: false });

    wss.on("connection", (client, req) => {
      handleConnection(client as unknown as WsSocket, req.url ?? "/", WebSocket);
    });

    wss.on("listening", () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : configuredPort;
      const state: BridgeState = { wss, port, configuredPort, bind };
      globalThis.__agentosBrowserWss = state;
      console.log(`[browser/ws] CDP bridge listening on ${host}:${port} (bind: ${bind})`);
      if (!settled) {
        settled = true;
        resolve(state);
      }
    });

    wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE") {
        console.error(
          `[browser/ws] PORT CONFLICT: ${host}:${configuredPort} is already in use — the CDP live view is DOWN. ` +
            `Change settings.browser.wsPort in the /browser gear (or free the port) and reload.`,
        );
      } else {
        console.error("[browser/ws] bridge server error:", err);
      }
      try {
        wss.close();
      } catch {
        /* noop */
      }
      if (globalThis.__agentosBrowserWss?.wss === wss) globalThis.__agentosBrowserWss = undefined;
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
  });
}

/** Actual bound port info for the ticket route (null while the bridge is down). */
export function getBrowserWsInfo(): { port: number; bind: "local" | "lan" } | null {
  const s = globalThis.__agentosBrowserWss;
  return s ? { port: s.port, bind: s.bind } : null;
}

/** Smoke-test hygiene: close the server so nothing squats the port. */
export function stopBrowserWs(): void {
  const s = globalThis.__agentosBrowserWss;
  if (!s) return;
  try {
    for (const client of s.wss.clients) {
      try {
        client.close(1000, "bridge shutdown");
      } catch {
        /* noop */
      }
    }
    s.wss.close();
  } catch {
    /* noop */
  }
  globalThis.__agentosBrowserWss = undefined;
}
