import { cn } from "@/lib/cn";
import type { AgentStatus } from "@/lib/types";

const statusStyle: Record<AgentStatus, string> = {
  idle: "text-[var(--color-ink-dim)] bg-[rgba(255,255,255,0.04)] border-[var(--color-border)]",
  running:
    "text-[var(--color-neon)] bg-[rgba(111,255,155,0.08)] border-[var(--color-neon)]/30",
  paused:
    "text-[var(--color-warn)] bg-[rgba(255,181,71,0.08)] border-[rgba(255,181,71,0.3)]",
  error:
    "text-[var(--color-danger)] bg-[rgba(255,90,107,0.08)] border-[rgba(255,90,107,0.3)]",
  completed:
    "text-[var(--color-info)] bg-[rgba(111,184,255,0.08)] border-[rgba(111,184,255,0.3)]",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        statusStyle[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function PriorityBadge({
  priority,
}: {
  priority: "low" | "medium" | "high";
}) {
  const map = {
    low: "text-[var(--color-info)] border-[rgba(111,184,255,0.3)] bg-[rgba(111,184,255,0.08)]",
    medium:
      "text-[var(--color-warn)] border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)]",
    high: "text-[var(--color-danger)] border-[rgba(255,90,107,0.3)] bg-[rgba(255,90,107,0.08)]",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
        map[priority],
      )}
    >
      {priority}
    </span>
  );
}
