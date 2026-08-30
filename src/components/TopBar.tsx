"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import CommandPalette from "./CommandPalette";
import { metaFor } from "@/lib/pageMeta";

export default function TopBar() {
  const pathname = usePathname();
  const t = metaFor(pathname);
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const set = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" }));
    set();
    const i = setInterval(set, 1000 * 15);
    return () => clearInterval(i);
  }, []);

  return (
    <header className="flex items-start justify-between gap-6 mb-10">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="min-w-0"
      >
        {/* Chapter eyebrow — `I. ───── MISSION CONTROL` */}
        <div className="eyebrow">
          <span className="num">{t.numeral}</span>
          <span className="line" />
          <span className="label">{t.label}</span>
        </div>

        <h1 className="page-title">{t.title}</h1>
        {t.sub && <p className="page-subtitle">{t.sub}</p>}

        <div className="mt-4 status-meta">
          <span className="hand">{time}</span>
          <span className="mx-2 opacity-40">·</span>
          Local · Studio
        </div>
      </motion.div>

      <div className="flex items-center gap-3 pt-2 shrink-0">
        <CommandPalette />
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--line-soft)] text-[11px]"
             style={{ color: "var(--cream-dim)", background: "rgba(243,235,218,0.02)" }}>
          <span className="inline-flex">
            <span className="tick live" style={{ color: "var(--gold)" }} />
            <span className="tick live" style={{ color: "var(--gold-soft)", animationDelay: ".15s" }} />
            <span className="tick live" style={{ color: "var(--emerald)", animationDelay: ".3s" }} />
            <span className="tick live" style={{ color: "var(--rust)", animationDelay: ".45s" }} />
          </span>
          <span className="uppercase tracking-widest" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600 }}>
            All systems
          </span>
        </div>
      </div>
    </header>
  );
}
