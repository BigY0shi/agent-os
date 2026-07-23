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
import { seedTimeline } from "@/lib/mock-data";
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
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function MiniTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>(seedTimeline);

  useEffect(() => {
    const id = setInterval(() => {
      setEvents((prev) => {
        const cycled = [...prev];
        // simulate a new event arriving
        const next: TimelineEvent = {
          id: `live_${Date.now()}`,
          ts: new Date().toISOString(),
          level: ["info", "success", "tool", "warn"][
            Math.floor(Math.random() * 4)
          ] as TimelineEvent["level"],
          category: "agent",
          agentName: ["Atlas", "Orion", "Vega", "Lyra"][
            Math.floor(Math.random() * 4)
          ],
          title: [
            "Read package.json",
            "Edit lib/auth.ts",
            "Bash(pnpm test --filter api)",
            "Assistant turn (322 tok)",
            "Grep('TODO', src/**)",
          ][Math.floor(Math.random() * 5)],
        };
        return [next, ...cycled].slice(0, 8);
      });
    }, 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <GlassCard hudCorners className="flex h-full flex-col">
      <SectionHeader
        eyebrow="MISSION TIMELINE"
        title="Live event stream"
        hint="Newest first · auto-updating"
        right={
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-neon)]">
            <Circle className="h-2 w-2 animate-pulse-dot fill-current" /> LIVE
          </span>
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
      </ul>
    </GlassCard>
  );
}
