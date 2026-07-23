"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { useFleet } from "@/lib/store";

export function FleetSummary() {
  const agents = useFleet((s) => s.agents);
  return (
    <GlassCard hudCorners className="flex h-full flex-col">
      <SectionHeader
        eyebrow="AGENT FLEET"
        title="Live roster"
        hint={`${agents.length} agents · ${agents.filter((a) => a.status === "running").length} active`}
        right={
          <Link
            href="/agents"
            className="flex items-center gap-0.5 font-mono text-[10.5px] uppercase tracking-widest text-[var(--color-neon)] hover:underline"
          >
            Manage <ChevronRight className="h-3 w-3" />
          </Link>
        }
      />

      <div className="mt-4 flex-1 overflow-y-auto scrollbar-thin">
        {agents.length === 0 ? (
          <div className="grid h-36 place-items-center rounded-xl border border-dashed border-[var(--color-border)] font-mono text-[11px] text-[var(--color-ink-faint)]">
            No agents registered.
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {agents.map((agent, i) => (
              <motion.li
                key={agent.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  href={`/agents/${agent.id}`}
                  className="group flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[rgba(255,255,255,0.01)] p-3 transition hover:border-[var(--color-border-strong)] hover:bg-[rgba(255,255,255,0.03)]"
                >
                  <div className="flex items-center gap-3">
                    <AgentAvatar agent={agent} size={38} />
                    <div>
                      <div className="text-[13.5px] font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-neon)] transition">
                        {agent.name}
                      </div>
                      <div className="text-xs text-[var(--color-ink-dim)]">
                        {agent.role}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden text-right font-mono text-[10.5px] tracking-wider sm:block">
                      <div className="text-[var(--color-ink-faint)]">
                        {agent.model}
                      </div>
                      <div className="text-[var(--color-ink-dim)]">
                        ${agent.costUsd.toFixed(2)} accrued
                      </div>
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
