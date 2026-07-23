"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = HTMLMotionProps<"div"> & {
  children: ReactNode;
  hudCorners?: boolean;
  strong?: boolean;
  glow?: boolean;
  /** Adds a subtle sheen + lift on hover. */
  interactive?: boolean;
};

export function GlassCard({
  children,
  className,
  hudCorners = false,
  strong = false,
  glow = false,
  interactive = false,
  ...rest
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={interactive ? { y: -2 } : undefined}
      className={cn(
        "group relative overflow-hidden rounded-2xl p-5",
        strong ? "glass-strong" : "glass",
        hudCorners && "hud-corners",
        glow && "neon-ring",
        interactive &&
          "transition hover:border-[var(--color-border-strong)] hover:shadow-[0_30px_80px_-30px_rgba(111,255,155,0.18)]",
        className,
      )}
      {...rest}
    >
      {hudCorners && (
        <>
          <span className="hud-c1" />
          <span className="hud-c2" />
        </>
      )}
      {interactive && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
      )}
      {children}
    </motion.div>
  );
}
