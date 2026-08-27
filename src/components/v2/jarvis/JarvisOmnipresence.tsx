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

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useSettings } from "@/components/ConfigMenu";
import ChatboxOverlay from "./ChatboxOverlay";

const ACCENT = "#22d3ee";
const DEDUPE_MS = 400;
const TITLE_FLASH = "◉ Jarvis — Agent OS";

export default function JarvisOmnipresence() {
  const pathname = usePathname();
  const { settings, save, saving } = useSettings();
  const [open, setOpen] = useState(false);
  const [brainBusy, setBrainBusy] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  const hotkeyCfg = ((settings?.jarvis ?? {}) as { hotkey?: { key?: string; enabled?: boolean } }).hotkey ?? {};
  const hotkeyKey = hotkeyCfg.key ?? "F13";
  const hotkeyEnabled = hotkeyCfg.enabled ?? true;
  const hotkeyKeyRef = useRef(hotkeyKey);
  hotkeyKeyRef.current = hotkeyKey;
  const hotkeyEnabledRef = useRef(hotkeyEnabled);
  hotkeyEnabledRef.current = hotkeyEnabled;

  const lastLocalFireRef = useRef(0);
  const lastSseFireRef = useRef(0);
  const titleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRestoreRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      es.onmessage = () => {
        const now = Date.now();
        lastSseFireRef.current = now;
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
  }, [pathname, frontSelf, openOverlay]);

  // ── In-app fallback keybind (works when a tab is focused, helper or not) ───
  useEffect(() => {
    if (pathname === "/login") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hotkeyEnabledRef.current) return;
      if (e.key !== hotkeyKeyRef.current) return;
      const now = Date.now();
      // 400 ms dedupe against both a rapid repeat and the helper's SSE echo.
      if (now - lastLocalFireRef.current < DEDUPE_MS) return;
      if (now - lastSseFireRef.current < DEDUPE_MS) return;
      lastLocalFireRef.current = now;
      e.preventDefault();
      openOverlay();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname, openOverlay]);

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

  // ── Orb status glow from the warm brain ────────────────────────────────────
  const pollBrain = useCallback(async () => {
    try {
      const r = await fetch("/api/jarvis/brain", { cache: "no-store" });
      const j = await r.json();
      setBrainBusy(!!j?.busy);
    } catch {
      /* orb just stays idle-colored */
    }
  }, []);
  usePollWhileVisible(pollBrain, 5000, []);

  if (pathname === "/login") return null;

  const glow = brainBusy ? "#fbbf24" : ACCENT;

  return (
    <>
      {/* floating orb — unobtrusive, above page chrome, below the overlay */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setOpen((o) => !o)}
        title={`Jarvis — click or press ${hotkeyKey}`}
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

      <ChatboxOverlay open={open} onClose={() => setOpen(false)} settings={settings} save={save} saving={saving} />
    </>
  );
}
