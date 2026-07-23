import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SectionHeader({
  eyebrow,
  title,
  hint,
  right,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  hint?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="flex flex-col gap-1">
        {eyebrow && (
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-faint)]">
            {eyebrow}
          </span>
        )}
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
          {title}
        </h2>
        {hint && (
          <span className="text-xs text-[var(--color-ink-dim)]">{hint}</span>
        )}
      </div>
      {right}
    </div>
  );
}
