"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, FileText, AlertTriangle } from "lucide-react";
import type { EpisodicNode } from "@/lib/v2/memory/types";
import {
  AspectBadge, EmptyState, Eyebrow, LabelChip, MEMORY_ACCENT, SlideOver,
  fmtDate, type LabelRow,
} from "./shared";

// ── EpisodeDetail (SPEC-A A8.2) — slide-over for one episode ─────────────────
// GET /api/v2/memory/episodes/[id] → {episode, statements, voiceAspects, labels, compact?}
// DELETE = cascade-EXILE (A8.5): the confirm dialog names the exile destination,
// and the success banner shows the exact bundle path from the response.

interface FactRow {
  uuid: string;
  fact: string;
  aspect: string | null;
  validAt: string;
  invalidAt: string | null;
  invalidatedBy?: string | null;
}

interface Detail {
  episode: EpisodicNode;
  statements: FactRow[];
  voiceAspects: FactRow[];
  labels: LabelRow[];
  compact?: { id: string; title: string; content: string; updatedAt: string };
}

/**
 * A3 rendering: pair each invalidated fact with the current fact that replaced
 * it — heuristic match on same aspect + same leading word (facts are ≤15 words,
 * subject-first). Unpaired invalidated facts render as "previously …" alone.
 */
function pairInvalidated(current: FactRow[], invalidated: FactRow[]) {
  const firstWord = (f: string) => f.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return invalidated.map((old) => ({
    old,
    now: current.find((c) => c.aspect === old.aspect && firstWord(c.fact) === firstWord(old.fact)) ?? null,
  }));
}

