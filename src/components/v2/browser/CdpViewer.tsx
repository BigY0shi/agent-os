"use client";

// E2.5 — CdpViewer (verbatim-adapt of AOC cdp-viewer.tsx per SPEC-E §4):
// Remix UI kit swapped for our Tailwind/CSS-var styling; keeps the URL-input
// focus guard, the Take Control toggle (gates ALL input forwarding), the
// non-passive wheel listener with preventDefault, and the ResizeObserver →
// debounced-150ms setViewport. Divergence: the wsUrl is NOT a prop — tickets
// are short-lived, so the viewer mints one itself on mount and Reconnect
// RE-MINTS (a new wsUrl re-runs the hook's connect effect).

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MousePointerClick, RefreshCcw } from "lucide-react";
import { useCdpScreencast } from "./useCdpScreencast";
import { BROWSER_ACCENT, inputStyle } from "./shared";

interface Props {
  /** Configured session name — the viewer mints its own ticket for it. */
  session: string;
}

export default function CdpViewer({ session }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [wsUrl, setWsUrl] = useState<string>("");
  const [ticketError, setTicketError] = useState<string | null>(null);

  // Ticket mint: on mount / session change, and again on Reconnect. Each mint
  // yields a distinct wsUrl (fresh ticket + exp), so the screencast hook's
  // effect re-runs and dials a new connection.
  const fetchTicket = useCallback(async () => {
    setTicketError(null);
    try {
      const res = await fetch("/api/v2/browser/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      const j = await res.json();
      if (!res.ok || !j?.wsUrl) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setWsUrl(j.wsUrl as string);
    } catch (e) {
      setTicketError(e instanceof Error ? e.message : String(e));
    }
  }, [session]);

  useEffect(() => {
    setWsUrl("");
    fetchTicket();
  }, [fetchTicket]);

  const {
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
  } = useCdpScreencast({ wsUrl });

  // Resize the remote Chromium viewport to match the canvas container.
  // Debounced 150ms — ResizeObserver fires per-frame during a window drag;
  // pushing every intermediate size would flood CDP with reflows.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setViewport(Math.floor(rect.width), Math.floor(rect.height), window.devicePixelRatio || 1);
    };

    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(apply, 150);
    });
    ro.observe(node);
    apply();

    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [setViewport]);

  const [hasControl, setHasControl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);
  // Track focus via onFocus/onBlur, not document.activeElement — the upstream
  // guard against the URL bar dropping focus after one typed letter.
  const isUrlFocusedRef = useRef(false);
  useEffect(() => {
    if (!isUrlFocusedRef.current) {
      setUrlInput(pageUrl);
    }
  }, [pageUrl]);

  // Take Control gates keyboard forwarding (listeners wired/unwired on the flag).
  useEffect(() => {
    if (!hasControl) return;
    const node = containerRef.current;
    if (!node) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      dispatchKey("keyDown", e);
      if (e.key.length === 1) dispatchKey("char", e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      dispatchKey("keyUp", e);
    };
    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("keyup", onKeyUp);
    node.focus();
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasControl]);

  // React's onWheel attaches passively (preventDefault is a no-op there) — the
  // page would scroll instead of the remote page. Bind non-passively so we can
  // swallow the local scroll and forward the delta.
  useEffect(() => {
    if (!hasControl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dispatchWheel(e);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasControl, canvasRef]);

  const isRunning = status === "running";
  const reconnect = () => fetchTicket(); // re-mints — tickets are single-TTL

  const iconBtn =
    "inline-flex items-center justify-center w-7 h-7 rounded-md transition disabled:opacity-40";

  return (
    <div className="relative flex h-full w-full flex-col rounded-xl overflow-hidden" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
      <form
        className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-[12px]"
        style={{ background: "var(--panel, rgba(255,255,255,0.03))", borderBottom: "1px solid var(--panel-border, #2a2436)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!isRunning) return;
          navigate(urlInput);
          urlInputRef.current?.blur();
        }}
      >
        <button type="button" className={iconBtn} title="Back" onClick={goBack} disabled={!isRunning} style={{ color: "var(--fg-dim, #9aa)" }}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className={iconBtn} title="Forward" onClick={goForward} disabled={!isRunning} style={{ color: "var(--fg-dim, #9aa)" }}>
          <ArrowRight size={14} />
        </button>
        <button type="button" className={iconBtn} title="Reload" onClick={reload} disabled={!isRunning} style={{ color: "var(--fg-dim, #9aa)" }}>
          <RefreshCcw size={14} />
        </button>

        <input
          ref={urlInputRef}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={(e) => {
            isUrlFocusedRef.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            isUrlFocusedRef.current = false;
          }}
          placeholder={isRunning ? "Enter URL or search…" : ""}
          className="h-7 flex-1 rounded-md px-2 font-mono text-[11.5px] outline-none"
          style={inputStyle}
          disabled={!isRunning}
        />

        {/* status dot */}
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          title={status}
          style={{
            background:
              status === "running" ? "#34d399" : status === "connecting" ? "#fbbf24" : "#f87171",
          }}
        />
        <span className="hidden md:inline shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {status === "connecting" && "Connecting…"}
          {status === "ended" && "Disconnected"}
          {status === "error" && (errorMsg || "Error")}
          {ticketError && `Ticket: ${ticketError}`}
        </span>

        {isRunning && (
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition"
            style={
              hasControl
                ? { background: `${BROWSER_ACCENT}22`, border: `1px solid ${BROWSER_ACCENT}66`, color: BROWSER_ACCENT }
                : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }
            }
            onClick={() => setHasControl((v) => !v)}
          >
            <MousePointerClick size={12} />
            {hasControl ? "Release" : "Take control"}
          </button>
        )}
        {(status === "ended" || status === "error" || ticketError) && (
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium"
            style={{ border: `1px solid ${BROWSER_ACCENT}66`, color: BROWSER_ACCENT }}
            onClick={reconnect}
          >
            <RefreshCcw size={12} />
            Reconnect
          </button>
        )}
      </form>

      <div
        ref={containerRef}
        tabIndex={0}
        className={`relative flex-1 overflow-hidden outline-none ${hasControl ? "cursor-crosshair" : "cursor-default"}`}
        style={{ background: "var(--panel, rgba(255,255,255,0.02))" }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onContextMenu={(e) => hasControl && e.preventDefault()}
          onMouseMove={(e) => hasControl && dispatchMouse("mouseMoved", e)}
          onMouseDown={(e) => hasControl && dispatchMouse("mousePressed", e)}
          onMouseUp={(e) => hasControl && dispatchMouse("mouseReleased", e)}
        />
        {status === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin opacity-50" style={{ color: BROWSER_ACCENT }} />
          </div>
        )}
      </div>
    </div>
  );
}
