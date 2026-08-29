"use client";

// ── widgetComponents (SPEC-D §3.4, H2.1/H3.1) ───────────────────────────────
// The client slug → component map (upstream components.client.ts pattern).
// Every entry matches a registry slug (src/lib/v2/widgets/registry.ts — the
// single catalog); parity is smoke-asserted. Data widgets poll their stable
// /api/v2/widgets/<slug>/data endpoint via usePollWhileVisible and render the
// honest { available: false, reason } state verbatim — no fabricated numbers.

import { useCallback, useState, type ComponentType } from "react";
import Link from "next/link";
import { Bot, CalendarDays, Gauge, ListTodo, Rss, StickyNote } from "lucide-react";
import StatusBand, { type StatusBandKind } from "@/components/v2/StatusBand";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import type {
  AnynotesRecentPayload,
  CalendarPayload,
  NewsletterEditionPayload,
  TasksUpcomingPayload,
  WidgetData,
} from "@/lib/v2/widgets/types";
import { EmptyState, fmtAgo } from "../integrations/shared";
import { AttentionPanel } from "./AttentionHero";
// H1.1 legacy-* wrappers: the EXISTING Overview panels imported UNCHANGED
// (§6.4 — wrap, never move/rewrite; dashboard/* stays read-only; HeroGreeting
// is NOT a widget — it stays first-class in Overview.tsx).
import { KPIGrid } from "@/components/dashboard/KPIGrid";
import { TelemetryPanel } from "@/components/dashboard/TelemetryPanel";
import { JarvisModule } from "@/components/dashboard/JarvisModule";
import { DealDeskSummary } from "@/components/dashboard/DealDeskSummary";
import { SystemMap } from "@/components/dashboard/SystemMap";
import { MiniTimeline } from "@/components/dashboard/MiniTimeline";
import { MissionStripe } from "@/components/dashboard/MissionStripe";
import TodoPanel from "@/components/TodoPanel";

export interface WidgetComponentProps {
  config: Record<string, unknown>;
  cellId: string;
}

// ─── shared data hook ────────────────────────────────────────────────────────

