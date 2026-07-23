"use client";

import { motion } from "framer-motion";
import { Sparkles, Wand2 } from "lucide-react";
import { NeonButton } from "@/components/ui/NeonButton";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFleet } from "@/lib/store";

function getGreeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Burning the midnight oil";
}

export function HeroGreeting({ name }: { name?: string }) {
  const operator = useFleet((s) => s.operatorName);
  const agentsCount = useFleet((s) => s.agents.length);
  const activeCount = useFleet(
    (s) => s.agents.filter((a) => a.status === "running").length,
  );
  const remoteCount = useFleet(
    (s) => s.agents.filter((a) => a.kind === "remote-http").length,
  );
  const displayName = name ?? operator ?? "Operator";
  const router = useRouter();
  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => {
    setGreeting(getGreeting(new Date()));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[rgba(10,14,22,0.55)] p-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between"
    >
      {/* aurora */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-72 w-96 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(111,255,155,0.18), transparent 60%)",
        }}
        animate={{ x: [0, 20, 0], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-72 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(108,75,255,0.18), transparent 60%)",
        }}
        animate={{ x: [0, -10, 0], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      <div className="relative flex items-start gap-4">
        <motion.div
          className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--color-neon)]/30 bg-[rgba(111,255,155,0.08)]"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(111,255,155,0.35)",
              "0 0 0 12px rgba(111,255,155,0)",
            ],
          }}
          transition={{ duration: 2.6, repeat: Infinity }}
        >
          <Sparkles className="h-5 w-5 text-[var(--color-neon)]" />
        </motion.div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-faint)]">
            COMMAND CENTER · v0.1
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            <span className="text-gradient">{greeting}</span>
            <span className="text-[var(--color-ink)]">, {displayName}.</span>
          </h1>
          <p className="text-[13px] text-[var(--color-ink-dim)]">
            {agentsCount} agents configured · {activeCount} active
            {remoteCount ? ` · ${remoteCount} remote` : ""}.
          </p>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-2">
        <NeonButton onClick={() => router.push("/pipeline")}>
          <Wand2 className="h-3 w-3" /> Run plan
        </NeonButton>
        <NeonButton variant="ghost" onClick={() => router.push("/claude")}>
          <Sparkles className="h-3 w-3" /> Open chat
        </NeonButton>
      </div>
    </motion.div>
  );
}
