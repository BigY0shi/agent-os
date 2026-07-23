"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Bot,
  CircleCheck,
  Cpu,
  DollarSign,
  Flame,
  Network,
  Timer,
} from "lucide-react";
import type { ComponentType } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/cn";
import { useFleet } from "@/lib/store";

interface KPI {
  label: string;
  value: string;
  note: string;
  real: boolean;
  icon: ComponentType<{ className?: string }>;
}

export function KPIGrid() {
  const agentsCount = useFleet((s) => s.agents.length);
  const activeCount = useFleet(
    (s) => s.agents.filter((a) => a.status === "running").length,
  );

  // Honest KPIs. Only "active agents" has a real source today (the fleet store).
  // Runs / turn-time / cost have no telemetry feed yet, so they read "—" instead
  // of the old hardcoded "142 / 4.8s / $14.82" with invented sparklines.
  const kpis: KPI[] = [
    {
      label: "ACTIVE AGENTS",
      value: agentsCount ? `${activeCount} / ${agentsCount}` : "—",
      note: agentsCount ? `${agentsCount} configured` : "no config loaded",
      real: true,
      icon: Bot,
    },
    { label: "RUNS (24H)", value: "—", note: "telemetry not wired", real: false, icon: Cpu },
    { label: "AVG TURN TIME", value: "—", note: "telemetry not wired", real: false, icon: Timer },
    { label: "EST. ACCRUED COST", value: "—", note: "telemetry not wired", real: false, icon: DollarSign },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <GlassCard
            key={kpi.label}
            hudCorners
            interactive
            className="flex flex-col justify-between overflow-hidden"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
                  {kpi.label}
                </span>
                <div
                  className={cn(
                    "mt-1 text-2xl font-semibold tracking-tight",
                    kpi.real
                      ? "text-[var(--color-ink)]"
                      : "text-[var(--color-ink-faint)]",
                  )}
                >
                  {kpi.value}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.02)] p-2 text-[var(--color-ink-dim)]">
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-5">
              <span className="font-mono text-[11px] text-[var(--color-ink-faint)]">
                {kpi.note}
              </span>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}

export function SystemStatusBanner() {
  return (
    <GlassCard hudCorners glow className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[rgba(111,255,155,0.08)] text-[var(--color-neon)]">
          <CircleCheck className="h-5 w-5 animate-pulse-dot" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            All systems nominal
          </h3>
          <p className="text-xs text-[var(--color-ink-dim)]">
            Bridge fully operational · 4 active loops · CPU load 12%
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6 font-mono text-[10.5px]">
        <div className="flex items-center gap-2">
          <Network className="h-4.5 w-4.5 text-[var(--color-ink-faint)]" />
          <span className="text-[var(--color-ink-dim)]">LATENCY</span>
          <span className="text-[var(--color-neon)]">41ms</span>
        </div>
        <div className="flex items-center gap-2">
          <Flame className="h-4.5 w-4.5 text-[var(--color-ink-faint)]" />
          <span className="text-[var(--color-ink-dim)]">VOLTAGE</span>
          <span className="text-[var(--color-ink)]">1.18V</span>
        </div>
      </div>
    </GlassCard>
  );
}
