"use client";

// SPEC-C C1 — the Jarvis omnipresence shell, mounted in src/app/layout.tsx so
// it exists on EVERY route (hidden on /login):
//   · floating orb (bottom-right) whose glow tracks the warm brain's status
//   · the C2b ChatboxOverlay, opened by orb click, the OS-global F13 helper
//     (SSE push from /api/jarvis/hotkey/stream), the in-app fallback keybind,
//     or a ?jarvis=1 URL param (the helper's zero-subscriber new-tab path)
//   · SSE consumer with auto-reconnect; on a hotkey event the page fronts
//     itself (window.focus + title flash) and opens the overlay
//   · local-vs-SSE dedupe (400 ms both directions) so one press = one open
//     when the helper AND the focused tab both see the key (upstream
//     global+local monitor duality, applied app-side per SPEC-C C1.5).
//
// S38 push-to-talk: in "hold" mode (jarvis.hotkey.mode, the default) the key
// is a hold. Key DOWN (helper "down" over SSE, or the in-app keydown when the
// tab has focus) fronts the page, opens the overlay and raises `pttHeld`; key
// UP lowers it. ChatboxOverlay turns that flag into mic start / stop (+ send
// when jarvis.hotkey.sendOnRelease is on). Both directions are idempotent, so
// the helper and the focused tab seeing the same hold is harmless. "open" mode
// keeps the pre-S38 single "press" that only opens the chat.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useSettings } from "@/components/ConfigMenu";
import { setBaselinePageContext } from "@/lib/v2/jarvis/pageContext";
import ChatboxOverlay from "./ChatboxOverlay";
import { RESUME_EVENT, type ResumeDetail } from "@/lib/v2/jarvis/resume";

const ACCENT = "#22d3ee";
const DEDUPE_MS = 400;
const TITLE_FLASH = "◉ Jarvis — Agent OS";

type HotkeyMode = "hold" | "open";
type PttSource = "hotkey" | "keybind";

