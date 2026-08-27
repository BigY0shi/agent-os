"use client";

// SPEC-C C2b — the chatbox-first capture overlay. THE normative contract
// (MASTER-PLAN §2 C2b, stated twice by Yoshi):
//   1. Overlay opens → textarea focused, mic NOT hot.
//   2. Mic press/hold → live transcript INSERTS AT CURSOR into the EDITABLE
//      textarea (interim text is spliced in and continuously replaced;
//      finalized chunks become permanent text at the cursor).
//   3. Mic release / stop ENDS RECORDING BUT NEVER SENDS. User edits, types,
//      re-records (appends at cursor).
//   4. Enter (no shift) or the Send button submits. That is the ONLY dispatch —
//      sendBuffer() is reachable ONLY from the Enter keydown, the Send onClick,
//      and the settings-gated autoSend branch below.
//   5. Esc discards the draft (confirm when > 80 chars) and closes.
//   6. settings.jarvis.voice.autoSend === true (default FALSE) → release
//      additionally sends the non-empty buffer — the ONLY auto-send path,
//      replicating the old behavior for those who want it.
//
// Answers stream from the EXISTING warm-brain lane: POST /api/jarvis/brain
// { utterance } → SSE {type:"sentence"|"done"|"error"} (the C3 brain replaces
// internals next chunk; the request shape is deliberately reused unchanged).

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Settings as Gear, X, Loader2 } from "lucide-react";
import type { Settings } from "@/components/ConfigMenu";
import { useVoiceCapture, providerInfo } from "@/lib/v2/jarvis/useVoiceCapture";
import JarvisSettings from "./JarvisSettings";

const ACCENT = "#22d3ee";
const DISCARD_CONFIRM_CHARS = 80;

interface SessionTurn {
  id: number;
  role: "user" | "jarvis";
  text: string;
  working?: boolean;
}

