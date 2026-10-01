"use client";

import { handleUiEvent } from "@/lib/v2/jarvis/uiClient";

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
// Answers stream from the C3 V2 brain lane: POST /api/v2/jarvis/ask
// { text, conversationId?, pageContext? } → SSE {type:"meta"|"sentence"|"tool"|
// "navigate"|"done"|"error"}. meta hands back the conversationId (threaded on
// subsequent sends), tool events render as activity lines, navigate performs a
// client-side router.push. pageContext comes from the C5 registry at SEND time
// and is per-request only (never persisted server-side).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Settings as Gear, X, Loader2, History, Plus, Archive, Paperclip, Pencil } from "lucide-react";
import type { Settings } from "@/components/ConfigMenu";
import { useVoiceCapture, providerInfo } from "@/lib/v2/jarvis/useVoiceCapture";
import { getEffectivePageContext } from "@/lib/v2/jarvis/pageContext";
import { useReadAloud } from "@/lib/v2/jarvis/useReadAloud";
import JarvisSettings, { EFFORT_OPTIONS } from "./JarvisSettings";

const ACCENT = "#22d3ee";
const DISCARD_CONFIRM_CHARS = 80;
/** S34: the overlay's current session survives a page reload (the row itself is server-side). */
const OVERLAY_SESSION_KEY = "agentos.jarvis.overlay.conversation";
const TITLE_CAP = 80;

interface SessionTurn {
  id: number;
  role: "user" | "jarvis";
  text: string;
  working?: boolean;
  /** Tool-activity lines streamed during this turn (C3 tool events). */
  tools?: string[];
  /** Human-Gate approval cards streamed during this turn. */
  approvals?: ApprovalCard[];
  /** S34: image names this user turn carried. */
  attachments?: string[];
}

/** S34: one stored image, waiting to ride the next send. */
interface PendingAttachment {
  id: string;
  name: string;
  bytes: number;
}

interface ApprovalCard {
  id: string;
  slug: string;
  tool: string;
  redactedArgs: Record<string, unknown>;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired" | "working";
  resultText?: string;
}

interface ConversationRow {
  id: string;
  title: string;
  channel: string;
  updatedAt: string;
  messageCount: number;
}

