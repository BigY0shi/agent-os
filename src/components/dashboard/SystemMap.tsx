"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { useFleet } from "@/lib/store";
import type { Agent } from "@/lib/types";

// distribute agents around the bridge in a ring
function positions(n: number) {
  const cx = 50;
  const cy = 50;
  const r = 32;
  return Array.from({ length: n }).map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });
}

export function SystemMap() {
  const agents = useFleet((s) => s.agents);
  const pos = useMemo(() => positions(agents.length), [agents.length]);

  return (
    <GlassCard hudCorners className="h-full">
      <SectionHeader
        eyebrow="SYSTEM TOPOLOGY"
        title="Bridge ↔ agent mesh"
        hint={`Local Claude CLI bridge · ${agents.length} agents connected`}
      />
      <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.4)]">
        <div className="absolute inset-0 bg-hud-grid-fine opacity-40" />

        {/* concentric rings */}
        {[0.3, 0.55, 0.85].map((r) => (
          <div
            key={r}
            className="absolute rounded-full border border-dashed border-[var(--color-border)]"
            style={{
              left: `${50 - (r * 50)}%`,
              top: `${50 - (r * 50)}%`,
              width: `${r * 100}%`,
              height: `${r * 100}%`,
            }}
          />
        ))}

        {/* connections */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {agents.map((a, i) => (
            <motion.line
              key={a.id}
              x1={50}
              y1={50}
              x2={pos[i].x}
              y2={pos[i].y}
              stroke={a.accent.from}
              strokeOpacity={a.status === "running" ? 0.55 : 0.25}
              strokeWidth={0.4}
              strokeDasharray="1.5 1.5"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.2, delay: 0.15 * i }}
            />
          ))}
        </svg>

        {/* center bridge */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <motion.div
            className="grid h-12 w-12 place-items-center rounded-xl border border-[var(--color-neon)]/50 bg-[rgba(10,14,22,0.9)]"
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(111,255,155,0.45)",
                "0 0 0 14px rgba(111,255,155,0)",
              ],
            }}
            transition={{ duration: 2.2, repeat: Infinity }}
          >
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-neon)]">
              BRIDGE
            </span>
          </motion.div>
        </div>

        {/* sweep */}
        <motion.div
          className="pointer-events-none absolute inset-0 origin-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
          style={{
            background:
              "conic-gradient(from 0deg, rgba(111,255,155,0.22) 0deg, transparent 70deg)",
            mixBlendMode: "screen",
          }}
        />

        {/* agent nodes */}
        {agents.map((a, i) => (
          <AgentNode key={a.id} agent={a} x={pos[i].x} y={pos[i].y} />
        ))}
      </div>
    </GlassCard>
  );
}

function AgentNode({ agent, x, y }: { agent: Agent; x: number; y: number }) {
  return (
    <Link
      href={`/${agent.id}`}
      className="group absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
      title={`${agent.name} · ${agent.role}`}
    >
      <motion.div
        whileHover={{ scale: 1.18 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="relative"
      >
        <AgentAvatar agent={agent} size={36} />
      </motion.div>
      <div className="mt-1 -translate-x-1/2 transform whitespace-nowrap text-center font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-dim)] transition group-hover:text-[var(--color-neon)]">
        {agent.name}
      </div>
    </Link>
  );
}