export default function ChatboxOverlay({
  open,
  onClose,
  settings,
  save,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<Settings | null>;
  saving: boolean;
}) {
  const jarvis = (settings?.jarvis ?? {}) as {
    voice?: { provider?: string; autoSend?: boolean; pushToTalk?: boolean };
  };
  const provider = jarvis.voice?.provider ?? "webspeech";
  const autoSend = jarvis.voice?.autoSend ?? false; // C2b default OFF
  const pushToTalk = jarvis.voice?.pushToTalk ?? true;
  const autoSendRef = useRef(autoSend);
  autoSendRef.current = autoSend;

  const [value, setValue] = useState("");
  const valueRef = useRef("");
  valueRef.current = value;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const idRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The live interim transcript occupies this range inside the textarea value;
  // it is re-spliced on every partial update and solidified by final chunks.
  const partialRangeRef = useRef<{ start: number; end: number } | null>(null);
  // Suppresses the autoSend branch when recording ends via discard/cancel.
  const suppressAutoSendRef = useRef(false);

  /** Splice text into the buffer, restoring the caret after React re-renders. */
  const splice = useCallback((start: number, end: number, text: string) => {
    const cur = valueRef.current;
    const next = cur.slice(0, start) + text + cur.slice(end);
    valueRef.current = next;
    setValue(next);
    const caret = start + text.length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        try {
          ta.selectionStart = caret;
          ta.selectionEnd = caret;
        } catch {
          /* detached */
        }
      }
    });
    return caret;
  }, []);

  const caretPos = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return valueRef.current.length;
    return ta.selectionStart ?? valueRef.current.length;
  }, []);

  // Finalized chunk → permanent text at the cursor (replaces the interim ghost).
  // Note: NO send happens here — insertion only (C2b step 3).
  const onFinalChunk = useCallback(
    (text: string) => {
      const range = partialRangeRef.current ?? { start: caretPos(), end: caretPos() };
      partialRangeRef.current = null;
      const cur = valueRef.current;
      const needsLead = range.start > 0 && !/\s$/.test(cur.slice(0, range.start));
      splice(range.start, range.end, (needsLead ? " " : "") + text + " ");
    },
    [caretPos, splice],
  );

  const capture = useVoiceCapture({ provider, onFinalChunk });
  const { status: captureStatus, partial } = capture;

  // Interim transcript → spliced at the cursor, continuously replaced. (A plain
  // textarea can't style a sub-range gray, so the ghost is live-replaced text;
  // the "listening" pill signals that it is still provisional.)
  useEffect(() => {
    if (!open) return;
    const range = partialRangeRef.current;
    if (partial) {
      const r = range ?? { start: caretPos(), end: caretPos() };
      const cur = valueRef.current;
      const lead = r.start > 0 && !/\s$/.test(cur.slice(0, r.start)) ? " " : "";
      const text = lead + partial;
      splice(r.start, r.end, text);
      partialRangeRef.current = { start: r.start, end: r.start + text.length };
    } else if (range) {
      // Interim cleared without a final (e.g. recognizer restart) — drop the ghost.
      splice(range.start, range.end, "");
      partialRangeRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partial, open]);

  // ── Send (the ONLY dispatch paths call this — see file header) ─────────────
  const sendBuffer = useCallback(async () => {
    // Solidify: strip a live interim ghost before reading the buffer.
    const range = partialRangeRef.current;
    if (range) {
      splice(range.start, range.end, "");
      partialRangeRef.current = null;
    }
    if (capture.status === "recording") {
      suppressAutoSendRef.current = true;
      capture.cancel();
    }
    const text = valueRef.current.trim();
    if (!text || busyRef.current) return;
    valueRef.current = "";
    setValue("");
    busyRef.current = true;
    setBusy(true);
    const userId = ++idRef.current;
    const jId = ++idRef.current;
    setTurns((t) => [...t, { id: userId, role: "user", text }, { id: jId, role: "jarvis", text: "", working: true }]);
    try {
      const res = await fetch("/api/jarvis/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text }),
      });
      if (!res.ok || !res.body) throw new Error(`brain ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bufferText = "";
      let answer = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bufferText += decoder.decode(chunk, { stream: true });
        const frames = bufferText.split("\n\n");
        bufferText = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type?: string; text?: string; error?: string };
            if (ev.type === "sentence" && ev.text) {
              answer += (answer ? " " : "") + ev.text;
              setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: answer } : x)));
            } else if (ev.type === "error") {
              answer = answer || `⚠ ${ev.error ?? "brain failure"}`;
              setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: answer } : x)));
            }
          } catch {
            /* malformed frame — skip */
          }
        }
      }
      setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: x.text || "(no reply)", working: false } : x)));
    } catch (e) {
      setTurns((t) =>
        t.map((x) => (x.id === jId ? { ...x, text: "Error reaching the Jarvis brain: " + String(e), working: false } : x)),
      );
    }
    busyRef.current = false;
    setBusy(false);
  }, [capture, splice]);

  // ── C2b step 6: the ONLY auto-send path — gated on the settings toggle ─────
  const prevCaptureStatusRef = useRef(captureStatus);
  useEffect(() => {
    const prev = prevCaptureStatusRef.current;
    prevCaptureStatusRef.current = captureStatus;
    if (prev === "recording" && captureStatus === "idle") {
      if (suppressAutoSendRef.current) {
        suppressAutoSendRef.current = false;
        return;
      }
      if (autoSendRef.current) sendBuffer(); // autoSend ON (non-default) → release sends
    }
  }, [captureStatus, sendBuffer]);

  // ── Discard (Esc) ──────────────────────────────────────────────────────────
  const discard = useCallback(() => {
    if (valueRef.current.trim().length > DISCARD_CONFIRM_CHARS) {
      if (!window.confirm("Discard this draft?")) return;
    }
    suppressAutoSendRef.current = true;
    capture.cancel();
    partialRangeRef.current = null;
    valueRef.current = "";
    setValue("");
    onClose();
  }, [capture, onClose]);

  // Autofocus on open; reset transient state on close.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    suppressAutoSendRef.current = true;
    capture.cancel();
    setShowSettings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Mic button behavior (hold vs toggle per settings) ──────────────────────
  const recording = captureStatus === "recording";
  const micHold = pushToTalk;
  const micProps = micHold
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          capture.start();
        },
        onPointerUp: () => capture.stop(), // stop ≠ send (C2b)
        onPointerLeave: () => {
          if (recording) capture.stop();
        },
      }
    : {
        onClick: () => (recording ? capture.stop() : capture.start()),
      };

  const providerAvail = capture.available;
  const info = providerInfo(provider);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-start justify-center pt-[12vh] px-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              discard();
            }
          }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={discard} />
          <motion.div
            initial={{ y: -14, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.16 }}
            className="relative w-full max-w-[640px] rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "var(--bg, #0b0713)", border: `1px solid ${ACCENT}44` }}
          >
            {/* header */}
            <div className="flex items-center gap-2 px-4 h-11" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: busy ? "#fbbf24" : recording ? ACCENT : "#34d399" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>Jarvis</span>
              <span
                className="text-[10.5px] font-mono px-1.5 py-0.5 rounded"
                style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
                title={providerAvail === true ? info.label : String(providerAvail)}
              >
                {info.label}
              </span>
              {recording && (
                <span className="text-[10.5px] px-1.5 py-0.5 rounded animate-pulse" style={{ background: `${ACCENT}22`, color: ACCENT }}>
                  listening…
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => setShowSettings((s) => !s)}
                  title="Jarvis settings"
                  className="p-1.5 rounded-lg transition hover:bg-white/5"
                  style={{ color: showSettings ? ACCENT : "var(--fg-dimmer, #6b6478)" }}
                >
                  <Gear size={14} />
                </button>
                <button onClick={discard} title="Discard + close (Esc)" className="p-1.5 rounded-lg transition hover:bg-white/5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  <X size={15} />
                </button>
              </div>
            </div>

            {showSettings && (
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
                <JarvisSettings settings={settings} save={save} saving={saving} />
              </div>
            )}

            {/* session transcript (this overlay session only) */}
            {turns.length > 0 && (
              <div className="px-4 pt-3 max-h-[240px] overflow-y-auto space-y-2">
                {turns.map((t) => (
                  <div key={t.id} className="flex gap-2 text-[12.5px] leading-relaxed">
                    <span className="shrink-0 font-mono text-[10.5px] mt-[2px] w-[44px] text-right" style={{ color: t.role === "user" ? "var(--fg-dimmer, #6b6478)" : ACCENT }}>
                      {t.role === "user" ? "you" : "jarvis"}
                    </span>
                    <span style={{ color: t.role === "user" ? "var(--fg-dim, #9aa)" : "var(--fg, #e8e2f0)" }}>
                      {t.text || (t.working ? "…" : "")}
                      {t.working && <Loader2 size={11} className="inline ml-1 animate-spin" style={{ color: ACCENT }} />}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* editable capture buffer */}
            <div className="p-4">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  // Manual edits invalidate the interim splice range.
                  partialRangeRef.current = null;
                  valueRef.current = e.target.value;
                  setValue(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendBuffer(); // explicit Enter dispatch (C2b step 4)
                  }
                }}
                rows={3}
                placeholder="Speak (mic) or type — review, edit, then Enter to send. Esc discards."
                className="w-full resize-none bg-[rgba(0,0,0,0.3)] rounded-xl px-3.5 py-3 text-[14px] leading-relaxed outline-none"
                style={{
                  border: `1px solid ${recording ? ACCENT + "88" : "var(--panel-border, #2a2436)"}`,
                  color: "var(--fg, #e8e2f0)",
                }}
              />

              {/* footer */}
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  {...micProps}
                  disabled={providerAvail !== true}
                  title={
                    providerAvail !== true
                      ? String(providerAvail)
                      : micHold
                        ? "Hold to talk — release stops recording (nothing is sent)"
                        : "Click to start/stop recording (nothing is sent on stop)"
                  }
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl transition disabled:opacity-35 disabled:cursor-not-allowed select-none"
                  style={{
                    border: `1px solid ${recording ? ACCENT : "var(--panel-border, #2a2436)"}`,
                    background: recording ? `${ACCENT}22` : "var(--panel, rgba(255,255,255,0.02))",
                    color: recording ? ACCENT : "var(--fg-dim, #9aa)",
                  }}
                >
                  <Mic size={16} className={recording ? "animate-pulse" : ""} />
                </button>
                {capture.error && (
                  <span className="text-[11.5px]" style={{ color: "#fbbf24" }}>{capture.error}</span>
                )}
                <span className="ml-auto text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  Esc discards · ⏎ sends{autoSend ? " · auto-send ON" : ""}
                </span>
                <button
                  onClick={() => sendBuffer()}
                  disabled={busy || !value.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl text-[12.5px] font-medium transition disabled:opacity-30"
                  style={{ border: `1px solid ${ACCENT}66`, background: `${ACCENT}18`, color: ACCENT }}
                >
                  <Send size={13} /> Send
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