export default function ChatboxOverlay({
  open,
  onClose,
  settings,
  save,
  saving,
  resumeId,
  onResumed,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<Settings | null>;
  saving: boolean;
  /** S13: conversation to open (from the Sessions tab). Cleared via onResumed. */
  resumeId?: string | null;
  onResumed?: () => void;
}) {
  const jarvis = (settings?.jarvis ?? {}) as {
    voice?: { provider?: string; autoSend?: boolean; pushToTalk?: boolean; ttsProvider?: string };
    chat?: { defaultEffort?: string; attachmentMaxMb?: number };
  };
  const provider = jarvis.voice?.provider ?? "webspeech";
  const defaultEffort = jarvis.chat?.defaultEffort ?? "";
  const speech = useReadAloud(jarvis.voice?.ttsProvider ?? "voicebox");
  const [readReplies, setReadReplies] = useState(true);
  const readRepliesRef = useRef(readReplies);
  readRepliesRef.current = readReplies;
  const speechRef = useRef(speech);
  speechRef.current = speech;
  useEffect(() => { if (!open) speechRef.current.stop(); }, [open]);
  const autoSend = jarvis.voice?.autoSend ?? false; // C2b default OFF
  const pushToTalk = jarvis.voice?.pushToTalk ?? true;
  const autoSendRef = useRef(autoSend);
  autoSendRef.current = autoSend;

  const [value, setValue] = useState("");
  const valueRef = useRef("");
  valueRef.current = value;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const askAbortRef = useRef<AbortController | null>(null);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const router = useRouter();
  // Conversation thread for this overlay session (handed back by the meta event).
  const conversationIdRef = useRef<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // S34: the named session (null = nothing sent yet), its thinking level, one pending image.
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [effort, setEffort] = useState<string>(defaultEffort);
  const effortRef = useRef(effort);
  effortRef.current = effort;
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const attachmentRef = useRef<PendingAttachment | null>(null);
  attachmentRef.current = attachment;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // C3.6 transcript drawer state.
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
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
    speechRef.current.stop();
    valueRef.current = "";
    setValue("");
    busyRef.current = true;
    setBusy(true);
    const askAbort = new AbortController();
    askAbortRef.current = askAbort;
    const userId = ++idRef.current;
    const jId = ++idRef.current;
    // S34: the pending image rides this send and only this send.
    const pending = attachmentRef.current;
    attachmentRef.current = null;
    setAttachment(null);
    setAttachError(null);
    const firstTurn = conversationIdRef.current === null;
    setTurns((t) => [
      ...t,
      { id: userId, role: "user", text, ...(pending ? { attachments: [pending.name] } : {}) },
      { id: jId, role: "jarvis", text: "", working: true },
    ]);
    try {
      const res = await fetch("/api/v2/jarvis/ask", {
        signal: askAbort.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          conversationId: conversationIdRef.current ?? undefined,
          // C5: what the user currently sees, captured at SEND time (per-request only).
          pageContext: getEffectivePageContext() ?? undefined,
          uiControl: true,
          // S34: the session's thinking level ("" = model default) and the image ref.
          effort: effortRef.current || "",
          ...(pending ? { attachments: [{ id: pending.id, name: pending.name }] } : {}),
        }),
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
            const ev = JSON.parse(line.slice(6)) as {
              type?: string;
              text?: string;
              error?: string;
              message?: string;
              conversationId?: string;
              note?: string;
              name?: string;
              state?: string;
              summary?: string;
              route?: string;
              // Human-Gate approval event fields
              id?: string;
              slug?: string;
              tool?: string;
              redactedArgs?: Record<string, unknown>;
              expiresAt?: string;
            };
            if (await handleUiEvent(ev, (route) => router.push(route))) continue;
            if (ev.type === "meta") {
              if (ev.conversationId) {
                conversationIdRef.current = ev.conversationId;
                // S34: remember the session so a reload comes back to it; the server
                // seeds the title from the first text the same way (80 chars).
                try { window.localStorage.setItem(OVERLAY_SESSION_KEY, ev.conversationId); } catch { /* storage off */ }
                if (firstTurn) setSessionTitle((cur) => cur ?? text.slice(0, TITLE_CAP));
              }
              if (ev.note) setTurns((t) => t.map((x) => (x.id === jId ? { ...x, tools: [...(x.tools ?? []), ev.note!] } : x)));
            } else if (ev.type === "sentence" && ev.text) {
              answer += (answer ? " " : "") + ev.text;
              setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: answer } : x)));
            } else if (ev.type === "tool" && ev.name && ev.state !== "start") {
              const line = `⚙ ${ev.name}${ev.state === "error" ? " ✗" : ""}${ev.summary ? ` — ${ev.summary}` : ""}`;
              setTurns((t) => t.map((x) => (x.id === jId ? { ...x, tools: [...(x.tools ?? []), line] } : x)));
            } else if (ev.type === "approval" && ev.id && ev.tool) {
              const card: ApprovalCard = {
                id: ev.id,
                slug: ev.slug ?? "",
                tool: ev.tool,
                redactedArgs: ev.redactedArgs ?? {},
                expiresAt: ev.expiresAt ?? "",
                status: "pending",
              };
              setTurns((t) =>
                t.map((x) => (x.id === jId ? { ...x, approvals: [...(x.approvals ?? []), card] } : x)),
              );
            } else if (ev.type === "navigate" && ev.route && ev.route.startsWith("/")) {
              router.push(ev.route);
            } else if (ev.type === "error") {
              answer = answer || `⚠ ${ev.message ?? ev.error ?? "brain failure"}`;
              setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: answer } : x)));
            }
            // unknown event types are ignored (forward-compat, chunk-1 contract)
          } catch {
            /* malformed frame — skip */
          }
        }
      }
      setTurns((t) => t.map((x) => (x.id === jId ? { ...x, text: x.text || "(no reply)", working: false } : x)));
      if (readRepliesRef.current && answer) void speechRef.current.read(answer);
    } catch (e) {
      setTurns((t) =>
        t.map((x) => (x.id === jId ? { ...x, text: "Error reaching the Jarvis brain: " + String(e), working: false } : x)),
      );
    }
    busyRef.current = false;
    setBusy(false);
  }, [capture, splice, router]);

  // ── Human-Gate: resolve one approval card (Approve executes server-side) ───
  const resolveApprovalCard = useCallback(async (approvalId: string, action: "approve" | "deny") => {
    const setCard = (patch: Partial<ApprovalCard>) =>
      setTurns((t) =>
        t.map((x) =>
          x.approvals?.some((a) => a.id === approvalId)
            ? { ...x, approvals: x.approvals!.map((a) => (a.id === approvalId ? { ...a, ...patch } : a)) }
            : x,
        ),
      );
    setCard({ status: "working" });
    try {
      const res = await fetch(`/api/v2/webmcp/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as {
        approval?: { status?: string };
        result?: { ok?: boolean; output?: string; error?: string } | null;
        error?: string;
      } | null;
      if (res.status === 410) {
        setCard({ status: "expired", resultText: "expired — ask Jarvis again" });
        return;
      }
      if (!res.ok) {
        setCard({ status: "pending", resultText: data?.error ?? `failed (${res.status})` });
        return;
      }
      if (action === "deny") {
        setCard({ status: "denied", resultText: "denied — not executed" });
        return;
      }
      const r = data?.result;
      setCard({
        status: "approved",
        resultText: r?.ok
          ? (r.output || "executed").slice(0, 400)
          : `execution failed: ${(r?.error ?? "unknown error").slice(0, 300)}`,
      });
    } catch (e) {
      setCard({ status: "pending", resultText: "request failed: " + String(e) });
    }
  }, []);

  // ── C3.6 transcript drawer ─────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/v2/jarvis/conversations");
      const data = (await res.json().catch(() => null)) as { conversations?: ConversationRow[] } | null;
      setConversations(Array.isArray(data?.conversations) ? data!.conversations! : []);
    } catch {
      setConversations([]);
    }
    setHistoryBusy(false);
  }, []);

  const toggleHistory = useCallback(() => {
    setShowHistory((s) => {
      if (!s) loadConversations();
      return !s;
    });
  }, [loadConversations]);

  /** Open a past conversation: thread its id into the next ask + show its transcript.
   *  Resolves true when it loaded (S34: the reload path forgets a session that is gone). */
  const openConversation = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v2/jarvis/conversations/${id}`);
      if (!res.ok) return false;
      const data = (await res.json()) as {
        conversation?: { title?: string; effort?: string | null; archivedAt?: string | null };
        messages?: {
          role: string;
          content: string;
          toolCalls?: { name: string; summary: string; ok: boolean }[] | null;
          attachments?: { name: string }[] | null;
        }[];
      };
      // An archived session is not resumed here (S13: restore it first in Sessions).
      if (data.conversation?.archivedAt) return false;
      conversationIdRef.current = id;
      try { window.localStorage.setItem(OVERLAY_SESSION_KEY, id); } catch { /* storage off */ }
      setSessionTitle(data.conversation?.title ?? null);
      setEffort(data.conversation?.effort ?? "");
      const mapped: SessionTurn[] = (data.messages ?? []).map((m) => ({
        id: ++idRef.current,
        role: m.role === "user" ? "user" : "jarvis",
        text: m.role === "system" ? `· ${m.content}` : m.content,
        tools: m.toolCalls?.length
          ? m.toolCalls.map((tc) => `⚙ ${tc.name}${tc.ok ? "" : " ✗"}${tc.summary ? ` — ${tc.summary}` : ""}`)
          : undefined,
        attachments: m.attachments?.length ? m.attachments.map((a) => a.name) : undefined,
      }));
      setTurns(mapped);
      setShowHistory(false);
      return true;
    } catch {
      return false; /* drawer stays open on failure */
    }
  }, []);

  // S13: resume a conversation picked in the Sessions tab.
  useEffect(() => {
    if (!open || !resumeId) return;
    void openConversation(resumeId).finally(() => onResumed?.());
  }, [open, resumeId, openConversation, onResumed]);

  // S34: after a reload, come back to the session this overlay was on. The row is
  // server-side; only its id is kept in the browser. A session that is gone or
  // archived is forgotten, nothing is created.
  useEffect(() => {
    if (!open || resumeId || conversationIdRef.current) return;
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(OVERLAY_SESSION_KEY); } catch { /* storage off */ }
    if (!stored) return;
    void openConversation(stored).then((ok) => {
      if (!ok) { try { window.localStorage.removeItem(OVERLAY_SESSION_KEY); } catch { /* storage off */ } }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** S34 "New conversation": start fresh. The previous session stays listed and
   *  resumable (nothing is archived or deleted here). */
  const newConversation = useCallback(() => {
    conversationIdRef.current = null;
    try { window.localStorage.removeItem(OVERLAY_SESSION_KEY); } catch { /* storage off */ }
    setSessionTitle(null);
    setRenaming(false);
    setEffort(defaultEffort);
    setAttachment(null);
    setAttachError(null);
    setTurns([]);
    setShowHistory(false);
  }, [defaultEffort]);

  // S34: rename the current session (PATCH { title }); the Sessions tab shows the same name.
  const commitRename = useCallback(async () => {
    const id = conversationIdRef.current;
    const title = titleDraft.trim().slice(0, TITLE_CAP);
    setRenaming(false);
    if (!id || !title || title === sessionTitle) return;
    try {
      const res = await fetch(`/api/v2/jarvis/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = (await res.json().catch(() => null)) as { conversation?: { title?: string }; error?: string } | null;
      if (res.ok && data?.conversation?.title !== undefined) setSessionTitle(data.conversation.title);
      else setAttachError(`Rename failed: ${data?.error ?? res.status}`);
    } catch (e) {
      setAttachError("Rename failed: " + String(e));
    }
  }, [titleDraft, sessionTitle]);

  // S34: the session's thinking level. Saved on the row at once when the session
  // exists, otherwise it rides the first send; either way it survives a reload.
  const changeEffort = useCallback(async (next: string) => {
    setEffort(next);
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/v2/jarvis/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effort: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setAttachError(`Thinking level not saved: ${data?.error ?? res.status}`);
      }
    } catch (e) {
      setAttachError("Thinking level not saved: " + String(e));
    }
  }, []);

  // S34: store one image for the next send. The server decides by magic bytes and
  // the size cap; a refusal is shown with its reason, nothing is sent.
  const attachFile = useCallback(async (file: File) => {
    setAttachError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "image");
      const res = await fetch("/api/v2/jarvis/attachments", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | { attachment?: { id: string; name: string; bytes: number }; error?: string }
        | null;
      if (!res.ok || !data?.attachment) {
        setAttachError(`Attachment refused: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setAttachment(data.attachment);
    } catch (e) {
      setAttachError("Attachment failed: " + String(e));
    } finally {
      setUploading(false);
    }
  }, []);

  const archiveConversationRow = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/v2/jarvis/conversations/${id}`, { method: "DELETE" });
        if (conversationIdRef.current === id) newConversation();
        loadConversations();
      } catch {
        /* keep the row */
      }
    },
    [loadConversations, newConversation],
  );

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
          speech.stop();
          capture.start();
        },
        onPointerUp: () => capture.stop(), // stop ≠ send (C2b)
        onPointerLeave: () => {
          if (recording) capture.stop();
        },
      }
    : {
        onClick: () => { speech.stop(); if (recording) capture.stop(); else capture.start(); },
      };

  const providerAvail = capture.available;
  const info = providerInfo(provider);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-jarvis-chrome
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Docked, not modal (owner 2026-09-08): Jarvis navigates and operates the
          // page behind this panel, so the page must stay visible and clickable.
          // No backdrop, not announced as modal; the orb (bottom-5 right-5) stays reachable.
          className="fixed bottom-[5.25rem] right-5 z-[95] w-[min(460px,calc(100vw-2.5rem))]"
          role="dialog"
          aria-label="Jarvis"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              discard();
            }
          }}
        >
          <motion.div
            initial={{ y: 14, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.16 }}
            className="relative w-full rounded-2xl shadow-2xl overflow-hidden"
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
              {/* S34: the session's name; click the pencil to rename (saved server-side). */}
              {renaming ? (
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={TITLE_CAP}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                    if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); }
                  }}
                  onBlur={() => void commitRename()}
                  aria-label="Session name"
                  className="min-w-0 flex-1 bg-[rgba(0,0,0,0.3)] rounded px-1.5 h-6 text-[11.5px] outline-none"
                  style={{ border: `1px solid ${ACCENT}66`, color: "var(--fg, #e8e2f0)" }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { if (conversationIdRef.current) { setTitleDraft(sessionTitle ?? ""); setRenaming(true); } }}
                  disabled={!conversationIdRef.current}
                  title={conversationIdRef.current ? "Rename this session" : "Send a message first; the first words name the session"}
                  className="min-w-0 flex-1 inline-flex items-center gap-1 text-[11.5px] truncate text-left disabled:cursor-default"
                  style={{ color: "var(--fg-dim, #9aa)" }}
                >
                  <span className="truncate">{sessionTitle || (conversationIdRef.current ? "(untitled)" : "new conversation")}</span>
                  {conversationIdRef.current && <Pencil size={10} className="shrink-0 opacity-60" />}
                </button>
              )}
              {recording && (
                <span className="text-[10.5px] px-1.5 py-0.5 rounded animate-pulse" style={{ background: `${ACCENT}22`, color: ACCENT }}>
                  listening…
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {busy && <button type="button" onClick={() => { askAbortRef.current?.abort(); speech.stop(); }}
                  className="text-[11px] px-2 py-1 rounded hover:bg-white/5">Stop actions</button>}
                <button type="button" aria-pressed={readReplies}
                  onClick={() => { setReadReplies(v => !v); speech.stop(); }}
                  className="text-[11px] px-2 py-1 rounded hover:bg-white/5">
                  {readReplies ? "Voice on" : "Voice off"}
                </button>
                {speech.speaking && <button type="button" onClick={speech.stop}
                  className="text-[11px] px-2 py-1 rounded hover:bg-white/5">Stop reading</button>}
                <button
                  onClick={toggleHistory}
                  title="Conversation history"
                  className="p-1.5 rounded-lg transition hover:bg-white/5"
                  style={{ color: showHistory ? ACCENT : "var(--fg-dimmer, #6b6478)" }}
                >
                  <History size={14} />
                </button>
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
            {speech.error && <p role="alert" className="px-4 py-2 text-sm text-red-300">Read aloud failed: {speech.error}</p>}
            {speech.spokeVia && (
              <p role="status" className="px-4 py-1.5 text-[11.5px]" style={{ color: "#fbbf24" }}>
                {speech.spokeVia.fellBackFrom} failed{speech.spokeVia.reason ? ` (${speech.spokeVia.reason.slice(0, 140)})` : ""}; {speech.spokeVia.provider} is speaking instead.
              </p>
            )}

            {/* C3.6 conversation drawer */}
            {showHistory && (
              <div className="px-4 py-3 max-h-[260px] overflow-y-auto" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    Conversations
                  </span>
                  {historyBusy && <Loader2 size={11} className="animate-spin" style={{ color: ACCENT }} />}
                  <button
                    onClick={newConversation}
                    className="ml-auto inline-flex items-center gap-1 px-2 h-6 rounded-lg text-[11px] transition hover:bg-white/5"
                    style={{ border: `1px solid ${ACCENT}55`, color: ACCENT }}
                  >
                    <Plus size={11} /> New conversation
                  </button>
                </div>
                {conversations.length === 0 && !historyBusy && (
                  <div className="text-[11.5px] py-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    No conversations yet.
                  </div>
                )}
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition hover:bg-white/5"
                    style={c.id === conversationIdRef.current ? { background: `${ACCENT}11` } : undefined}
                    onClick={() => openConversation(c.id)}
                  >
                    <span className="flex-1 truncate text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                      {c.title || "(untitled)"}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      {c.messageCount} msg · {c.updatedAt?.slice(0, 10)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        archiveConversationRow(c.id);
                      }}
                      title="Archive conversation (never deleted)"
                      className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition hover:bg-white/10"
                      style={{ color: "var(--fg-dimmer, #6b6478)" }}
                    >
                      <Archive size={11} />
                    </button>
                  </div>
                ))}
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
                      {t.attachments?.map((name, i) => (
                        <span key={`a${i}`} className="block text-[11px] font-mono" style={{ color: ACCENT }}>
                          <Paperclip size={10} className="inline mr-1" />{name}
                        </span>
                      ))}
                      {t.tools?.map((line, i) => (
                        <span key={i} className="block text-[11px] font-mono" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                          {line}
                        </span>
                      ))}
                      {t.approvals?.map((a) => (
                        <span
                          key={a.id}
                          className="block my-1.5 px-2.5 py-2 rounded-lg text-[11.5px]"
                          style={{ border: "1px solid #fbbf2466", background: "#fbbf2410" }}
                        >
                          <span className="block font-semibold" style={{ color: "#fbbf24" }}>
                            Approval needed: {a.slug === "registry" ? a.tool : `${a.slug}/${a.tool}`}
                          </span>
                          <span className="block font-mono text-[10.5px] mt-0.5 break-all" style={{ color: "var(--fg-dim, #9aa)" }}>
                            {JSON.stringify(a.redactedArgs).slice(0, 300)}
                          </span>
                          {a.status === "pending" || a.status === "working" ? (
                            <span className="mt-1.5 flex items-center gap-2">
                              <button
                                onClick={() => resolveApprovalCard(a.id, "approve")}
                                disabled={a.status === "working"}
                                className="px-2.5 h-6 rounded-lg text-[11px] font-medium transition disabled:opacity-40"
                                style={{ border: "1px solid #34d39966", background: "#34d39918", color: "#34d399" }}
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => resolveApprovalCard(a.id, "deny")}
                                disabled={a.status === "working"}
                                className="px-2.5 h-6 rounded-lg text-[11px] font-medium transition disabled:opacity-40"
                                style={{ border: "1px solid #f8717166", background: "#f8717118", color: "#f87171" }}
                              >
                                Deny
                              </button>
                              {a.status === "working" && <Loader2 size={11} className="animate-spin" style={{ color: "#fbbf24" }} />}
                              {a.resultText && (
                                <span className="text-[10.5px]" style={{ color: "#fbbf24" }}>{a.resultText}</span>
                              )}
                            </span>
                          ) : (
                            <span
                              className="block mt-1 text-[11px]"
                              style={{ color: a.status === "approved" ? "#34d399" : a.status === "denied" ? "#f87171" : "#9ca3af" }}
                            >
                              {a.status === "approved" ? "✓ approved" : a.status === "denied" ? "✗ denied" : "expired"}
                              {a.resultText ? ` — ${a.resultText}` : ""}
                            </span>
                          )}
                        </span>
                      ))}
                      {t.text || (t.working ? "…" : "")}
                      {t.working && <Loader2 size={11} className="inline ml-1 animate-spin" style={{ color: ACCENT }} />}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* editable capture buffer */}
            <div className="p-4">
              {/* S34: the pending image and any refusal, above the text box so neither is missed. */}
              {attachment && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2 h-6 rounded-lg text-[11px] font-mono" style={{ border: `1px solid ${ACCENT}55`, color: ACCENT }}>
                  <Paperclip size={10} />
                  <span className="truncate max-w-[220px]">{attachment.name}</span>
                  <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>{(attachment.bytes / 1024).toFixed(0)} KB</span>
                  <button type="button" onClick={() => { setAttachment(null); setAttachError(null); }} title="Remove the attachment" aria-label="Remove the attachment" className="ml-0.5 rounded hover:bg-white/10">
                    <X size={10} />
                  </button>
                </div>
              )}
              {attachError && (
                <p role="alert" className="mb-2 text-[11.5px]" style={{ color: "#f87171" }}>{attachError}</p>
              )}
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
                onPaste={(e) => {
                  // S34: a pasted image (screenshot) becomes the pending attachment; text pastes as usual.
                  const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
                  if (f) { e.preventDefault(); void attachFile(f); }
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
                {/* S34: attach one image (png/jpeg/webp, checked by bytes; cap in the gear). */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void attachFile(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || uploading}
                  title={attachment ? `Attached: ${attachment.name} (replace)` : "Attach an image (png, jpeg, webp); or paste one into the text box"}
                  aria-label="Attach an image"
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl transition disabled:opacity-35"
                  style={{
                    border: `1px solid ${attachment ? ACCENT : "var(--panel-border, #2a2436)"}`,
                    background: attachment ? `${ACCENT}22` : "var(--panel, rgba(255,255,255,0.02))",
                    color: attachment ? ACCENT : "var(--fg-dim, #9aa)",
                  }}
                >
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                </button>
                {capture.error && (
                  <span className="text-[11.5px]" style={{ color: "#fbbf24" }}>{capture.error}</span>
                )}
                {/* S34: the session's thinking level; saved on the session, so it survives a reload. */}
                <select
                  value={effort}
                  onChange={(e) => void changeEffort(e.target.value)}
                  disabled={busy}
                  aria-label="Thinking effort for this session"
                  title="Thinking effort for this session (saved on the session). The gear sets the default for new ones."
                  className="ml-auto h-7 rounded-lg px-1.5 text-[10.5px] font-mono outline-none bg-[rgba(0,0,0,0.3)]"
                  style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
                >
                  {EFFORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>think: {o.id || "default"}</option>
                  ))}
                </select>
                <span className="text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  ⏎ sends{autoSend ? " · auto-send ON" : ""}
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
