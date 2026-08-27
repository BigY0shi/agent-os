"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import Editor, { TaskStatusContext, type SaveOutcome } from "./Editor";
import PageHeader from "./PageHeader";
import CommentBubbles from "./CommentBubble";
import {
  SCRATCHPAD_ACCENT,
  shiftDate,
  type PageClient,
  type PageCommentClient,
} from "./shared";

// ── ScratchpadView (SPEC-B B5) — the /today page shell ───────────────────────
// Daily page per date (find-or-create via GET /api/v2/pages?date=), TipTap
// editor with rev-CAS autosave, comment bubbles anchored beside their
// paragraphs, prev/next/today navigation, Widgets placeholder (H phase).

export default function ScratchpadView() {
  const [page, setPage] = useState<PageClient | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const [comments, setComments] = useState<PageCommentClient[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const loadPage = useCallback(async (date?: string) => {
    try {
      const url = date ? `/api/v2/pages?date=${date}` : "/api/v2/pages";
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (j?.page) {
        setPage(j.page as PageClient);
        if (!date) setTodayDate((j.page as PageClient).date);
      }
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void loadPage(); // default = today in settings tz (server decides)
  }, [loadPage]);

  const refreshComments = useCallback(async () => {
    if (!page?.id) return;
    try {
      const r = await fetch(`/api/v2/pages/${page.id}/comments`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.comments)) setComments(j.comments as PageCommentClient[]);
    } catch {
      /* offline */
    }
  }, [page?.id]);
  usePollWhileVisible(refreshComments, 5000, [page?.id]);

  // Live status badges for bound taskItems (source 'daily' covers [ ] tasks).
  const refreshStatuses = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/tasks?source=daily&limit=500", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.tasks)) {
        const map: Record<string, string> = {};
        for (const t of j.tasks as Array<{ id: string; status: string }>) map[t.id] = t.status;
        setStatuses(map);
      }
    } catch {
      /* offline */
    }
  }, []);
  usePollWhileVisible(refreshStatuses, 5000, []);

  const onSaveOutcome = useCallback(
    (o: SaveOutcome) => {
      if (o.kind === "conflict") {
        showToast("Page changed elsewhere — reloaded the latest version.");
      } else if (o.bound) {
        void refreshStatuses();
      }
    },
    [showToast, refreshStatuses],
  );

  async function toggleResolved(c: PageCommentClient) {
    if (!page) return;
    try {
      await fetch(`/api/v2/pages/${page.id}/comments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: c.id, resolved: !c.resolvedAt }),
      });
      await refreshComments();
    } catch {
      /* offline */
    }
  }

  const isToday = !!page?.date && (!todayDate || page.date === todayDate);

  return (
    <div className="mt-4">
      <PageHeader
        date={page?.date ?? null}
        isToday={isToday}
        onPrev={() => page?.date && void loadPage(shiftDate(page.date, -1))}
        onNext={() => page?.date && void loadPage(shiftDate(page.date, 1))}
        onToday={() => void loadPage()}
      />

      <div className="relative xl:mr-[292px]">
        <div
          ref={editorWrapRef}
          className="relative rounded-xl p-5"
          style={{
            border: "1px solid var(--panel-border, #2a2436)",
            background: "var(--panel, rgba(255,255,255,0.02))",
          }}
        >
          {page ? (
            <TaskStatusContext.Provider value={statuses}>
              <Editor
                key={page.id}
                page={page}
                onSaveOutcome={onSaveOutcome}
                onDocRefreshed={() => void refreshComments()}
              />
            </TaskStatusContext.Provider>
          ) : (
            <div className="py-16 text-center text-[12.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              Loading today’s page…
            </div>
          )}
          <CommentBubbles
            comments={comments}
            containerRef={editorWrapRef}
            onToggleResolved={(c) => void toggleResolved(c)}
          />
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-3.5 py-2 rounded-lg text-[12.5px] font-medium"
            style={{
              background: "var(--panel-solid, #17121f)",
              border: `1px solid ${SCRATCHPAD_ACCENT}55`,
              color: "var(--fg, #e8e2f0)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
