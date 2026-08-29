"use client";

// ── CaptureBox (SPEC-F I3.3) ────────────────────────────────────────────────
// The three capture shapes the POST /api/anynotes contract accepts — exactly
// one of url | text | imageBase64 — behind one box:
//   · URL field + Capture button
//   · paste an image (clipboard items) or drop a file anywhere on the box
//   · expandable plain-text note area
// Plus the Opera bookmarklet modal (no extension build — SPEC-F I2).
//
// The 422 is a SUCCESS with a warning (chunk-1 handoff): the degraded
// link-only note IS saved, so the card must appear AND the extraction failure
// must be said out loud (rule 11 — never a silent half-capture).

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Copy, Check, Link2, Loader2, Plus, X } from "lucide-react";
import { inputStyle, panelStyle } from "../integrations/shared";
import { ANYNOTES_ACCENT } from "./shared";

interface Props {
  /** Called after any successful capture (200 or 422) so the list refreshes. */
  onCaptured: (noteId: string) => void;
  /** Auto-capture handed in from the ?capture= bookmarklet param. */
  pendingCapture?: string | null;
  /** Cleared by the parent once the auto-capture has been consumed. */
  onPendingConsumed?: () => void;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // mirrors capture.ts MAX_IMAGE_BYTES

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read the image file"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      // data:image/png;base64,XXXX → XXXX (the route also tolerates the prefix,
      // but sending the bare payload keeps the request smaller and explicit).
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export default function CaptureBox({ onCaptured, pendingCapture, onPendingConsumed }: Props) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bookmarklet, setBookmarklet] = useState(false);
  const consumed = useRef<string | null>(null);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      setWarning(null);
      try {
        const res = await fetch("/api/anynotes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await res.json().catch(() => null)) as
          | { note?: { id: string }; error?: string }
          | null;
        if (res.status === 422 && j?.note) {
          // Saved, but degraded — say so, and still surface the card.
          setWarning(j.error ?? "extraction failed — saved as a link-only note");
          onCaptured(j.note.id);
          return true;
        }
        if (!res.ok || !j?.note) {
          setError(j?.error ?? `capture failed (${res.status})`);
          return false;
        }
        onCaptured(j.note.id);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onCaptured],
  );

  // ?capture=<url> from the bookmarklet — fire exactly once per value (the ref
  // guard survives the re-render the capture itself triggers).
  useEffect(() => {
    if (!pendingCapture || consumed.current === pendingCapture) return;
    consumed.current = pendingCapture;
    void post({ url: pendingCapture }).finally(() => onPendingConsumed?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCapture]);

  async function captureImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(`${file.name || "that file"} is not an image — AnyNotes captures png/jpg/webp`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`${file.name || "image"} is ${(file.size / 1_048_576).toFixed(1)} MB — the cap is 20 MB`);
      return;
    }
    try {
      const imageBase64 = await readAsBase64(file);
      await post({ imageBase64, imageName: file.name || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const image = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
    if (!image) return; // plain text keeps its normal paste behavior
    const file = image.getAsFile();
    if (!file) return;
    e.preventDefault();
    void captureImage(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void captureImage(file);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = `javascript:window.open('${origin}/anynotes?capture='+encodeURIComponent(location.href))`;

  return (
    <div
      onPaste={onPaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="rounded-xl p-3.5 mb-4 transition"
      style={{
        ...panelStyle,
        borderColor: dragging ? ANYNOTES_ACCENT : "var(--panel-border, #2a2436)",
        background: dragging ? `${ANYNOTES_ACCENT}0e` : panelStyle.background,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Link2 size={14} style={{ color: ANYNOTES_ACCENT }} className="shrink-0" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !busy) {
                void post({ url: url.trim() }).then((ok) => ok && setUrl(""));
              }
            }}
            placeholder="Paste a tweet, article or video URL — or paste/drop an image anywhere in this box"
            className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
            style={inputStyle}
          />
        </div>
        <button
          onClick={() => void post({ url: url.trim() }).then((ok) => ok && setUrl(""))}
          disabled={busy || !url.trim()}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
          style={{ background: ANYNOTES_ACCENT, color: "#241703" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} Capture
        </button>
        <button
          onClick={() => setTextOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px]"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          <Plus size={13} /> Note
        </button>
        <button
          onClick={() => setBookmarklet(true)}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px]"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          <Bookmark size={13} /> Bookmarklet
        </button>
      </div>

      {textOpen && (
        <div className="mt-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Plain-text note — the first line becomes the title."
            className="w-full text-[12.5px] rounded-md px-2.5 py-2 outline-none resize-y"
            style={inputStyle}
          />
          <div className="flex justify-end mt-1.5">
            <button
              onClick={() =>
                void post({ text: text.trim() }).then((ok) => {
                  if (ok) {
                    setText("");
                    setTextOpen(false);
                  }
                })
              }
              disabled={busy || !text.trim()}
              className="px-3 h-8 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
              style={{ background: ANYNOTES_ACCENT, color: "#241703" }}
            >
              Save note
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11.5px]" style={{ color: "#f87171" }}>
          {error}
        </div>
      )}
      {warning && (
        <div className="mt-2 text-[11.5px]" style={{ color: "#fbbf24" }}>
          {warning} — the note was saved with just the link.
        </div>
      )}

      {bookmarklet && <BookmarkletModal snippet={snippet} onClose={() => setBookmarklet(false)} />}
    </div>
  );
}

function BookmarkletModal({ snippet, onClose }: { snippet: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-[560px] rounded-xl p-5 shadow-2xl"
        style={{ background: "var(--bg, #0b0713)", border: `1px solid ${ANYNOTES_ACCENT}55` }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            <Bookmark size={15} style={{ color: ANYNOTES_ACCENT }} /> Capture from your browser
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--fg-dimmer,#6b6478)] hover:text-[var(--fg,#e8e2f0)]">
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--fg-dim, #9aa)" }}>
          Make a new bookmark in your browser, name it <strong>AnyNotes</strong>, and paste this as
          the URL. Clicking it on any page opens AnyNotes and captures that page. No extension, no
          store install.
        </p>
        <pre
          className="rounded-lg p-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-all"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          {snippet}
        </pre>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(snippet).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="mt-3 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12.5px] font-semibold"
          style={{ background: ANYNOTES_ACCENT, color: "#241703" }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy bookmarklet"}
        </button>
      </div>
    </div>
  );
}
