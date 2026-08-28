"use client";

// ── NoteCard (SPEC-F I3.3) ──────────────────────────────────────────────────
// One masonry tile: media/thumb, type icon, title, site + author, captured-at,
// label chips, reply-count badge, hover actions (keep / archive / open source).
// Media is served by /api/anynotes/media/[file] from note.mediaPath VERBATIM
// (chunk-1 handoff) — the card never builds a filesystem path of its own.

import { motion } from "framer-motion";
import { Archive, ExternalLink, Inbox, MessageSquare, Star, AlertTriangle } from "lucide-react";
import type { Note, NoteStatus } from "@/lib/v2/anynotes/types";
import { fmtAgo } from "../integrations/shared";
import { ANYNOTES_ACCENT, STATUS_COLORS, TYPE_META } from "./shared";

interface Props {
  note: Note;
  replyCount: number;
  onOpen: () => void;
  onStatus: (status: NoteStatus) => void;
}

/** A degraded capture (SPEC-F §5's 422 path) is worth saying on the card, not
 *  only in the detail — the snapshot is missing and the user should know. */
function degradedReason(note: Note): string | null {
  if (note.meta?.captureMode !== "fallback") return null;
  const reason = note.meta?.captureError; // capture.ts fallbackNote() key
  return typeof reason === "string" && reason ? reason : "extraction failed — link only";
}

export default function NoteCard({ note, replyCount, onOpen, onStatus }: Props) {
  const meta = TYPE_META[note.type];
  const Icon = meta.Icon;
  const degraded = degradedReason(note);
  const preview = note.contentMd.trim().slice(0, 220);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="group mb-3 break-inside-avoid rounded-xl overflow-hidden cursor-pointer"
      style={{
        border: "1px solid var(--panel-border, #2a2436)",
        background: "var(--panel, rgba(255,255,255,0.02))",
      }}
      onClick={onOpen}
    >
      {note.mediaPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/anynotes/media/${note.mediaPath}`}
          alt={note.title || "screenshot"}
          className="w-full object-cover max-h-[280px]"
        />
      )}
      {!note.mediaPath && note.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={note.thumbUrl} alt="" className="w-full object-cover max-h-[200px]" />
      )}

      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Icon size={12} style={{ color: meta.color }} className="shrink-0" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span
            className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.1em]"
            style={{ color: STATUS_COLORS[note.status] ?? "var(--fg-dimmer, #6b6478)" }}
          >
            {note.status}
          </span>
        </div>

        <div className="text-[13px] font-medium leading-snug mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>
          {note.title || "(untitled)"}
        </div>

        {preview && (
          <p className="text-[11.5px] leading-relaxed mb-2 line-clamp-4" style={{ color: "var(--fg-dim, #9aa)" }}>
            {preview}
          </p>
        )}

        {degraded && (
          <div className="flex items-start gap-1.5 mb-2 text-[10.5px]" style={{ color: "#fbbf24" }}>
            <AlertTriangle size={11} className="shrink-0 mt-[1px]" />
            <span>{degraded}</span>
          </div>
        )}

        {note.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {note.labels.map((l) => (
              <span
                key={l}
                className="px-1.5 py-[1px] rounded text-[9.5px]"
                style={{ color: ANYNOTES_ACCENT, background: `${ANYNOTES_ACCENT}14`, border: `1px solid ${ANYNOTES_ACCENT}33` }}
              >
                {l}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          <span className="truncate">
            {[note.site, note.author].filter(Boolean).join(" · ") || "—"}
          </span>
          <span className="ml-auto shrink-0">{fmtAgo(note.capturedAt)}</span>
          {replyCount > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0" style={{ color: ANYNOTES_ACCENT }}>
              <MessageSquare size={10} /> {replyCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition">
          {note.status !== "kept" && (
            <CardAction label="Keep" onClick={(e) => { e.stopPropagation(); onStatus("kept"); }}>
              <Star size={12} />
            </CardAction>
          )}
          {note.status !== "archived" && (
            <CardAction label="Archive" onClick={(e) => { e.stopPropagation(); onStatus("archived"); }}>
              <Archive size={12} />
            </CardAction>
          )}
          {note.status !== "inbox" && (
            <CardAction label="Back to inbox" onClick={(e) => { e.stopPropagation(); onStatus("inbox"); }}>
              <Inbox size={12} />
            </CardAction>
          )}
          {note.url && (
            <a
              href={note.url}
              target="_blank"
              rel="noreferrer"
              title="Open source"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center w-6 h-6 rounded"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function CardAction({
  label, onClick, children,
}: { label: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-6 h-6 rounded"
      style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
    >
      {children}
    </button>
  );
}