function FactList({ title, facts }: { title: string; facts: FactRow[] }) {
  const current = facts.filter((f) => !f.invalidAt);
  const invalidated = facts.filter((f) => f.invalidAt);
  const pairs = pairInvalidated(current, invalidated);
  if (facts.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="mb-2"><Eyebrow>{title}</Eyebrow></div>
      <div className="flex flex-col gap-1.5">
        {current.map((f) => (
          <div key={f.uuid} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: "var(--fg, #e8e2f0)" }}>
            <AspectBadge aspect={f.aspect} />
            <span className="min-w-0">{f.fact}</span>
          </div>
        ))}
        {pairs.map(({ old, now }) => (
          <div key={old.uuid} className="flex items-start gap-2 text-[12px] leading-relaxed" style={{ color: "var(--fg-dim, #9aa)" }}>
            <AspectBadge aspect={old.aspect} struck />
            <span className="min-w-0">
              {now && <>currently <span style={{ color: "var(--fg, #e8e2f0)" }}>{now.fact}</span> — </>}
              previously <span className="line-through" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{old.fact}</span>{" "}
              <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                (until {fmtDate(old.invalidAt)})
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EpisodeDetail({
  episodeUuid, onClose, onExiled,
}: { episodeUuid: string; onClose: () => void; onExiled?: (uuid: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showCompact, setShowCompact] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exiledTo, setExiledTo] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v2/memory/episodes/${episodeUuid}`, { cache: "no-store" });
      if (!r.ok) { setFailed(true); return; }
      setDetail((await r.json()) as Detail);
    } catch { setFailed(true); }
  }, [episodeUuid]);
  useEffect(() => { void load(); }, [load]);

  async function doExile() {
    setDeleting(true); setDeleteErr(null);
    try {
      const r = await fetch(`/api/v2/memory/episodes/${episodeUuid}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setDeleteErr(j?.error ?? `exile failed (${r.status})`); return; }
      setExiledTo(String(j?.exiledTo ?? "~/.agentic-os/.exile/memory/"));
      onExiled?.(episodeUuid);
    } catch { setDeleteErr("server unreachable"); }
    finally { setDeleting(false); setConfirming(false); }
  }

  const ep = detail?.episode;

  return (
    <SlideOver
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2 min-w-0">
          <FileText size={15} style={{ color: MEMORY_ACCENT }} />
          <span className="truncate">Episode · {fmtDate(ep?.validAt ?? null)}</span>
        </span>
      }
    >
      {failed && <EmptyState title="Couldn't load this episode" hint="The server may be restarting — close and retry." />}
      {!failed && !detail && (
        <div className="flex items-center gap-2 py-8 justify-center text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>
          <Loader2 size={14} className="animate-spin" /> loading…
        </div>
      )}

      {ep && (
        <>
          {/* meta strip */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            <span>source {ep.source}</span>
            <span>session {ep.sessionId.slice(0, 8)}…</span>
            {ep.endUserId && <span>endUser {ep.endUserId}</span>}
            {ep.type && ep.type !== "CONVERSATION" && <span>{ep.type}</span>}
            <span>recalled {ep.recallCount ?? 0}×</span>
          </div>

          {detail!.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {detail!.labels.map((l) => <LabelChip key={l.id} label={l} />)}
            </div>
          )}

          {/* original vs normalized toggle */}
          <div className="flex items-center gap-1 mb-2">
            {(["normalized", "original"] as const).map((mode) => {
              const active = (mode === "original") === showOriginal;
              return (
                <button
                  key={mode}
                  onClick={() => setShowOriginal(mode === "original")}
                  className="px-2.5 h-6 rounded-md text-[11px] font-medium transition"
                  style={{
                    color: active ? MEMORY_ACCENT : "var(--fg-dimmer, #6b6478)",
                    background: active ? `${MEMORY_ACCENT}14` : "transparent",
                    border: `1px solid ${active ? `${MEMORY_ACCENT}55` : "var(--panel-border, #2a2436)"}`,
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          <div
            className="rounded-lg p-3 mb-5 text-[12.5px] leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
          >
            {showOriginal ? ep.originalContent : ep.content}
          </div>

          <FactList title="Extracted facts" facts={detail!.statements} />
          <FactList title="Voice aspects" facts={detail!.voiceAspects} />

          {/* session compact link (A5) */}
          {detail!.compact && (
            <div className="mb-5">
              <button
                onClick={() => setShowCompact((v) => !v)}
                className="text-[11.5px] font-medium hover:underline underline-offset-2"
                style={{ color: MEMORY_ACCENT }}
              >
                📦 Session compact · {detail!.compact.title} ({fmtDate(detail!.compact.updatedAt)})
              </button>
              {showCompact && (
                <div
                  className="mt-2 rounded-lg p-3 text-[12px] leading-relaxed whitespace-pre-wrap max-h-[320px] overflow-y-auto"
                  style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                >
                  {detail!.compact.content}
                </div>
              )}
            </div>
          )}

          {/* cascade-exile (A8.5) */}
          <div className="pt-4" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
            {exiledTo ? (
              <div className="text-[11.5px] leading-relaxed" style={{ color: "#34d399" }}>
                Exiled. Full bundle written to{" "}
                <code className="font-mono text-[10.5px] break-all" style={{ color: "var(--fg-dim, #9aa)" }}>{exiledTo}</code>
                {" "}— recoverable, nothing destroyed.
              </div>
            ) : confirming ? (
              <div className="rounded-lg p-3" style={{ border: "1px solid #f8717155", background: "rgba(248,113,113,0.06)" }}>
                <div className="flex items-start gap-2 text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--fg, #e8e2f0)" }}>
                  <AlertTriangle size={14} className="shrink-0 mt-[1px]" style={{ color: "#f87171" }} />
                  <span>
                    This episode and its sole-provenance facts are <b>exiled, not deleted</b> — a full JSON bundle
                    lands in <code className="font-mono text-[10.5px]">~/.agentic-os/.exile/memory/</code> before any
                    row is touched. Facts shared with other episodes are kept.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={doExile}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-[11.5px] font-semibold disabled:opacity-50"
                    style={{ background: "#f87171", color: "#2a0808" }}
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Exile episode
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-3 h-7 rounded-md text-[11.5px]"
                    style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                  >
                    Cancel
                  </button>
                </div>
                {deleteErr && <div className="mt-2 text-[11px]" style={{ color: "#f87171" }}>{deleteErr}</div>}
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium transition"
                style={{ border: "1px solid #f8717144", color: "#f87171", background: "transparent" }}
              >
                <Trash2 size={12} /> Exile episode…
              </button>
            )}
          </div>
        </>
      )}
    </SlideOver>
  );
}
