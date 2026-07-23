import { cn } from "@/lib/cn";

const toneMap = {
  ok: "bg-[var(--color-neon)] shadow-[0_0_12px_var(--color-neon-glow)]",
  warn: "bg-[var(--color-warn)] shadow-[0_0_10px_rgba(255,181,71,0.5)]",
  error: "bg-[var(--color-danger)] shadow-[0_0_10px_rgba(255,90,107,0.5)]",
  idle: "bg-[var(--color-ink-faint)]",
  info: "bg-[var(--color-info)] shadow-[0_0_10px_rgba(111,184,255,0.5)]",
} as const;

export function StatusDot({
  tone = "ok",
  size = 8,
  pulse = true,
  className,
}: {
  tone?: keyof typeof toneMap;
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-block rounded-full",
        toneMap[tone],
        pulse && tone !== "idle" && "animate-pulse-dot",
        className,
      )}
    />
  );
}