function useWidgetData<T extends Record<string, unknown>>(
  slug: string,
  config: Record<string, unknown>,
): { data: WidgetData<T> | null; failed: boolean } {
  const [data, setData] = useState<WidgetData<T> | null>(null);
  const [failed, setFailed] = useState(false);
  const configJson = JSON.stringify(config ?? {});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v2/widgets/${slug}/data?config=${encodeURIComponent(configJson)}`,
        { cache: "no-store" },
      );
      const j = (await res.json()) as WidgetData<T>;
      if (j && typeof j === "object" && "available" in j) {
        setData(j);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, [slug, configJson]);

  usePollWhileVisible(refresh, 30_000, [slug, configJson]);
  return { data, failed };
}

function Pending({ failed }: { failed: boolean }) {
  return (
    <div className="font-mono text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
      {failed ? "feed unreachable" : "loading…"}
    </div>
  );
}

/** The honest unavailable panel (§5.8): show the reason, offer nothing fake. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12px]"
      style={{
        border: "1px dashed var(--panel-border, #2a2436)",
        color: "var(--fg-dim, #9aa)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        not available
      </div>
      {reason}
    </div>
  );
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// ─── attention ───────────────────────────────────────────────────────────────
// Shares the hero's internals (§6.6 "same component, hero prop").

function AttentionWidget({ config }: WidgetComponentProps) {
  return (
    <AttentionPanel
      maxItems={num(config.maxItems, 10)}
      minSeverity={typeof config.minSeverity === "string" ? config.minSeverity : "info"}
    />
  );
}

// ─── activity-feed ───────────────────────────────────────────────────────────

interface ActivityFeedPayload extends Record<string, unknown> {
  items: Array<{
    id: string;
    connector: string;
    account: string;
    text: string;
    sourceUrl: string | null;
    eventType: string | null;
    createdAt: string;
  }>;
}

function ActivityFeedWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<ActivityFeedPayload>("activity-feed", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  if (data.items.length === 0) {
    return <EmptyState icon={<Rss size={16} />} title="No activity yet" hint="synced integration activity lands here" />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.items.map((a) => (
        <div
          key={a.id}
          className="rounded-lg px-3 py-2"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        >
          <div className="flex items-baseline gap-2 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            <span style={{ color: "var(--fg-dim, #9aa)" }}>{a.connector}</span>
            <span className="truncate">{a.account}</span>
            <span className="ml-auto shrink-0">{fmtAgo(a.createdAt)}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }} title={a.text}>
            {a.sourceUrl ? (
              <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {a.text}
              </a>
            ) : (
              a.text
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── pipeline-stats ──────────────────────────────────────────────────────────

interface PipelineStatsPayload extends Record<string, unknown> {
  view: "kpi" | "deals";
  kpi?: {
    agents: { total: number; running: number };
    runs: { total: number; d1: number; d7: number; successRate: number | null };
    timing: { medianMs: number | null };
    spend: { total: number; d7: number };
  };
  deals?: {
    total: number;
    byStatus: Record<string, number>;
    columns: Array<{ key?: string; label?: string; accent?: string }>;
  };
}

function secs(ms: number | null | undefined): string {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "—";
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
      <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        {label}
      </div>
      <div className="text-[16px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
        {value}
      </div>
      {note ? (
        <div className="font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

function PipelineStatsWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<PipelineStatsPayload>("pipeline-stats", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;

  if (data.view === "kpi" && data.kpi) {
    const k = data.kpi;
    return (
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Agents" value={`${k.agents.running} / ${k.agents.total}`} note="running / total" />
        <Stat label="Runs (7d)" value={String(k.runs.d7)} note={`${k.runs.d1} today · ${k.runs.total} all time`} />
        <Stat label="Median run" value={secs(k.timing.medianMs)} note={k.runs.successRate == null ? "no verdicts yet" : `${Math.round(k.runs.successRate * 100)}% success`} />
        <Stat label="Spend (7d)" value={`$${k.spend.d7.toFixed(2)}`} note={`$${k.spend.total.toFixed(2)} all time`} />
      </div>
    );
  }

  if (data.view === "deals" && data.deals) {
    const d = data.deals;
    return (
      <div>
        <div className="mb-2 text-[13px]" style={{ color: "var(--fg, #e8e2f0)" }}>
          <Gauge size={13} className="mr-1 inline" style={{ color: "var(--fg-dim, #9aa)" }} />
          {d.total} deal{d.total === 1 ? "" : "s"} on the board
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.columns.map((c) => (
            <span
              key={c.key ?? c.label}
              className="rounded-md px-2 py-1 font-mono text-[10px]"
              style={{ border: `1px solid ${c.accent ?? "var(--panel-border, #2a2436)"}55`, color: "var(--fg-dim, #9aa)" }}
            >
              {c.label ?? c.key}: {d.byStatus[c.key ?? ""] ?? 0}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return <Unavailable reason="payload shape not recognized" />;
}

// ─── agent-status ────────────────────────────────────────────────────────────
// Rendered with the SHARED StatusBand (CONVENTIONS §6 — palette lives THERE,
// never copied here).

interface AgentStatusPayload extends Record<string, unknown> {
  agents: Array<{
    id: string;
    name: string;
    status: "running" | "waiting" | "idle" | "error" | "offline";
    lastRunAt: number | null;
    runs: number;
  }>;
  total: number;
}

function agoMs(ms: number | null): string {
  if (ms == null) return "never ran";
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function AgentStatusWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<AgentStatusPayload>("agent-status", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  if (data.agents.length === 0) {
    return <EmptyState icon={<Bot size={16} />} title="No agents configured" hint="agents appear once they exist on disk" />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.agents.map((a) => (
        <div
          key={a.id}
          className="overflow-hidden rounded-lg"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        >
          <StatusBand status={a.status as StatusBandKind} height={3} />
          <div className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="truncate text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
              {a.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {a.status} · {agoMs(a.lastRunAt)} · {a.runs} run{a.runs === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      ))}
      {data.total > data.agents.length ? (
        <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          +{data.total - data.agents.length} more agent(s)
        </div>
      ) : null}
    </div>
  );
}

// ─── tasks-upcoming (H3.2 — REAL data over the v2 tasks store) ──────────────

// Task-status accents (NOT the StatusBand palette — CONVENTIONS §6 reserves
// those five hexes for agent status bands, and the home-ui smoke greps this
// file to keep them out; task chips use neighboring hues on purpose).
const TASK_STATUS_COLORS: Record<string, string> = {
  Todo: "var(--fg-dimmer, #6b6478)",
  Waiting: "#f59e0b",
  Ready: "#93c5fd",
  Working: "#4ade80",
  Review: "#c4b5fd",
  Done: "var(--fg-dimmer, #6b6478)",
};

function fmtDue(t: TasksUpcomingPayload["tasks"][number]): string {
  if (t.runAt) {
    const d = new Date(t.runAt);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (t.scheduledDate) return t.scheduledDate;
  return "";
}

function TasksUpcomingWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<TasksUpcomingPayload>("tasks-upcoming", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  if (data.tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo size={16} />}
        title={`No ${data.scope === "in-progress" ? "in-progress" : data.scope} tasks`}
        hint="tasks from /tasks land here"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.tasks.map((t) => (
        <Link
          key={t.id}
          href={`/tasks?task=${encodeURIComponent(t.id)}`}
          className="rounded-lg px-3 py-2"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        >
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {t.displayId}
            </span>
            <span className="truncate text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }} title={t.title}>
              {t.title || "(untitled)"}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: TASK_STATUS_COLORS[t.status] ?? "var(--fg-dim, #9aa)" }}>
              {t.status}
            </span>
          </div>
          {fmtDue(t) ? (
            <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>
              {t.runAt ? "due " : "scheduled "}
              {fmtDue(t)}
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

// ─── calendar (H3.3 — gcal connector via runtime.callTool) ──────────────────

function CalendarWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<CalendarPayload>("calendar", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  if (data.events.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={16} />}
        title={data.days === 1 ? "Nothing on today" : "Nothing in the next 7 days"}
        hint="events from the connected Google Calendar land here"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.events.map((ev, i) => (
        <div
          key={ev.id ?? `ev-${i}`}
          className="rounded-lg px-3 py-2"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        >
          <div className="truncate text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }} title={ev.summary}>
            {ev.summary}
          </div>
          <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>
            {ev.start}
            {ev.location ? ` · ${ev.location}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── newsletter-edition (SPEC-F K4.3 — the placeholder FILLED) ──────────────
// Headlines from the latest stored EditionDoc. A story with NO link renders as
// plain text, not a dead anchor (canonical_url is nullable — see the type note
// in widgets/types.ts), and the source count is the dedupe payoff made visible.

function NewsletterEditionWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<NewsletterEditionPayload>("newsletter-edition", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Edition · {data.edition.date} · {data.stats.stories}{" "}
        {data.stats.stories === 1 ? "story" : "stories"} from {data.stats.emails}{" "}
        {data.stats.emails === 1 ? "email" : "emails"}
      </div>
      {data.edition.sections.length === 0 && (
        <div className="text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
          No stories in this edition.
        </div>
      )}
      {data.edition.sections.map((s) => (
        <div key={s.topic}>
          <div className="mb-1 text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            {s.topic}
          </div>
          <div className="flex flex-col gap-1">
            {s.stories.map((story) => (
              <div key={story.id} className="flex items-baseline gap-1.5">
                {story.url ? (
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[11px] hover:underline"
                    style={{ color: "var(--fg-dim, #9aa)" }}
                    title={story.title}
                  >
                    {story.title}
                  </a>
                ) : (
                  <span
                    className="truncate text-[11px]"
                    style={{ color: "var(--fg-dim, #9aa)" }}
                    title={story.title}
                  >
                    {story.title}
                  </span>
                )}
                {story.sources.length > 1 && (
                  <span
                    className="shrink-0 font-mono text-[9px]"
                    style={{ color: "#4d9de0" }}
                    title={story.sources.join(" · ")}
                  >
                    ×{story.sources.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── anynotes-recent (SPEC-F I4.1) ──────────────────────────────────────────

// SPEC-F I4.1: the placeholder is FILLED. Cards link to the note's slide-over
// on /anynotes (the same ?note= deep link the attention.flag route uses), NOT
// to the captured source — text/screenshot notes have no url at all. The
// pending-@jarvis count is the widget's one live signal.
function AnynotesRecentWidget({ config }: WidgetComponentProps) {
  const { data, failed } = useWidgetData<AnynotesRecentPayload>("anynotes-recent", config);
  if (!data) return <Pending failed={failed} />;
  if (!data.available) return <Unavailable reason={data.reason} />;
  if (data.notes.length === 0) {
    return (
      <EmptyState
        icon={<StickyNote size={18} />}
        title="Nothing captured yet"
        hint="Paste a link, drop a screenshot or jot a note on /anynotes."
      />
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.pendingJarvis > 0 && (
        <div className="font-mono text-[10px]" style={{ color: "#e8a33d" }}>
          {data.pendingJarvis} @jarvis {data.pendingJarvis === 1 ? "reply" : "replies"} generating…
        </div>
      )}
      {data.notes.map((n) => (
        <Link
          key={n.id}
          href={`/anynotes?note=${n.id}`}
          className="rounded-lg px-3 py-2"
          style={{ border: "1px solid var(--panel-border, #2a2436)" }}
        >
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
              {n.title || "(untitled)"}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {n.type} · {fmtAgo(n.capturedAt)}
              {n.replyCount > 0 ? ` · ${n.replyCount} repl${n.replyCount === 1 ? "y" : "ies"}` : ""}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── legacy-* wrappers (H1.1) ───────────────────────────────────────────────
// Each renders the EXISTING Overview panel unchanged (§6.6 "wrappers, zero
// logic change") — the panels fetch as they already do (dataKind 'none').

function LegacyMissionWidget(_: WidgetComponentProps) {
  return <MissionStripe />;
}
function LegacyJarvisWidget(_: WidgetComponentProps) {
  return <JarvisModule />;
}
function LegacyTelemetryWidget(_: WidgetComponentProps) {
  return <TelemetryPanel />;
}
function LegacyKpiWidget(_: WidgetComponentProps) {
  return <KPIGrid />;
}
function LegacyTodoWidget(_: WidgetComponentProps) {
  return <TodoPanel />;
}
function LegacyDealsWidget(_: WidgetComponentProps) {
  return <DealDeskSummary />;
}
function LegacySystemmapWidget(_: WidgetComponentProps) {
  return <SystemMap />;
}
function LegacyTimelineWidget(_: WidgetComponentProps) {
  return <MiniTimeline />;
}

// ─── the map ────────────────────────────────────────────────────────────────

export const WIDGET_COMPONENTS: Record<string, ComponentType<WidgetComponentProps>> = {
  attention: AttentionWidget,
  "activity-feed": ActivityFeedWidget,
  "pipeline-stats": PipelineStatsWidget,
  "agent-status": AgentStatusWidget,
  "tasks-upcoming": TasksUpcomingWidget,
  calendar: CalendarWidget,
  "newsletter-edition": NewsletterEditionWidget,
  "anynotes-recent": AnynotesRecentWidget,
  "legacy-mission": LegacyMissionWidget,
  "legacy-jarvis": LegacyJarvisWidget,
  "legacy-telemetry": LegacyTelemetryWidget,
  "legacy-kpi": LegacyKpiWidget,
  "legacy-todo": LegacyTodoWidget,
  "legacy-deals": LegacyDealsWidget,
  "legacy-systemmap": LegacySystemmapWidget,
  "legacy-timeline": LegacyTimelineWidget,
};
