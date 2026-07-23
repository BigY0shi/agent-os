"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

export function Bars({
  data,
  height = 72,
  highlightIndex,
}: {
  data: number[];
  height?: number;
  highlightIndex?: number;
}) {
  const max = useMemo(() => Math.max(...data, 1), [data]);
  return (
    <div
      className="flex items-end gap-[3px]"
      style={{ height }}
      aria-hidden
    >
      {data.map((v, i) => {
        const h = Math.max(2, (v / max) * height);
        const isHi = i === highlightIndex;
        return (
          <motion.div
            key={i}
            initial={{ height: 0, opacity: 0.4 }}
            animate={{ height: h, opacity: 1 }}
            transition={{ delay: i * 0.012, duration: 0.5, ease: "easeOut" }}
            style={{
              width: 6,
              background: isHi
                ? "linear-gradient(180deg, var(--color-neon), rgba(111,255,155,0.2))"
                : "linear-gradient(180deg, rgba(111,255,155,0.55), rgba(111,255,155,0.05))",
              boxShadow: isHi ? "0 0 12px var(--color-neon-glow)" : undefined,
              borderRadius: 2,
            }}
          />
        );
      })}
    </div>
  );
}
