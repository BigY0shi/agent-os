"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "danger";

interface Props extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: "sm" | "md";
}

const styles: Record<Variant, string> = {
  primary:
    "bg-[rgba(111,255,155,0.10)] text-[var(--color-neon)] border-[var(--color-neon)]/40 hover:bg-[rgba(111,255,155,0.18)] hover:shadow-[0_0_24px_var(--color-neon-glow)]",
  ghost:
    "bg-[rgba(255,255,255,0.02)] text-[var(--color-ink-dim)] border-[var(--color-border)] hover:text-[var(--color-ink)] hover:border-[var(--color-border-strong)]",
  danger:
    "bg-[rgba(255,90,107,0.08)] text-[var(--color-danger)] border-[rgba(255,90,107,0.35)] hover:bg-[rgba(255,90,107,0.16)]",
};

export const NeonButton = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", size = "md", className, children, ...rest }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "inline-flex select-none items-center gap-2 rounded-lg border font-mono uppercase tracking-[0.14em] transition",
          size === "sm" ? "px-2.5 py-1 text-[10px]" : "px-3.5 py-2 text-[11px]",
          styles[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
NeonButton.displayName = "NeonButton";
