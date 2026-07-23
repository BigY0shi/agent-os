"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import type { Agent, AgentGlyph } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  agent: Pick<Agent, "name" | "glyph" | "accent" | "status">;
  size?: number;
  /** Animate idle motion (spinning ring, pulse). */
  animate?: boolean;
  className?: string;
  ring?: boolean;
}

/**
 * Unique SVG avatar for each agent. Themed glyph on a tinted disc.
 * The glyph rotates / floats subtly while the agent is running.
 */
export function AgentAvatar({
  agent,
  size = 40,
  animate = true,
  className,
  ring = true,
}: Props) {
  const rid = useId().replace(/[:]/g, "");
  const gradId = `agrad-${rid}`;
  const haloId = `ahalo-${rid}`;

  const running = agent.status === "running";

  return (
    <motion.div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      whileHover={{ scale: 1.06, rotate: 2 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
    >
      {/* outer ring + halo */}
      {ring && (
        <span
          className="absolute inset-0 rounded-2xl"
          style={{
            background: `linear-gradient(140deg, ${agent.accent.from}55, transparent 60%, ${agent.accent.to}55)`,
            padding: 1.5,
            WebkitMask:
              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        />
      )}

      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 h-full w-full"
        aria-label={`${agent.name} avatar`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={agent.accent.from} />
            <stop offset="100%" stopColor={agent.accent.to} />
          </linearGradient>
          <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={agent.accent.from} stopOpacity={0.45} />
            <stop offset="60%" stopColor={agent.accent.to} stopOpacity={0.12} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* halo */}
        <rect x="0" y="0" width="64" height="64" rx="14" fill={`url(#${haloId})`} />
        {/* disc */}
        <rect
          x="3"
          y="3"
          width="58"
          height="58"
          rx="13"
          fill="rgba(10,14,22,0.85)"
          stroke={`url(#${gradId})`}
          strokeOpacity={0.55}
          strokeWidth={1}
        />
        <Glyph
          glyph={agent.glyph}
          gradId={gradId}
          accent={agent.accent}
          animate={animate && running}
        />
      </svg>

      {/* live status pip */}
      {running && (
        <motion.span
          className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full border-2 border-[var(--color-bg-1)]"
          style={{
            background: agent.accent.from,
            boxShadow: `0 0 8px ${agent.accent.from}`,
          }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
}

function Glyph({
  glyph,
  gradId,
  accent,
  animate,
}: {
  glyph: AgentGlyph;
  gradId: string;
  accent: { from: string; to: string };
  animate: boolean;
}) {
  const stroke = `url(#${gradId})`;
  const fillSoft = accent.from;
  const dur = 12;

  const rotateProps = animate
    ? { animate: { rotate: 360 }, transition: { duration: dur, repeat: Infinity, ease: "linear" as const } }
    : {};
  const counterRotateProps = animate
    ? { animate: { rotate: -360 }, transition: { duration: dur * 1.4, repeat: Infinity, ease: "linear" as const } }
    : {};

  switch (glyph) {
    case "hex-orbit":
      return (
        <g>
          <motion.g style={{ transformOrigin: "32px 32px" }} {...rotateProps}>
            <polygon
              points="32,12 49,22 49,42 32,52 15,42 15,22"
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
            />
            <circle cx="32" cy="12" r="2.2" fill={fillSoft} />
            <circle cx="49" cy="22" r="1.5" fill={fillSoft} />
            <circle cx="49" cy="42" r="1.5" fill={fillSoft} />
          </motion.g>
          <circle cx="32" cy="32" r="3" fill={stroke} />
        </g>
      );

    case "triangle-stack":
      return (
        <g>
          <motion.g
            style={{ transformOrigin: "32px 34px" }}
            animate={animate ? { y: [-1, 2, -1] } : {}}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <polygon
              points="32,16 46,40 18,40"
              fill="none"
              stroke={stroke}
              strokeWidth={1.6}
            />
            <polygon
              points="32,24 42,40 22,40"
              fill={fillSoft}
              fillOpacity={0.25}
              stroke={stroke}
              strokeWidth={1.2}
            />
            <polygon points="32,32 38,40 26,40" fill={stroke} />
          </motion.g>
        </g>
      );

    case "ring-cross":
      return (
        <g>
          <circle
            cx="32"
            cy="32"
            r="16"
            fill="none"
            stroke={stroke}
            strokeWidth={1.4}
          />
          <motion.g style={{ transformOrigin: "32px 32px" }} {...counterRotateProps}>
            <line
              x1="14"
              y1="32"
              x2="50"
              y2="32"
              stroke={stroke}
              strokeWidth={1.2}
            />
            <line
              x1="32"
              y1="14"
              x2="32"
              y2="50"
              stroke={stroke}
              strokeWidth={1.2}
            />
          </motion.g>
          <circle cx="32" cy="32" r="3" fill={stroke} />
          <circle cx="48" cy="32" r="1.6" fill={fillSoft} />
          <circle cx="16" cy="32" r="1.6" fill={fillSoft} />
        </g>
      );

    case "spiral":
      return (
        <motion.g style={{ transformOrigin: "32px 32px" }} {...rotateProps}>
          <path
            d="M32 16 A16 16 0 1 1 16 32 A12 12 0 1 0 32 20 A8 8 0 1 1 24 28"
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <circle cx="24" cy="28" r="2" fill={fillSoft} />
        </motion.g>
      );

    case "dual-cone":
      return (
        <g>
          <motion.g
            style={{ transformOrigin: "32px 32px" }}
            animate={animate ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <polygon
              points="32,14 48,32 32,32"
              fill={fillSoft}
              fillOpacity={0.18}
              stroke={stroke}
              strokeWidth={1.4}
            />
            <polygon
              points="32,50 16,32 32,32"
              fill={fillSoft}
              fillOpacity={0.35}
              stroke={stroke}
              strokeWidth={1.4}
            />
          </motion.g>
          <line
            x1="32"
            y1="10"
            x2="32"
            y2="54"
            stroke={stroke}
            strokeOpacity={0.4}
            strokeDasharray="2 3"
          />
        </g>
      );

    case "fractal":
      return (
        <motion.g style={{ transformOrigin: "32px 32px" }} {...rotateProps}>
          <path
            d="M32 12 L32 30 M22 22 L32 30 L42 22 M16 32 L32 30 L48 32 M22 42 L32 30 L42 42 M32 52 L32 30"
            stroke={stroke}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="32" cy="30" r="3" fill={stroke} />
          <circle cx="32" cy="12" r="1.6" fill={fillSoft} />
          <circle cx="16" cy="32" r="1.6" fill={fillSoft} />
          <circle cx="48" cy="32" r="1.6" fill={fillSoft} />
          <circle cx="32" cy="52" r="1.6" fill={fillSoft} />
        </motion.g>
      );
  }
}
