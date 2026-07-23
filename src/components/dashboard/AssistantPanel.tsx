"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, Wand2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { NeonButton } from "@/components/ui/NeonButton";

const recs = [
  {
    title: "Atlas can ship the billing refactor",
    body: "All test gates passed. Suggest merging PR #4218 to main.",
    conf: 0.91,
  },
  {
    title: "Pause Vega — context window 78%",
    body: "Compact transcript or fork into review-only agent.",
    conf: 0.74,
  },
  {
    title: "Spin up `docs/lyra` for release notes",
    body: "v3.4 has 12 unannotated commits.",
    conf: 0.68,
  },
];

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
              Recommends next moves across your fleet
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-neon)]">
          ● LIVE
        </span>
      </div>

      <div className="px-5">
        <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)] p-4">
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
            <span className="text-[var(--color-neon)]">Atlas</span> finished
            mapping the monorepo. <span className="text-[var(--color-neon)]">Orion</span>
            ’s test run is green. Recommend you merge <span className="font-mono text-[var(--color-ink-dim)]">PR #4218</span>
            and re-deploy <span className="font-mono text-[var(--color-ink-dim)]">api-edge</span>.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <NeonButton size="sm">
              <Wand2 className="h-3 w-3" /> Execute plan
            </NeonButton>
            <NeonButton variant="ghost" size="sm">
              Dismiss
            </NeonButton>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
          INSIGHTS
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {recs.map((r, i) => (
            <motion.li
              key={r.title}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="group flex items-start justify-between gap-3 rounded-lg border border-transparent p-2 transition hover:border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.02)]"
            >
              <div>
                <div className="text-sm text-[var(--color-ink)]">{r.title}</div>
                <div className="text-xs text-[var(--color-ink-dim)]">{r.body}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-[10px] text-[var(--color-neon)]">
                  conf {r.conf.toFixed(2)}
                </span>
                <ArrowUpRight className="h-3 w-3 text-[var(--color-ink-faint)] transition group-hover:text-[var(--color-neon)]" />
              </div>
            </motion.li>
          ))}
        </ul>

        <Link
          href="/chat"
          className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-[var(--color-neon)] hover:underline"
        >
          Open chat with Claude →
        </Link>
      </div>
    </GlassCard>
  );
}
