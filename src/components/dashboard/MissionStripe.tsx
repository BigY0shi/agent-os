"use client";

import { motion } from "framer-motion";

// Honest static identity only. The old version showed a frozen fake UPTIME
// ("07:42:14"), a fake BRIDGE version, and a fake BUILD tag — all removed.
const items = [
  { k: "OP", v: "COMMAND CENTER" },
  { k: "PHASE", v: "RUNTIME" },
  { k: "BRIDGE", v: "claude · CLI" },
  { k: "REGION", v: "LOCAL · LAN" },
  { k: "USERS", v: "1 · operator" },
];

export function MissionStripe() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.18em]">
        {items.map((it) => (
          <span key={it.k} className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[var(--color-ink-faint)]">{it.k}</span>
            <span className="text-[var(--color-ink)]">{it.v}</span>
          </span>
        ))}
      </div>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/3"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(111,255,155,0.08), transparent)",
        }}
        animate={{ x: ["-50%", "350%"] }}
        transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
      />
    </div>
  );
}