export default function JarvisOmnipresence() {
  const pathname = usePathname();
  const { settings, save, saving } = useSettings();
  const [open, setOpen] = useState(false);
  // S13: a Sessions-tab "resume in overlay" names the conversation to open.
  const [resumeId, setResumeId] = useState<string | null>(null);
  useEffect(() => {
    const onResume = (e: Event) => {
      const id = (e as CustomEvent<ResumeDetail>).detail?.id;
      if (typeof id === "string" && id) { setResumeId(id); setOpen(true); }
    };
    window.addEventListener(RESUME_EVENT, onResume);
    return () => window.removeEventListener(RESUME_EVENT, onResume);
  }, []);
  const [brainBusy, setBrainBusy] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  const hotkeyCfg = ((settings?.jarvis ?? {}) as { hotkey?: { key?: string; enabled?: boolean; mode?: HotkeyMode } }).hotkey ?? {};
  const hotkeyKey = hotkeyCfg.key ?? "F13";
  const hotkeyEnabled = hotkeyCfg.enabled ?? true;
  const hotkeyMode: HotkeyMode = hotkeyCfg.mode === "open" ? "open" : "hold";
  const hotkeyKeyRef = useRef(hotkeyKey);
  hotkeyKeyRef.current = hotkeyKey;
  const hotkeyEnabledRef = useRef(hotkeyEnabled);
  hotkeyEnabledRef.current = hotkeyEnabled;
  const hotkeyModeRef = useRef(hotkeyMode);
  hotkeyModeRef.current = hotkeyMode;

  const lastLocalFireRef = useRef(0);
  const lastSseFireRef = useRef(0);
  const titleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRestoreRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // S38 push-to-talk state. The ref is the truth (idempotent down/up from two
  // sources); the state is what the overlay renders from.
  const [pttHeld, setPttHeld] = useState(false);
  const pttHeldRef = useRef(false);
  const pttSourceRef = useRef<PttSource | null>(null);

  // Front the page: focus + a short title flash so the tab is findable even
  // when the browser refuses programmatic focus.
  const frontSelf = useCallback(() => {
    try {
      window.focus();
    } catch {
      /* browsers may refuse — title flash still lands */
    }
    if (titleTimerRef.current) clearInterval(titleTimerRef.current);
    if (titleRestoreRef.current) clearTimeout(titleRestoreRef.current);
    const original = document.title.startsWith("◉") ? "Agentic OS — Mission Control" : document.title;
    let flip = false;
    titleTimerRef.current = setInterval(() => {
      flip = !flip;
      document.title = flip ? TITLE_FLASH : original;
    }, 400);
    titleRestoreRef.current = setTimeout(() => {
      if (titleTimerRef.current) clearInterval(titleTimerRef.current);
      titleTimerRef.current = null;
      document.title = original;
    }, 2400);
  }, []);

  const openOverlay = useCallback(() => setOpen(true), []);

  const pttDown = useCallback((source: PttSource) => {
    if (pttHeldRef.current) return; // already held (the other source saw it first, or key autorepeat)
    pttHeldRef.current = true;
    pttSourceRef.current = source;
    setPttHeld(true);
    setOpen(true);
  }, []);
  const pttUp = useCallback(() => {
    if (!pttHeldRef.current) return;
    pttHeldRef.current = false;
    pttSourceRef.current = null;
    setPttHeld(false);
  }, []);

  // ── OS-global path: SSE from the hotkey helper (auto-reconnect) ────────────
  useEffect(() => {
    if (pathname === "/login") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        es = new EventSource("/api/jarvis/hotkey/stream");
      } catch {
        retry = setTimeout(connect, 5000);
        return;
      }
      es.onmessage = (msg: MessageEvent<string>) => {
        let action = "press";
        try {
          const ev = JSON.parse(msg.data) as { action?: string };
          if (typeof ev?.action === "string") action = ev.action;
        } catch {
          /* pre-S38 helper: a bare event is a press */
        }
        const now = Date.now();
        lastSseFireRef.current = now;
        if (hotkeyModeRef.current === "hold" && action === "down") {
          // The page may be a background window: front it BEFORE the mic
          // starts, so the browser treats the capture as foreground.
          frontSelf();
          pttDown("hotkey");
          return;
        }
        if (hotkeyModeRef.current === "hold" && action === "up") {
          pttUp();
          return;
        }
        if (action === "up") return; // "open" mode ignores releases
        // Dedupe: the focused tab's local keydown already handled this press.
        if (now - lastLocalFireRef.current < DEDUPE_MS) return;
        frontSelf();
        openOverlay();
      };
      es.onerror = () => {
        // EventSource retries transient failures itself; a CLOSED stream
        // (auth loss, server restart) needs a manual re-create.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          if (!disposed) retry = setTimeout(connect, 5000);
        }
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      es?.close();
      if (titleTimerRef.current) clearInterval(titleTimerRef.current);
      if (titleRestoreRef.current) clearTimeout(titleRestoreRef.current);
    };
  }, [pathname, frontSelf, openOverlay, pttDown, pttUp]);

  // ── In-app fallback keybind (works when a tab is focused, helper or not) ───
  useEffect(() => {
    if (pathname === "/login") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hotkeyEnabledRef.current) return;
      if (e.key !== hotkeyKeyRef.current) return;
      e.preventDefault();
      if (hotkeyModeRef.current === "hold") {
        if (e.repeat) return; // one hold = one down
        lastLocalFireRef.current = Date.now();
        pttDown("keybind");
        return;
      }
      const now = Date.now();
      // 400 ms dedupe against both a rapid repeat and the helper's SSE echo.
      if (now - lastLocalFireRef.current < DEDUPE_MS) return;
      if (now - lastSseFireRef.current < DEDUPE_MS) return;
      lastLocalFireRef.current = now;
      openOverlay();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (hotkeyModeRef.current !== "hold") return;
      if (e.key !== hotkeyKeyRef.current) return;
      e.preventDefault();
      pttUp();
    };
    // A keybind hold whose keyup never arrives (the tab lost focus mid-hold)
    // must not record forever. A helper-driven hold is left alone: the
    // helper's "up" ends it.
    const onBlur = () => {
      if (pttSourceRef.current === "keybind") pttUp();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [pathname, openOverlay, pttDown, pttUp]);

  // ── C5 baseline page context: every route gets at least {route, title} ─────
  useEffect(() => {
    if (pathname === "/login") {
      setBaselinePageContext(null);
      return;
    }
    setBaselinePageContext({ route: pathname ?? "/", title: document.title });
  }, [pathname]);

  // ── ?jarvis=1 (the helper's zero-subscriber new-tab path) ──────────────────
  useEffect(() => {
    if (pathname === "/login") return;
    try {
      if (new URLSearchParams(window.location.search).get("jarvis") === "1" && !openRef.current) {
        openOverlay();
      }
    } catch {
      /* no window */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ── Orb status glow from the V2 ask lane (busy field kept per chunk-1 handoff) ─
  const pollBrain = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/jarvis/ask", { cache: "no-store" });
      const j = await r.json();
      setBrainBusy(!!j?.busy);
    } catch {
      /* orb just stays idle-colored */
    }
  }, []);
  usePollWhileVisible(pollBrain, 5000, []);

  if (pathname === "/login") return null;

  const glow = brainBusy ? "#fbbf24" : ACCENT;
  const orbHint = hotkeyMode === "hold" ? `click, or hold ${hotkeyKey} to talk` : `click or press ${hotkeyKey}`;

  return (
    <>
      {/* floating orb — unobtrusive, above page chrome, below the overlay */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setOpen((o) => !o)}
        title={`Jarvis — ${orbHint}`}
        aria-label="Open Jarvis"
        className="fixed bottom-5 right-5 z-[90] w-12 h-12 rounded-full flex items-center justify-center transition-transform hover:scale-105"
        style={{
          background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.14), rgba(0,0,0,0.55))",
          border: `1px solid ${glow}66`,
          boxShadow: `0 0 18px ${glow}44, inset 0 0 10px ${glow}22`,
        }}
      >
        <span
          className={brainBusy ? "animate-pulse" : ""}
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${glow} 0%, ${glow}55 60%, transparent 100%)`,
            boxShadow: `0 0 10px ${glow}`,
            display: "block",
          }}
        />
      </motion.button>

      <ChatboxOverlay
        open={open}
        onClose={() => setOpen(false)}
        settings={settings}
        save={save}
        saving={saving}
        resumeId={resumeId}
        onResumed={() => setResumeId(null)}
        pttHeld={pttHeld}
      />
    </>
  );
}
