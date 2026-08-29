"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CdpClient, eventModifiers } from "./cdpClient";

/**
 * E2.4 — VERBATIM port of AOC use-cdp-screencast.ts (SPEC-E §4): attach flow,
 * JPEG q70 everyNthFrame 2, frame ack with the FRAME's own sessionId (§8 risk
 * 3 — ack with the Target sessionId and Chromium stops shipping frames),
 * rawKeyDown for printables, deltaMode wheel scaling,
 * Emulation.setDeviceMetricsOverride replay, Page.getNavigationHistory
 * back/fwd, omnibox URL coercion. Divergences: console tracing dropped; the
 * Mac editor-command mapping is KEPT (harmless) and Ctrl variants ADDED for
 * this Windows box.
 */

export type ScreencastStatus = "connecting" | "running" | "ended" | "error";

interface ScreencastFrameMetadata {
  offsetTop?: number;
  pageScaleFactor?: number;
  deviceWidth?: number;
  deviceHeight?: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  timestamp?: number;
}
interface ScreencastFrameParams {
  data: string; // base64 jpeg
  sessionId: number; // CDP screencast frame ack id (different from Target sessionId)
  metadata: ScreencastFrameMetadata;
}

interface Options {
  wsUrl: string;
  /** Format quality 0-100. JPEG only — the screencast is fixed to JPEG
   *  because PNG ignores quality and produces 5–10x larger frames per tick,
   *  which dominates bandwidth and decode cost on the screencast hot path. */
  quality?: number;
  /** Max frame width Chromium ships (lower = lower bandwidth). */
  maxWidth?: number;
}

export interface ScreencastApi {
  status: ScreencastStatus;
  errorMsg: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  pageUrl: string;
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  dispatchMouse: (
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    e: React.MouseEvent<HTMLCanvasElement>,
  ) => void;
  dispatchWheel: (e: WheelEvent) => void;
  dispatchKey: (type: "keyDown" | "keyUp" | "char", e: KeyboardEvent) => void;
  setViewport: (width: number, height: number, dpr: number) => void;
}

interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

interface NavigationHistoryEntry {
  id: number;
  url: string;
  title: string;
  transitionType: string;
}
interface NavigationHistory {
  currentIndex: number;
  entries: NavigationHistoryEntry[];
}

interface KeyEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Map a keydown to Blink editor commands so editor shortcuts work inside the
 * screencast. AppKit/Win32 normally translate these before the renderer sees
 * them; under CDP we attach the commands explicitly. Names come from Blink's
 * `EditorCommandNames`. The shift-modified variants extend the selection.
 * Upstream shipped the Mac (meta/alt) table; the Ctrl table is our Windows
 * addition (SPEC-E §4 "keep the Mac mapping, add Ctrl variants").
 */
function editorCommands(e: KeyEventLike): string[] {
  const sel = e.shiftKey ? "AndModifySelection" : "";
  if (e.metaKey && !e.ctrlKey && !e.altKey) {
    switch (e.key) {
      case "Backspace":
        return ["DeleteToBeginningOfLine"];
      case "Delete":
        return ["DeleteToEndOfLine"];
      case "ArrowLeft":
        return [`MoveToBeginningOfLine${sel}`];
      case "ArrowRight":
        return [`MoveToEndOfLine${sel}`];
      case "ArrowUp":
        return [`MoveToBeginningOfDocument${sel}`];
      case "ArrowDown":
        return [`MoveToEndOfDocument${sel}`];
    }
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    switch (e.key) {
      case "Backspace":
        return ["DeleteWordBackward"];
      case "Delete":
        return ["DeleteWordForward"];
      case "ArrowLeft":
        return [`MoveWordLeft${sel}`];
      case "ArrowRight":
        return [`MoveWordRight${sel}`];
    }
  }
  // Windows/Linux Ctrl variants (our addition — this box is win32).
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    switch (e.key) {
      case "Backspace":
        return ["DeleteWordBackward"];
      case "Delete":
        return ["DeleteWordForward"];
      case "ArrowLeft":
        return [`MoveWordLeft${sel}`];
      case "ArrowRight":
        return [`MoveWordRight${sel}`];
      case "Home":
        return [`MoveToBeginningOfDocument${sel}`];
      case "End":
        return [`MoveToEndOfDocument${sel}`];
    }
  }
  return [];
}

/**
 * Connect to Chrome DevTools Protocol over the ticket-authed bridge WS and
 * stream `Page.screencastFrame` images into a canvas. Also exposes
 * mouse/keyboard dispatch helpers for "Take control".
 *
 * Flow on each connect:
 *   1. Open WebSocket → wrap with `CdpClient`.
 *   2. `Target.setDiscoverTargets` + `Target.getTargets` to find the page.
 *   3. `Target.attachToTarget {flatten:true}` → per-page `sessionId`.
 *   4. Subscribe to `Page.screencastFrame` events on that sessionId.
 *   5. `Page.startScreencast` — Chromium begins emitting frames.
 *   6. Each frame must be ack'd via `Page.screencastFrameAck` (with the
 *      FRAME's sessionId) or Chromium throttles future frames.
 */
