"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity as ActivityIcon,
  Check,
  Loader2,
  MessageSquare,
  Play,
  Send,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { SlideOver, Eyebrow, EmptyState, inputStyle } from "@/components/v2/memory/shared";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import {
  DisplayIdChip,
  StatusDot,
  TASKS_ACCENT,
  TASK_STATUS_COLORS,
  fmtDate,
  type TaskRowClient,
} from "./shared";

// ── TaskDetail slide-over (SPEC-B §6 + chunk-3 brief) ────────────────────────
// Memory-UI slide-over pattern. Tabs:
//   Overview — editable spec_md, rendered plan_md with Approve/Reject when
//              drafted, status timeline from task_events
//   Chat     — conversation thread + input → POST /chat (Waiting auto-unblock)
//   Sessions — v2_task_sessions rows (F3/E fill status later)
//   Activity — full event log

interface TaskEventClient {
  id: number;
  kind: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

interface SessionClient {
  id: string;
  kind: string;
  sessionRef: string | null;
  agent: string | null;
  dir: string | null;
  status: string;
  createdAt: string;
}

interface MessageClient {
  id: string;
  role: string;
  userType: string;
  content: string;
  createdAt: string;
}

interface DetailPayload {
  task: TaskRowClient;
  subtasks: TaskRowClient[];
  events: TaskEventClient[];
  sessions: SessionClient[];
}

type Tab = "overview" | "chat" | "sessions" | "activity";

const EVENT_COLORS: Record<string, string> = {
  created: "#60a5fa",
  status_change: "#22d3ee",
  plan_drafted: "#fbbf24",
  plan_approved: "#34d399",
  plan_rejected: "#f87171",
  run_ok: "#34d399",
  run_fail: "#f87171",
  run_blocked: "#fbbf24",
  rescheduled: "#c084fc",
};

export default function TaskDetail({
  taskId,
  onClose,
  onChanged,
}: {
  /** uuid or tk-* display id. */
  taskId: string;
  onClose: () => void;
  /** Notify the page shell that lists/board should refetch. */
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [specDraft, setSpecDraft] = useState<string | null>(null);
  const [savingSpec, setSavingSpec] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // approve|reject|run|delete
  const [chat, setChat] = useState<MessageClient[]>([]);
  const [chatText, setChatText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/v2/tasks/${taskId}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.task) {
        setDetail(j as DetailPayload);
        setError(null);
      } else {
        setError(String(j?.error ?? "load failed"));
      }
    } catch {
      setError("feed unreachable");
    }
  }, [taskId]);

  const refreshChat = useCallback(async () => {
    try {
      const r = await fetch(`/api/v2/tasks/${taskId}/chat`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.messages)) setChat(j.messages as MessageClient[]);
    } catch {
      /* offline */
    }
  }, [taskId]);

  usePollWhileVisible(refresh, 4000, [taskId]);
  usePollWhileVisible(refreshChat, 4000, [taskId]);

  // Seed the spec editor once per task.
  useEffect(() => {
    setSpecDraft(null);
    setTab("overview");
  }, [taskId]);
  useEffect(() => {
    if (detail && specDraft === null) setSpecDraft(detail.task.specMd ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const task = detail?.task ?? null;

  async function saveSpec() {
    if (!task || specDraft === null) return;
    setSavingSpec(true);
    try {
      await fetch(`/api/v2/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specMd: specDraft }),
      });
      await refresh();
      onChanged();
    } finally {
      setSavingSpec(false);
    }
  }

  async function planAction(action: "approve" | "reject") {
    if (!task) return;
    let body: Record<string, unknown> = {};
    if (action === "reject") {
      const reason = window.prompt("Why reject this plan? (fed back to the agent)");
      if (reason === null) return;
      body = { action: "reject", reason };
    }
    setBusy(action);
    try {
      const r = await fetch(`/api/v2/tasks/${task.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(String(j?.error ?? `HTTP ${r.status}`));
      }
      await refresh();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!task) return;
    setBusy("run");
    try {
      const r = await fetch(`/api/v2/tasks/${task.id}/run`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(String(j?.error ?? `HTTP ${r.status}`));
      }
      await refresh();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function exile() {
    if (!task) return;
    if (!window.confirm(`Exile ${task.displayId} "${task.title}"? The full bundle is saved to ~/.agentic-os/.exile/tasks/ before removal.`)) return;
    setBusy("delete");
    try {
      const r = await fetch(`/api/v2/tasks/${task.id}`, { method: "DELETE" });
      if (r.ok) {
        onChanged();
        onClose();
      } else {
        const j = await r.json().catch(() => ({}));
        setError(String(j?.error ?? `HTTP ${r.status}`));
      }
    } finally {
      setBusy(null);
    }
  }

  async function sendChat() {
    if (!task || !chatText.trim()) return;
    const text = chatText.trim();
    setChatText("");
    await fetch(`/api/v2/tasks/${task.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await refreshChat();
    await refresh();
    onChanged();
  }

  const timeline = useMemo(
    () => (detail?.events ?? []).filter((e) => e.kind === "status_change" || e.kind.startsWith("plan_")),
    [detail],
  );

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Check size={12} /> },
    { key: "chat", label: "Chat", icon: <MessageSquare size={12} /> },
    { key: "sessions", label: "Sessions", icon: <TerminalSquare size={12} /> },
    { key: "activity", label: "Activity", icon: <ActivityIcon size={12} /> },
  ];

  return (
    <SlideOver
      wide
      accent={TASKS_ACCENT}
      onClose={onClose}
      title={
        task ? (
          <span className="inline-flex items-center gap-2 min-w-0">
            <DisplayIdChip displayId={task.displayId} />
            <span className="truncate">{task.title || "Untitled task"}</span>
            <StatusDot status={task.status} />
          </span>
        ) : (
          "Loading…"
        )
      }
    >
      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg text-[12px] flex items-center justify-between gap-2"
          style={{ background: "#f8717114", border: "1px solid #f8717155", color: "#f87171" }}>
          <span className="min-w-0 truncate">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X size={12} /></button>
        </div>
      )}

      {task && (
        <>
          {/* properties bar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="font-mono text-[10px] px-2 py-[2px] rounded-full"
              style={{ color: TASK_STATUS_COLORS[task.status], border: `1px solid ${TASK_STATUS_COLORS[task.status]}55` }}>
              {task.status}
            </span>
            {task.agentId && (
              <span className="font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>agent: {task.agentId}</span>
            )}
            {typeof task.metadata?.category === "string" && (
              <span className="font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>cat: {task.metadata.category as string}</span>
            )}
            {typeof task.metadata?.scheduleText === "string" && (
              <span className="font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>{task.metadata.scheduleText as string}</span>
            )}
            {task.runAt && (
              <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>next {fmtDate(task.runAt)}</span>
            )}
            <span className="ml-auto inline-flex gap-1.5">
              <button
                onClick={() => void runNow()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium disabled:opacity-50"
                style={{ color: "#34d399", border: "1px solid #34d39955" }}
                title="Run now (fire-override)"
              >
                {busy === "run" ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run
              </button>
              <button
                onClick={() => void exile()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium disabled:opacity-50"
                style={{ color: "#f87171", border: "1px solid #f8717155" }}
                title="Exile (recoverable delete)"
              >
                {busy === "delete" ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Exile
              </button>
            </span>
          </div>

          {/* tabs */}
          <div className="flex items-center gap-1 mb-3" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-[12px] font-medium transition"
                style={{
                  color: tab === t.key ? TASKS_ACCENT : "var(--fg-dim, #9aa)",
                  borderBottom: `2px solid ${tab === t.key ? TASKS_ACCENT : "transparent"}`,
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Eyebrow>spec (your words)</Eyebrow>
                <button
                  onClick={() => void saveSpec()}
                  disabled={savingSpec || specDraft === (task.specMd ?? "")}
                  className="inline-flex items-center gap-1 px-2 h-6 rounded text-[10.5px] font-medium disabled:opacity-40"
                  style={{ color: TASKS_ACCENT, border: `1px solid ${TASKS_ACCENT}55` }}
                >
                  {savingSpec ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save spec
                </button>
              </div>
              <textarea
                value={specDraft ?? ""}
                onChange={(e) => setSpecDraft(e.target.value)}
                rows={6}
                placeholder="What should this task accomplish? The agent plans from this."
                className="w-full text-[12px] leading-relaxed rounded-lg px-2.5 py-2 outline-none font-mono mb-4"
                style={inputStyle}
              />

              <div className="mb-1 flex items-center justify-between">
                <Eyebrow>plan (agent-drafted{task.planStatus !== "none" ? ` · ${task.planStatus}` : ""})</Eyebrow>
                {task.planStatus === "drafted" && (
                  <span className="inline-flex gap-1.5">
                    <button
                      onClick={() => void planAction("approve")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                      style={{ background: "#34d399", color: "#04221c" }}
                    >
                      {busy === "approve" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve
                    </button>
                    <button
                      onClick={() => void planAction("reject")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                      style={{ color: "#f87171", border: "1px solid #f87171" }}
                    >
                      <X size={11} /> Reject
                    </button>
                  </span>
                )}
              </div>
              {task.planMd ? (
                <div
                  className="rounded-lg px-3 py-2 mb-4 text-[12px] leading-relaxed prose-invert"
                  style={{ border: `1px solid ${task.planStatus === "drafted" ? "#fbbf2455" : "var(--panel-border, #2a2436)"}`, color: "var(--fg-dim, #c8c2d0)" }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.planMd}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  No plan yet — the agent drafts one on the next run.
                </div>
              )}

              {task.result && (
                <>
                  <div className="mb-1"><Eyebrow>result</Eyebrow></div>
                  <div className="rounded-lg px-3 py-2 mb-4 text-[12px] leading-relaxed"
                    style={{ border: "1px solid #34d39944", color: "var(--fg-dim, #c8c2d0)" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
                  </div>
                </>
              )}
              {task.error && (
                <div className="rounded-lg px-3 py-2 mb-4 text-[11.5px] font-mono"
                  style={{ border: "1px solid #f8717144", color: "#f87171" }}>
                  {task.error}
                </div>
              )}

              {detail!.subtasks.length > 0 && (
                <>
                  <div className="mb-1"><Eyebrow>subtasks</Eyebrow></div>
                  <div className="mb-4">
                    {detail!.subtasks.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 py-1 text-[12px]">
                        <StatusDot status={s.status} />
                        <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{s.displayId}</span>
                        <span style={{ color: "var(--fg, #e8e2f0)", textDecoration: s.status === "Done" ? "line-through" : "none" }}>
                          {s.title || "Untitled"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="mb-1"><Eyebrow>status timeline</Eyebrow></div>
              {timeline.length === 0 ? (
                <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>No transitions yet.</div>
              ) : (
                timeline.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 py-[3px] text-[11.5px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: EVENT_COLORS[e.kind] ?? "#9aa" }} />
                    <span className="font-mono text-[10px] w-[110px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      {fmtDate(e.createdAt)}
                    </span>
                    <span style={{ color: "var(--fg-dim, #9aa)" }}>
                      {e.kind === "status_change"
                        ? `${e.detail.from} → ${e.detail.to} (${e.actor})`
                        : `${e.kind.replace(/_/g, " ")} (${e.actor})`}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="flex flex-col" style={{ minHeight: 320 }}>
              <div className="flex-1 overflow-y-auto mb-3">
                {chat.length === 0 ? (
                  <EmptyState title="No messages yet" hint="Runs stream their plan, steps and questions here. Replying to a Waiting task unblocks it." />
                ) : (
                  chat.map((m) => (
                    <div key={m.id} className="mb-2.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]"
                          style={{ color: m.role === "user" ? TASKS_ACCENT : "#60a5fa" }}>
                          {m.role === "user" ? "you" : "agent"}
                        </span>
                        <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                          {fmtDate(m.createdAt)}
                        </span>
                      </div>
                      <div className="text-[12px] leading-relaxed whitespace-pre-wrap rounded-lg px-2.5 py-1.5"
                        style={{
                          color: "var(--fg-dim, #c8c2d0)",
                          background: m.role === "user" ? `${TASKS_ACCENT}0d` : "var(--panel, rgba(255,255,255,0.02))",
                          border: "1px solid var(--panel-border, #2a2436)",
                        }}>
                        {m.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                  placeholder={task.status === "Waiting" ? "Reply to unblock the task…" : "Message the task thread…"}
                  className="flex-1 text-[12.5px] rounded-lg px-2.5 h-9 outline-none"
                  style={inputStyle}
                />
                <button
                  onClick={() => void sendChat()}
                  disabled={!chatText.trim()}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: TASKS_ACCENT, color: "#2a1204" }}
                >
                  <Send size={12} /> Send
                </button>
              </div>
            </div>
          )}

          {tab === "sessions" && (
            <div>
              {detail!.sessions.length === 0 ? (
                <EmptyState
                  icon={<TerminalSquare size={20} />}
                  title="No linked sessions"
                  hint="Coding / browser / exec sessions spawned by runs are linked here (F3/E fill in live status)."
                />
              ) : (
                detail!.sessions.map((s) => (
                  <div key={s.id} className="rounded-lg px-3 py-2 mb-2"
                    style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
                    <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                      <span className="font-mono text-[10px] px-1.5 rounded" style={{ color: "#22d3ee", border: "1px solid #22d3ee44" }}>{s.kind}</span>
                      <span>{s.agent ?? "—"}</span>
                      <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>{s.status}</span>
                    </div>
                    <div className="font-mono text-[10px] mt-1 truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      {s.sessionRef ?? "(starting)"} · {s.dir ?? ""} · {fmtDate(s.createdAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "activity" && (
            <div>
              {(detail!.events ?? []).map((e) => (
                <div key={e.id} className="flex items-start gap-2 py-[3px] text-[11.5px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[5px]" style={{ background: EVENT_COLORS[e.kind] ?? "#6b6478" }} />
                  <span className="font-mono text-[10px] w-[110px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {fmtDate(e.createdAt)}
                  </span>
                  <span className="min-w-0" style={{ color: "var(--fg-dim, #9aa)" }}>
                    <span className="font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>{e.kind.replace(/_/g, " ")}</span>
                    <span className="font-mono text-[10px]"> · {e.actor}</span>
                    {Object.keys(e.detail).length > 0 && (
                      <span className="font-mono text-[10px] block truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                        {JSON.stringify(e.detail).slice(0, 160)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SlideOver>
  );
}
