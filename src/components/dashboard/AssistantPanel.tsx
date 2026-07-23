"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";

// Honest state. The old version showed fabricated recommendations about agents
// that don't exist (Atlas/Orion/Vega/Lyra), a fake "PR #4218", a "● LIVE" badge,
// and a dead "Execute plan" button. There is no live recommendation engine yet,
// so this panel says so and points at the real chat.
export function AssistantPanel() {
  return (
    <GlassCard strong hudCorners glow className="relative overflow-hidden p-0">
      <div className="absolute inset-0 -z-10">
        <motion.div
          className="absolute -right-20 -top-20 h-72 w-72 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(111,255,155,0.35) 0%, transparent 60%)",
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="flex items-start justify-between gap-3 p-5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[rgba(111,255,155,0.12)] text-[var(--color-neon)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
              MISSION ASSISTANT
            </div>
            <div className="text-sm text-[var(--color-ink)]">
              Plan your next moves with Claude
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] p-4">
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-dim)]">
            Live fleet recommendations aren&rsquo;t wired up yet — this panel will
            surface real suggestions once agent telemetry is connected. Until then,
            open a chat to plan directly with Claude.
          </p>
          <Link
            href="/claude"
            className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-[var(--color-neon)] hover:underline"
          >
            Open chat with Claude &rarr;
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}