export function useCdpScreencast({ wsUrl, quality = 70, maxWidth = 1280 }: Options): ScreencastApi {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cdpRef = useRef<CdpClient | null>(null);
  const pageSessionRef = useRef<string>("");
  // Latest desired Chromium viewport. Populated by `setViewport` (typically
  // from a ResizeObserver in the consumer) and replayed on every attach so
  // the remote page always renders at the host container's exact size.
  const viewportRef = useRef<Viewport | null>(null);

  const [status, setStatus] = useState<ScreencastStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pageUrl, setPageUrl] = useState<string>("");

  useEffect(() => {
    if (!wsUrl) return;
    let cancelled = false;
    setStatus("connecting");
    setErrorMsg("");

    const ws = new WebSocket(wsUrl);
    const cdp = new CdpClient(ws);
    cdpRef.current = cdp;

    ws.addEventListener("error", () => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg("Connection error");
    });
    ws.addEventListener("close", (e) => {
      if (cancelled) return;
      if (e.code === 4400) {
        setStatus("error");
        setErrorMsg("Ticket expired or invalid — Reconnect to mint a fresh one");
        return;
      }
      if (e.code === 4404) {
        setStatus("error");
        setErrorMsg("Session is not running — Launch it first");
        return;
      }
      if (e.code === 4502) {
        setStatus("error");
        setErrorMsg("Upstream CDP error — relaunch the session");
        return;
      }
      setStatus((s) => (s === "error" ? s : "ended"));
    });

    ws.addEventListener("open", async () => {
      // Bail if React already cleaned this effect up (StrictMode double-
      // mount, prop change). Avoids opening Chromium targets we abandon.
      if (cancelled) return;
      try {
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        const { targetInfos } = await cdp.send<{
          targetInfos: Array<{ targetId: string; type: string; url?: string }>;
        }>("Target.getTargets");
        const pageTarget = targetInfos.find((t) => t.type === "page");
        if (!pageTarget) throw new Error("no page target found");

        const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
          targetId: pageTarget.targetId,
          flatten: true,
        });
        pageSessionRef.current = sessionId;

        // Page domain for navigation events — Page.frameNavigated keeps the
        // address bar in sync with agent/user navigation.
        await cdp.send("Page.enable", {}, sessionId);
        if (pageTarget.url && !cancelled) setPageUrl(pageTarget.url);
        cdp.on(sessionId, (method, params) => {
          if (method !== "Page.frameNavigated") return;
          const p = params as { frame: { id: string; parentId?: string; url: string } };
          // Only the top-level frame's URL belongs in the address bar.
          if (!p.frame.parentId && !cancelled) setPageUrl(p.frame.url);
        });

        // Wire frame listener BEFORE startScreencast — Chromium can emit the
        // first frame synchronously.
        cdp.on(sessionId, (method, params) => {
          if (method !== "Page.screencastFrame") return;
          const p = params as ScreencastFrameParams;
          // Ack FIRST — with the FRAME's own sessionId — so Chromium keeps
          // shipping frames (§8 risk 3).
          cdp
            .send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId)
            .catch(() => {
              /* swallow */
            });

          const canvas = canvasRef.current;
          if (!canvas) return;
          // Decode off the main thread via createImageBitmap (no data-URL
          // detour — base64 → bytes → Blob → bitmap).
          const bin = atob(p.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: "image/jpeg" });
          createImageBitmap(blob)
            .then((bm) => {
              if (cancelled) {
                bm.close();
                return;
              }
              const c = canvasRef.current;
              if (!c) {
                bm.close();
                return;
              }
              if (c.width !== bm.width || c.height !== bm.height) {
                c.width = bm.width;
                c.height = bm.height;
              }
              const ctx = c.getContext("2d");
              if (ctx) ctx.drawImage(bm, 0, 0);
              bm.close();
            })
            .catch(() => {
              /* swallow — corrupt frame; the next ack pulls a fresh one */
            });
        });

        // Apply any viewport the consumer set before the connection was
        // ready — first frame renders at the right size instead of flashing
        // the default 1280-wide frame and then resizing.
        const v = viewportRef.current;
        if (v) {
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false },
            sessionId,
          );
        }

        await cdp.send(
          "Page.startScreencast",
          {
            format: "jpeg",
            quality,
            maxWidth: v ? Math.ceil(v.width * v.dpr) : maxWidth,
            maxHeight: v ? Math.ceil(v.height * v.dpr) : maxWidth * 2,
            // Half the frames at the same perceived smoothness — bandwidth
            // and decode cost scale linearly with frame rate.
            everyNthFrame: 2,
          },
          sessionId,
        );

        if (!cancelled) setStatus("running");
      } catch (err) {
        if (cancelled) return;
        console.error("[cdp-viewer] CDP setup failed", err);
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      cancelled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [wsUrl, quality, maxWidth]);

  /**
   * Coerce a user-typed value into a navigable URL (omnibox behavior). Bare
   * hostnames get https://; anything else falls back to a Google search.
   */
  const coerceUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    // Looks domain-ish: contains a dot, no spaces.
    if (/^[^\s/]+\.[^\s/]+/i.test(trimmed) && !trimmed.includes(" ")) {
      return `https://${trimmed}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  };

  const navigate: ScreencastApi["navigate"] = (url) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    const target = coerceUrl(url);
    if (!target) return;
    cdp.send("Page.navigate", { url: target }, sid).catch(() => {
      /* swallow — nav errors surface via Page.frameNavigated anyway */
    });
  };

  const reload: ScreencastApi["reload"] = () => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    cdp.send("Page.reload", {}, sid).catch(() => {});
  };

  /**
   * CDP has no `Page.goBack` — grab the navigation history and step
   * `currentIndex ± 1` via `Page.navigateToHistoryEntry`.
   */
  const stepHistory = async (delta: -1 | 1): Promise<void> => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    try {
      const hist = await cdp.send<NavigationHistory>("Page.getNavigationHistory", {}, sid);
      const target = hist.entries[hist.currentIndex + delta];
      if (!target) return;
      await cdp.send("Page.navigateToHistoryEntry", { entryId: target.id }, sid);
    } catch {
      /* swallow */
    }
  };

  const goBack: ScreencastApi["goBack"] = () => {
    void stepHistory(-1);
  };
  const goForward: ScreencastApi["goForward"] = () => {
    void stepHistory(1);
  };

  const dispatchMouse: ScreencastApi["dispatchMouse"] = (type, e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    const canvas = canvasRef.current;
    if (!cdp || !sid || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    cdp
      .send(
        "Input.dispatchMouseEvent",
        {
          type,
          x,
          y,
          button: type === "mouseMoved" ? "none" : e.button === 2 ? "right" : "left",
          clickCount: type === "mouseReleased" || type === "mousePressed" ? 1 : 0,
          modifiers: eventModifiers(e),
        },
        sid,
      )
      .catch(() => {
        /* swallow */
      });
  };

  const dispatchWheel: ScreencastApi["dispatchWheel"] = (e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    const canvas = canvasRef.current;
    if (!cdp || !sid || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // CDP wants pixel deltas. WheelEvent.deltaMode 0 = pixel (passthrough),
    // 1 = line (~16px), 2 = page (rare; approximate against viewport).
    const lineHeight = 16;
    const pageHeight = rect.height || 800;
    const factor = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? pageHeight : 1;
    const deltaX = e.deltaX * factor;
    const deltaY = e.deltaY * factor;

    cdp
      .send(
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x, y, deltaX, deltaY, modifiers: eventModifiers(e) },
        sid,
      )
      .catch(() => {
        /* swallow */
      });
  };

  const setViewport = useCallback<ScreencastApi["setViewport"]>(
    (width, height, dpr) => {
      const dprSafe = dpr > 0 ? dpr : 1;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      const prev = viewportRef.current;
      if (prev && prev.width === w && prev.height === h && prev.dpr === dprSafe) {
        return;
      }
      viewportRef.current = { width: w, height: h, dpr: dprSafe };

      const cdp = cdpRef.current;
      const sid = pageSessionRef.current;
      if (!cdp || !sid) return; // not attached yet — applied on next connect.

      cdp
        .send(
          "Emulation.setDeviceMetricsOverride",
          { width: w, height: h, deviceScaleFactor: dprSafe, mobile: false },
          sid,
        )
        .catch(() => {
          /* swallow — next resize retries */
        });

      // Re-issue the screencast at matching pixel dimensions so frames come
      // through at native resolution. CDP accepts repeated startScreencast
      // calls; the previous stream is replaced by the new params.
      cdp
        .send(
          "Page.startScreencast",
          {
            format: "jpeg",
            quality,
            maxWidth: Math.ceil(w * dprSafe),
            maxHeight: Math.ceil(h * dprSafe),
            everyNthFrame: 2,
          },
          sid,
        )
        .catch(() => {
          /* swallow */
        });
    },
    [quality],
  );

  const dispatchKey: ScreencastApi["dispatchKey"] = (type, e) => {
    const cdp = cdpRef.current;
    const sid = pageSessionRef.current;
    if (!cdp || !sid) return;
    const isPrintable = e.key.length === 1;
    // CDP's `keyDown` auto-inserts text when the `text` field is set, so a
    // follow-up `char` would insert the character twice. `rawKeyDown` for
    // printable keys fires keydown without insertion; the paired `char`
    // dispatch handles the actual text input.
    const cdpType = type === "keyDown" && isPrintable ? "rawKeyDown" : type;
    const params: Record<string, unknown> = {
      type: cdpType,
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      modifiers: eventModifiers(e),
    };
    if (isPrintable) params.text = e.key;
    if (type === "keyDown") {
      const commands = editorCommands(e);
      if (commands.length > 0) params.commands = commands;
    }
    cdp.send("Input.dispatchKeyEvent", params, sid).catch(() => {
      /* swallow */
    });
  };

  return {
    status,
    errorMsg,
    canvasRef,
    pageUrl,
    navigate,
    goBack,
    goForward,
    reload,
    dispatchMouse,
    dispatchWheel,
    dispatchKey,
    setViewport,
  };
}
