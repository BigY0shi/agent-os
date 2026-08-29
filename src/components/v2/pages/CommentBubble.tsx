"use client";

import { useEffect, useState } from "react";
import { Check, RotateCcw, Sparkles, User } from "lucide-react";
import { SCRATCHPAD_ACCENT, type PageCommentClient } from "./shared";

// ── CommentBubble (SPEC-B B5.6, pattern-only port of CommentPopover) ─────────
// Bubbles sit in a right gutter, vertically aligned to their anchor paragraph
// (located via the paragraph's data-node-id attribute). Comments whose anchor
// is gone fall back to a bottom list quoting the anchored text.

interface Positioned {
  comment: PageCommentClient;
  top: number | null; // null = anchor not found → bottom list
}

function BubbleCard({
  comment,
  onToggleResolved,
  quoted,
}: {
  comment: PageCommentClient;
  onToggleResolved: (c: PageCommentClient) => void;
  quoted?: boolean;
}) {
  const resolved = !!comment.resolvedAt;
  const isJarvis = comment.author === "jarvis";
  return (
    <div
      className="rounded-xl p-2.5 text-[12px] leading-relaxed transition"
      style={{
        border: `1px solid ${resolved ? "var(--panel-border, #2a2436)" : `${SCRATCHPAD_ACCENT}44`}`,
        background: "var(--panel, rgba(255,255,255,0.02))",
        opacity: resolved ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {isJarvis ? (
          <Sparkles size={12} style={{ color: SCRATCHPAD_ACCENT }} />
        ) : (
          <User size={12} style={{ color: "var(--fg-dim, #a89fb8)" }} />
        )}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: isJarvis ? SCRATCHPAD_ACCENT : "var(--fg-dim, #a89fb8)" }}>
          {isJarvis ? "Jarvis" : "You"}
        </span>
        <button
          type="button"
          onClick={() => onToggleResolved(comment)}
          title={resolved ? "Reopen" : "Resolve"}
          className="ml-auto grid h-5 w-5 place-items-center rounded transition hover:opacity-80"
          style={{ color: "var(--fg-dimmer, #6b6478)" }}
        >
          {resolved ? <RotateCcw size={11} /> : <Check size={11} />}
        </button>
      </div>
      {quoted && comment.anchorTextNorm && (
        <div className="text-[10.5px] italic mb-1 truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          re: “{comment.anchorTextNorm}”
        </div>
      )}
      <div style={{ color: "var(--fg, #e8e2f0)", whiteSpace: "pre-wrap" }}>{comment.bodyMd}</div>
    </div>
  );
}

export default function CommentBubbles({
  comments,
  containerRef,
  onToggleResolved,
}: {
  comments: PageCommentClient[];
  /** The relatively-positioned wrapper that contains the editor DOM. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  onToggleResolved: (c: PageCommentClient) => void;
}) {
  const [positioned, setPositioned] = useState<Positioned[]>([]);

  // Re-measure whenever comments change (and on a slow interval — the doc
  // reflows as the user types).
  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const root = containerRef.current;
      const out: Positioned[] = comments.map((comment) => {
        let top: number | null = null;
        if (root && comment.anchorNodeId) {
          const el = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(comment.anchorNodeId)}"]`);
          if (el) {
            const rootRect = root.getBoundingClientRect();
            top = el.getBoundingClientRect().top - rootRect.top;
          }
        }
        return { comment, top };
      });
      // De-overlap anchored bubbles (stack downward with a minimum gap).
      const EST = 96;
      let lastBottom = -Infinity;
      for (const p of out.filter((x) => x.top !== null).sort((a, b) => a.top! - b.top!)) {
        if (p.top! < lastBottom) p.top = lastBottom;
        lastBottom = p.top! + EST;
      }
      setPositioned(out);
    };
    measure();
    const t = setInterval(measure, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [comments, containerRef]);

  const anchored = positioned.filter((p) => p.top !== null);
  const orphaned = positioned.filter((p) => p.top === null);

  return (
    <>
      {/* right-gutter anchored bubbles */}
      <div className="hidden xl:block absolute top-0 bottom-0 right-[-292px] w-[272px] pointer-events-none">
        {anchored.map((p) => (
          <div key={p.comment.id} className="absolute left-0 right-0 pointer-events-auto" style={{ top: p.top! }}>
            <BubbleCard comment={p.comment} onToggleResolved={onToggleResolved} />
          </div>
        ))}
      </div>

      {/* fallback: orphaned comments (anchor gone) + all comments on narrow screens */}
      {(orphaned.length > 0 || anchored.length > 0) && (
        <div className="mt-6 space-y-2 xl:hidden">
          {positioned.map((p) => (
            <BubbleCard key={p.comment.id} comment={p.comment} onToggleResolved={onToggleResolved} quoted />
          ))}
        </div>
      )}
      {orphaned.length > 0 && (
        <div className="mt-6 space-y-2 hidden xl:block">
          {orphaned.map((p) => (
            <BubbleCard key={p.comment.id} comment={p.comment} onToggleResolved={onToggleResolved} quoted />
          ))}
        </div>
      )}
    </>
  );
}
