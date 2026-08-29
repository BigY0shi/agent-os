"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Repeat, User } from "lucide-react";
import {
  BOARD_COLUMNS,
  columnOf,
  PlanChip,
  fmtUntil,
  type BoardColumnKey,
  type TaskRowClient,
} from "./shared";

// ── TaskBoard (SPEC-B §6 row 2) — HTML5 drag-drop kanban ────────────────────
// Columns per the §6 status→column mapping (shared.BOARD_COLUMNS):
//   Todo=Todo · In Progress=Ready("starting…")+Working(pulse) ·
//   Waiting=Waiting("needs you")+Review("review me") · Done=Done
// Drop → PATCH {status} (In Progress sets Ready — the worker flips Working);
// a 409 bounces the card back and shows the phase-rule reason as a toast.
// DnD pattern mirrors the Sidebar customize-mode exemplar (native HTML5).

export default function TaskBoard({
  tasks,
  onOpen,
  onPatch,
}: {
  tasks: TaskRowClient[];
  onOpen: (task: TaskRowClient) => void;
  /** PATCH; throws with the server's error message on 409. */
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<BoardColumnKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Optimistic column override while a PATCH is in flight. */
  const [optimistic, setOptimistic] = useState<Record<string, BoardColumnKey>>({});

  const roots = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const childCounts = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const e = m.get(t.parentId) ?? { total: 0, done: 0 };
      e.total++;
      if (t.status === "Done") e.done++;
      m.set(t.parentId, e);
    }
    return m;
  }, [tasks]);

  function colTasks(key: BoardColumnKey): TaskRowClient[] {
    return roots.filter((t) => (optimistic[t.id] ?? columnOf(t.status)) === key);
  }

  async function drop(col: (typeof BOARD_COLUMNS)[number]) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const task = roots.find((t) => t.id === id);
    if (!task || columnOf(task.status) === col.key) return;

    setOptimistic((o) => ({ ...o, [id]: col.key }));
    try {
      await onPatch(id, { status: col.dropStatus });
    } catch (err) {
      // Snap back + toast with the phase-rule reason (409 message).
      setToast(err instanceof Error ? err.message : String(err));
      setTimeout(() => setToast(null), 4200);
    } finally {
      setOptimistic((o) => {
        const rest = { ...o };
        delete rest[id];
        return rest;
      });
    }
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {BOARD_COLUMNS.map((col) => {
          const items = colTasks(col.key);
          const highlighted = overCol === col.key && dragId !== null;
          return (
            <div
              key={col.key}
              onDragEnter={() => setOverCol(col.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void drop(col)}
              className="rounded-xl p-2.5 min-h-[280px] transition"
              style={{
                border: `1px solid ${highlighted ? col.accent : "var(--panel-border, #2a2436)"}`,
                background: highlighted ? `${col.accent}0a` : "var(--panel, rgba(255,255,255,0.02))",
              }}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.18em] font-semibold"
                  style={{ color: col.accent }}
                >
                  {col.label}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {items.length}
                </span>
              </div>

              {items.map((t) => {
                const kids = childCounts.get(t.id);
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    onClick={() => onOpen(t)}
                    className="rounded-lg p-2.5 mb-2 cursor-grab active:cursor-grabbing transition hover:border-[rgba(255,255,255,0.14)]"
                    style={{
                      opacity: dragId === t.id ? 0.4 : 1,
                      border: "1px solid var(--panel-border, #2a2436)",
                      background: "var(--bg, #0b0713)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span
                        className="font-mono text-[9.5px] px-1 rounded"
                        style={{ color: col.accent, border: `1px solid ${col.accent}44` }}
                      >
                        {t.displayId}
                      </span>
                      {t.status === "Ready" && (
                        <span className="font-mono text-[9px]" style={{ color: "#22d3ee" }}>
                          starting…
                        </span>
                      )}
                      {t.status === "Working" && (
                        <motion.span
                          animate={{ opacity: [1, 0.4, 1] }}
                          transition={{ duration: 1.6, repeat: Infinity }}
                          className="font-mono text-[9px]"
                          style={{ color: "#fbbf24" }}
                        >
                          working
                        </motion.span>
                      )}
                      {t.status === "Waiting" && (
                        <span className="font-mono text-[9px]" style={{ color: "#fbbf24" }}>
                          needs you
                        </span>
                      )}
                      {t.status === "Review" && (
                        <span className="font-mono text-[9px]" style={{ color: "#c084fc" }}>
                          review me
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[12px] leading-snug mb-1"
                      style={{ color: "var(--fg, #e8e2f0)" }}
                    >
                      {t.title || "Untitled task"}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PlanChip planStatus={t.planStatus} />
                      {t.agentId && (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-[9.5px]"
                          style={{ color: "var(--fg-dim, #9aa)" }}
                          title={`assigned to ${t.agentId}`}
                        >
                          <User size={9} /> {t.agentId}
                        </span>
                      )}
                      {kids && (
                        <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                          {kids.done}/{kids.total} sub
                        </span>
                      )}
                      {t.schedule && (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-[9.5px]"
                          style={{ color: "var(--fg-dim, #9aa)" }}
                          title={String(t.metadata?.scheduleText ?? t.schedule)}
                        >
                          <Repeat size={9} /> {t.runAt ? fmtUntil(t.runAt) : "paused"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 z-10 max-w-[520px] px-3 py-2 rounded-lg text-[12px]"
            style={{ background: "#f8717118", border: "1px solid #f87171", color: "#f87171" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
