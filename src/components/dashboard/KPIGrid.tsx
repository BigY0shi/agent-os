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
import { Sparkline } from "@/components/ui/Sparkline";
import { cn } from "@/lib/cn";

interface KPI {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: ComponentType<{ className?: string }>;
  data: number[];
  accent: string;
}

const mockKPIs: KPI[] = [
  {
    label: "ACTIVE AGENTS",
    value: "4 / 7",
    delta: "3 online",
    positive: true,
    icon: Bot,
    data: [2, 3, 3, 4, 3, 4, 4],
    accent: "var(--color-neon)",
  },
  {
    label: "TOTAL RUNS (24H)",
    value: "142",
    delta: "+18.4%",
    positive: true,
    icon: Cpu,
    data: [90, 105, 115, 110, 125, 130, 142],
    accent: "var(--color-neon)",
  },
  {
    label: "AVG TURN TIME",
    value: "4.8s",
    delta: "-12.5%",
    positive: true,
    icon: Timer,
    data: [6.1, 5.8, 5.5, 5.2, 5.0, 4.9, 4.8],
    accent: "var(--color-neon)",
  },
  {
    label: "EST. ACCRUED COST",
    value: "$14.82",
    delta: "+$3.10",
    positive: false,
    icon: DollarSign,
    data: [4.2, 6.1, 8.5, 10.2, 11.8, 13.1, 14.82],
    accent: "var(--color-warn)",
  },
];

export function KPIGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {mockKPIs.map((kpi, idx) => {
        const Icon = kpi.icon;
        return (
          <GlassCard
            key={kpi.label}
            hudCorners
            interactive
            className="flex flex-col justify-between overflow-hidden"
          >
            {/* aurora backing */}
            <div className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div
                className="absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
                style={{
                  background: `radial-gradient(circle, ${kpi.accent}20 0%, transparent 70%)`,
                }}
              />
            </div>

            <div className="flex items-start justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
                  {kpi.label}
                </span>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                  {kpi.value}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border-strong)] bg-[rgba(255,255,255,0.02)] p-2 text-[var(--color-ink-dim)] transition group-hover:border-[var(--color-neon)]/30 group-hover:text-[var(--color-neon)]">
                <Icon className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <span
                className={cn(
                  "font-mono text-[11px]",
                  kpi.positive
                    ? "text-[var(--color-neon)]"
                    : "text-[var(--color-warn)]",
                )}
              >
                {kpi.delta}
              </span>
              <div className="h-7 w-24">
                <Sparkline
                  data={kpi.data}
                  stroke={kpi.accent}
                  fill={`${kpi.accent}12`}
                />
              </div>
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
