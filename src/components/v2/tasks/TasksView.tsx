"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListTodo, Plus, Search, X } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import { Eyebrow, inputStyle } from "@/components/v2/memory/shared";
import { TASKS_ACCENT, type TaskRowClient } from "./shared";
import TaskListPanel from "./TaskListPanel";
import MiniCalendar from "./MiniCalendar";
import TaskBoard from "./TaskBoard";
import AgentsSection from "./AgentsSection";
import TaskDetail from "./TaskDetail";
import TasksSettings from "./TasksSettings";

// ── TasksView (SPEC-B §6) — the /tasks page shell ────────────────────────────
// Row 1: TaskListPanel (2fr) beside MiniCalendar (1fr) · Row 2: TaskBoard ·
// Row 3: AgentsSection. TaskDetail slide-over (memory-UI pattern) opens from
// any card/row, and honors ?focus=<displayId> (the attention.flag route).

export default function TasksView() {
  const [tasks, setTasks] = useState<TaskRowClient[]>([]);
  const [q, setQ] = useState("");
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSpec, setNewSpec] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const url = q.trim() ? `/api/v2/tasks?q=${encodeURIComponent(q.trim())}` : "/api/v2/tasks";
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.tasks)) setTasks(j.tasks as TaskRowClient[]);
    } catch {
      /* offline */
    }
  }, [q]);

  usePollWhileVisible(refresh, 5000, [q]);

  // SPEC-C C5 pilot: what Jarvis sees when asked "what's on this page?" here.
  useJarvisPageContext({
    route: "/tasks",
    title: "Tasks",
    summary: `${tasks.length} task(s) visible — ${tasks.filter((t) => t.status === "Todo").length} todo, ${tasks.filter((t) => t.status === "Ready" || t.status === "Working").length} in progress, ${tasks.filter((t) => t.status === "Waiting" || t.status === "Review").length} needing attention, ${tasks.filter((t) => t.status === "Done").length} done${q.trim() ? ` (filtered by search '${q.trim()}')` : ""}.`,
  });

  // ?focus=tk-N deep link (attention.flag route contract).
  useEffect(() => {
    try {
      const focus = new URLSearchParams(window.location.search).get("focus");
      if (focus) setOpenId(focus);
    } catch {
      /* SSR-safe no-op */
    }
  }, []);

  /** PATCH a task; throws with the server message on failure (board snap-back). */
  const patchTask = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const r = await fetch(`/api/v2/tasks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        await refresh();
        throw new Error(String(j?.error ?? `HTTP ${r.status}`));
      }
      await refresh();
    },
    [refresh],
  );

  async function createTask() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch("/api/v2/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), specMd: newSpec.trim() || undefined }),
      });
      const j = await r.json();
      if (r.ok && j?.task) {
        setNewTitle("");
        setNewSpec("");
        setCreateOpen(false);
        await refresh();
        setOpenId((j.task as TaskRowClient).id);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${TASKS_ACCENT}14`, border: `1px solid ${TASKS_ACCENT}44` }}>
            <ListTodo size={17} style={{ color: TASKS_ACCENT }} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              Tasks
            </h1>
            <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {tasks.filter((t) => t.status !== "Done").length} open · {tasks.filter((t) => !!t.schedule).length} repeating
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--fg-dimmer, #6b6478)" }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks…"
              className="w-[190px] text-[12px] rounded-lg pl-7 pr-2.5 h-8 outline-none"
              style={inputStyle}
            />
          </div>
          <button
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
            style={{
              border: `1px solid ${createOpen ? TASKS_ACCENT : `${TASKS_ACCENT}55`}`,
              color: TASKS_ACCENT,
              background: createOpen ? `${TASKS_ACCENT}14` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            {createOpen ? <X size={13} /> : <Plus size={13} />} New task
          </button>
          <ConfigMenu title="Tasks Settings" accent={TASKS_ACCENT}>
            <TasksSettings />
          </ConfigMenu>
        </div>
      </div>

      {/* create drawer */}
      <AnimatePresence initial={false}>
        {createOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl p-4 mb-4"
              style={{ border: `1px solid ${TASKS_ACCENT}33`, background: "var(--panel, rgba(255,255,255,0.02))" }}>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createTask(); }}
                autoFocus
                placeholder="Task title"
                className="w-full text-[13px] rounded-lg px-2.5 h-9 outline-none mb-2"
                style={inputStyle}
              />
              <textarea
                value={newSpec}
                onChange={(e) => setNewSpec(e.target.value)}
                rows={3}
                placeholder="Spec (optional) — what should the agent accomplish?"
                className="w-full text-[12px] rounded-lg px-2.5 py-2 outline-none mb-2"
                style={inputStyle}
              />
              <button
                onClick={() => void createTask()}
                disabled={!newTitle.trim() || creating}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
                style={{ background: TASKS_ACCENT, color: "#2a1204" }}
              >
                <Plus size={13} /> {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Row 1: list + calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3 mb-4">
        <TaskListPanel
          tasks={tasks}
          dateFilter={dateFilter}
          onClearDateFilter={() => setDateFilter(null)}
          onOpen={(t) => setOpenId(t.id)}
          onPatch={async (id, patch) => {
            try {
              await patchTask(id, patch);
            } catch {
              /* list rows tolerate failures; board handles its own toast */
            }
          }}
        />
        <MiniCalendar tasks={tasks} selected={dateFilter} onSelect={setDateFilter} />
      </div>

      {/* Row 2: board */}
      <div className="mb-2"><Eyebrow>board</Eyebrow></div>
      <div className="mb-5">
        <TaskBoard tasks={tasks} onOpen={(t) => setOpenId(t.id)} onPatch={patchTask} />
      </div>

      {/* Row 3: agents */}
      <div className="mb-2"><Eyebrow>agents</Eyebrow></div>
      <AgentsSection onOpenTask={(displayId) => setOpenId(displayId)} />

      {openId && (
        <TaskDetail
          taskId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
