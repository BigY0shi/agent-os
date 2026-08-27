"use client";

// ── StatusBand (CONVENTIONS §6) ──────────────────────────────────────────────
// THE shared status-band component. SPEC-E (F6.1) owns this file; created here
// by SPEC-B B4 because E hasn't landed — E adopts it at this exact path.
// Consumers: B4 AgentsSection, D H3.1, E F6. Palette is normative — do not
// fork these five hex values.

export type StatusBandKind = "running" | "idle" | "waiting" | "error" | "offline";

/** CONVENTIONS §6 single palette (matches existing sidebar accents). */
export const STATUS_BAND_COLORS: Record<StatusBandKind, string> = {
  running: "#34d399",
  idle: "#60a5fa",
  waiting: "#fbbf24", // waiting-on-me
  error: "#f87171",
  offline: "#9ca3af",
};

export const STATUS_BAND_LABELS: Record<StatusBandKind, string> = {
  running: "running",
  idle: "idle",
  waiting: "waiting on you",
  error: "error",
  offline: "offline",
};

/**
 * A 4px full-width color band (top edge of a card by default). `pulse` adds a
 * soft breathing animation — used for `running`.
 */
export default function StatusBand({
  status,
  height = 4,
  pulse,
  className,
}: {
  status: StatusBandKind;
  height?: number;
  pulse?: boolean;
  className?: string;
}) {
  const color = STATUS_BAND_COLORS[status] ?? STATUS_BAND_COLORS.offline;
  const animate = pulse ?? status === "running";
  return (
    <div
      className={className}
      role="status"
      aria-label={STATUS_BAND_LABELS[status] ?? status}
      title={STATUS_BAND_LABELS[status] ?? status}
      style={{
        height,
        width: "100%",
        background: color,
        boxShadow: `0 0 10px ${color}66`,
        animation: animate ? "statusband-pulse 2.2s ease-in-out infinite" : undefined,
      }}
    >
      <style>{`@keyframes statusband-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }`}</style>
    </div>
  );
}
