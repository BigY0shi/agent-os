"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Info,
  Wrench,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { TimelineEvent } from "@/lib/types";
import { cn } from "@/lib/cn";

const iconMap = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertTriangle,
  tool: Wrench,
} as const;

const toneClass = {
  info: "text-[var(--color-info)]",
  success: "text-[var(--color-neon)]",
  warn: "text-[var(--color-warn)]",
  error: "text-[var(--color-danger)]",
  tool: "text-[var(--color-ink-dim)]",
} as const;

function shortTime(iso: string) {
  // "" = the source line carried no time (never invented; see /api/activity).
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

interface ActivityEntry {
  ts: number | null;
  agent: string;
  text: string;
  level?: string;
}

function toLevel(l?: string): TimelineEvent["level"] {
  return l === "err" ? "error" : l === "warn" ? "warn" : "info";
}

export function MiniTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // Real feed: /api/activity tails the actual openclaw + hermes agent logs.
        const res = await fetch("/api/activity", { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        const entries: ActivityEntry[] = Array.isArray(j.entries) ? j.entries : [];
        setEvents(
          entries.slice(0, 8).map((e, i) => ({
            id: `${e.agent}-${e.ts}-${i}`,
            ts: e.ts == null ? "" : new Date(e.ts).toISOString(),
            level: toLevel(e.level),
            category: "agent" as const,
            agentName: e.agent,
            title: e.text,
          })),
        );
      } catch {
        /* transient network error — keep the last good events */
      } finally {
        if (alive) setLoaded(true);
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const live = events.length > 0;

  return (
    <GlassCard hudCorners className="flex h-full flex-col">
      <SectionHeader
        eyebrow="MISSION TIMELINE"
        title="Live event stream"
        hint="Newest first · agent logs"
        right={
          live ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-neon)]">
              <Circle className="h-2 w-2 animate-pulse-dot fill-current" /> LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
              <Circle className="h-2 w-2 fill-current" /> IDLE
            </span>
          )
        }
      />

      <ul className="relative mt-4 flex-1 overflow-hidden">
        <span className="absolute left-3 top-0 h-full w-px bg-gradient-to-b from-transparent via-[var(--color-border-strong)] to-transparent" />
        <AnimatePresence initial={false}>
          {events.map((e) => {
            const Icon = iconMap[e.level];
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="relative flex items-start gap-3 py-2 pl-8"
              >
                <span
                  className={cn(
                    "absolute left-2 top-3 grid h-3 w-3 -translate-x-1/2 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-1)]",
                    toneClass[e.level],
                  )}
                >
                  <Icon className="h-[10px] w-[10px]" />
                </span>
                <div className="flex flex-1 items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[var(--color-ink)]">
                      {e.title}
                    </div>
                    {e.detail && (
                      <div className="truncate text-xs text-[var(--color-ink-dim)]">
                        {e.detail}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
                    {e.agentName && (
                      <span className="text-[var(--color-ink-dim)]">
                        {e.agentName}
                      </span>
                    )}
                    {/* time formats in the runtime's timezone — server (UTC) vs client
                        (local) legitimately differ, so suppress the hydration warning */}
                    <span suppressHydrationWarning>{shortTime(e.ts)}</span>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {loaded && !live && (
          <li className="relative flex items-start gap-3 py-2 pl-8 text-sm text-[var(--color-ink-faint)]">
            No recent activity in the agent logs.
          </li>
        )}
      </ul>
    </GlassCard>
  );
}
