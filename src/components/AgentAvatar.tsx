"use client";

import { motion } from "framer-motion";
import { generateMark, accentFor, type AgentMark } from "@/lib/agentFaces";
import { useAgentFaces } from "@/lib/agentFacesClient";

export type AgentKey = "claude" | "openclaw" | "hermes" | "gemini" | "antigravity" | "fcc" | "codex" | "cursor" | "pi" | "ollama" | "kimi" | "glm" | "grok";

interface Props {
  /** A hand-drawn key draws its own mark below; any other id (a crew agent's UUID, a
   *  room specialist, a Hermes profile) draws its generated Rorschach mark (S35). */
  agent: AgentKey | string;
  size?: number;
  pulse?: boolean;
  /** Accessible name for a generated mark; defaults to the id. */
  name?: string;
  /** Draw a generated mark from this seed instead of the stored/id-derived one (previews). */
  seed?: number | null;
}

const STYLE: Record<AgentKey, {
  accent: string;
  bg: string;
  gradient: string;
  label: string;
  glyph: (size: number) => React.ReactNode;
}> = {
  claude: {
    accent: "#d97757",
    bg: "rgba(217,119,87,0.18)",
    gradient: "linear-gradient(135deg, #f4a07a, #c0563a)",
    label: "Claude",
    glyph: (s) => (
      <svg width={s * 0.55} height={s * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2 L13.6 9 L21 10.4 L13.6 12.4 L12 22 L10.4 12.4 L3 10.4 L10.4 9 Z"
          fill="white"
          opacity="0.95"
        />
      </svg>
    ),
  },
  openclaw: {
    accent: "#f472b6",
    bg: "rgba(244,114,182,0.18)",
    gradient: "linear-gradient(135deg, #fda4d3, #c9268f)",
    label: "OpenClaw",
    glyph: (s) => (
      // Stylized claw mark
      <svg width={s * 0.6} height={s * 0.6} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round">
        <path d="M5 4 C 8 8, 8 14, 5 19" opacity="0.95" />
        <path d="M11 3 C 14 7, 14 16, 11 21" opacity="0.95" />
        <path d="M17 5 C 19 9, 19 15, 17 20" opacity="0.95" />
      </svg>
    ),
  },
  hermes: {
    accent: "#60a5fa",
    bg: "rgba(96,165,250,0.18)",
    gradient: "linear-gradient(135deg, #93c5fd, #2563eb)",
    label: "Hermes",
    glyph: (s) => (
      // Caduceus-style wing mark
      <svg width={s * 0.6} height={s * 0.6} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3 L12 21 M12 5 C 8 8, 6 7, 4 5 C 6 9, 9 10, 12 9 C 15 10, 18 9, 20 5 C 18 7, 16 8, 12 5"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        <circle cx="12" cy="3" r="1.2" fill="white" opacity="0.95" />
      </svg>
    ),
  },
  gemini: {
    // Google's Gemini palette — blue/red/yellow/green sweep + the four-pointed star glyph.
    accent: "#4285F4",
    bg: "rgba(66,133,244,0.18)",
    gradient: "linear-gradient(135deg, #4285F4 0%, #9b72cb 35%, #d96570 65%, #f9ab00 100%)",
    label: "Gemini",
    glyph: (s) => (
      <svg width={s * 0.55} height={s * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4 L13 10 L18 12 L13 14 L12 20 L11 14 L6 12 L11 10 Z"
          fill="white"
          opacity="0.98"
        />
      </svg>
    ),
  },
  fcc: {
    // Free Claude Code = the open-source proxy sibling. Green/emerald gradient to
    // signal "free", with a stylised owl glyph (the default upstream is Owl Alpha).
    accent: "#10b981",
    bg: "rgba(16,185,129,0.18)",
    gradient: "linear-gradient(135deg, #34d399 0%, #10b981 60%, #065f46 100%)",
    label: "Free Claude Code",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        {/* Owl silhouette: two big round eyes + small triangle beak + ear tufts */}
        <path
          d="M5 4 L7 7 M19 4 L17 7"
          stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.95"
        />
        <circle cx="9" cy="11" r="3.2" fill="white" opacity="0.95" />
        <circle cx="15" cy="11" r="3.2" fill="white" opacity="0.95" />
        <circle cx="9" cy="11" r="1.2" fill="#065f46" />
        <circle cx="15" cy="11" r="1.2" fill="#065f46" />
        <path
          d="M11 14 L12 16 L13 14 Z"
          fill="white" opacity="0.9"
        />
        <path
          d="M6 17 C 8 19, 16 19, 18 17"
          stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85"
        />
      </svg>
    ),
  },
  codex: {
    // Codex (OpenAI) — onyx/charcoal gradient + open-spiral mark (riff on the
    // OpenAI logo without copying it). Sits visually between Claude and Gemini.
    accent: "#22c55e",
    bg: "rgba(34,197,94,0.18)",
    gradient: "linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 45%, #166534 100%)",
    label: "Codex",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        {/* Six-petal rosette à la OpenAI mark, rendered with thin strokes */}
        <g stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.96">
          <path d="M12 4 C 16 6, 16 10, 12 12 C 8 10, 8 6, 12 4 Z" />
          <path d="M19 8.5 C 19 12.5, 16 14.5, 12 12 C 12.5 8, 15.5 6.5, 19 8.5 Z" />
          <path d="M19 15.5 C 16 18, 13 16.5, 12 12 C 16 11, 18.5 12.5, 19 15.5 Z" />
          <path d="M12 20 C 8 18, 8 14, 12 12 C 16 14, 16 18, 12 20 Z" />
          <path d="M5 15.5 C 5.5 12.5, 8.5 11, 12 12 C 11 16.5, 8 18, 5 15.5 Z" />
          <path d="M5 8.5 C 8 6.5, 11.5 8, 12 12 C 8 14.5, 5 12.5, 5 8.5 Z" />
        </g>
      </svg>
    ),
  },
  cursor: {
    // Cursor CLI — Cursor's monochrome graphite identity + a mouse-cursor arrow glyph.
    accent: "#cbd5e1",
    bg: "rgba(203,213,225,0.18)",
    gradient: "linear-gradient(135deg, #0b0d12 0%, #3b4252 55%, #cbd5e1 100%)",
    label: "Cursor",
    glyph: (s) => (
      <svg width={s * 0.58} height={s * 0.58} viewBox="0 0 24 24" fill="none">
        <path d="M5 3 L5 18 L9 14 L11.5 20 L14 19 L11.5 13 L17 13 Z" fill="white" opacity="0.96" />
      </svg>
    ),
  },
  ollama: {
    // Ollama — open models, hosted/local. Soft blue gradient + a cloud glyph.
    accent: "#6CA8FF",
    bg: "rgba(108,168,255,0.18)",
    gradient: "linear-gradient(135deg, #0b1220 0%, #2a4a7a 55%, #6CA8FF 100%)",
    label: "Ollama",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M6.5 17.5 A4 4 0 0 1 6.8 9.6 A5.2 5.2 0 0 1 16.6 8.4 A3.6 3.6 0 0 1 17.6 17.5 Z" fill="white" opacity="0.95" />
      </svg>
    ),
  },
  pi: {
    // Pi coding CLI (@mariozechner/pi-coding-agent) — warm amber gradient + the π glyph.
    accent: "#fbbf24",
    bg: "rgba(251,191,36,0.18)",
    gradient: "linear-gradient(135deg, #fcd34d 0%, #f59e0b 55%, #b45309 100%)",
    label: "Pi",
    glyph: (s) => (
      <svg width={s * 0.6} height={s * 0.6} viewBox="0 0 24 24" fill="none">
        <path d="M5 8 L19 8 M9 8 L8.5 18 M15 8 L15 16.5 C 15 17.6 15.7 18 17 18" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.96" />
      </svg>
    ),
  },
  kimi: {
    // Kimi Code (Moonshot AI) — cyan/teal gradient + sharp "K" monogram.
    accent: "#00CCFF",
    bg: "rgba(0,204,255,0.18)",
    gradient: "linear-gradient(135deg, #00CCFF 0%, #0099CC 55%, #064E66 100%)",
    label: "Kimi Code",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M7 4 L7 20 M17 4 L7 12 L17 20" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.96" />
      </svg>
    ),
  },
  glm: {
    // GLM-5.2 (Zhipu / z.ai) — emerald/teal gradient + "G" monogram.
    accent: "#34E5B0",
    bg: "rgba(52,229,176,0.18)",
    gradient: "linear-gradient(135deg, #34E5B0 0%, #14B88A 55%, #0A5C46 100%)",
    label: "GLM 5.2",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif">G</text>
      </svg>
    ),
  },
  grok: {
    // Grok Build (xAI) — monochrome slate→silver gradient + the angular xAI "X" mark.
    accent: "#cdd3f7",
    bg: "rgba(205,211,247,0.18)",
    gradient: "linear-gradient(135deg, #20222e 0%, #4a4e63 55%, #c9cde8 100%)",
    label: "Grok Build",
    glyph: (s) => (
      <svg width={s * 0.58} height={s * 0.58} viewBox="0 0 24 24" fill="none">
        <path d="M6.5 5 L17.5 19 M17.5 5 L6.5 19" stroke="white" strokeWidth="2.2" strokeLinecap="round" opacity="0.96" />
      </svg>
    ),
  },
  antigravity: {
    // Antigravity = the "deep-space" sibling. Indigo + violet gradient with an orbital ring.
    accent: "#7c3aed",
    bg: "rgba(124,58,237,0.18)",
    gradient: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #a855f7 100%)",
    label: "Antigravity",
    glyph: (s) => (
      <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
        {/* Inverted-gravity arrow shooting up out of a planet's surface */}
        <ellipse cx="12" cy="18.5" rx="7.5" ry="2.4" fill="none" stroke="white" strokeWidth="1.2" opacity="0.55" />
        <path
          d="M12 3 L12 17 M12 3 L9 6.5 M12 3 L15 6.5"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.98"
        />
        <circle cx="12" cy="3" r="1.3" fill="white" opacity="0.98" />
      </svg>
    ),
  },
};

export default function AgentAvatar({ agent, size = 36, pulse = false, name, seed }: Props) {
  const s = STYLE[agent as AgentKey];
  // Any id without a hand-drawn mark (a crew agent, a room specialist, an imported
  // conversation's agent) gets its generated Rorschach mark (S35): never a letter,
  // never a blank, never a crash.
  if (!s) return <GeneratedAvatar id={String(agent || "agent")} size={size} pulse={pulse} name={name} seed={seed} />;
  return (
    <Disc size={size} pulse={pulse} gradient={s.gradient} accent={s.accent} label={s.label}>
      {s.glyph(size)}
    </Disc>
  );
}

/** The white inkblot on its accent gradient; seeds and the detail knob come from the shared cache. */
function GeneratedAvatar({ id, size, pulse, name, seed }: { id: string; size: number; pulse: boolean; name?: string; seed?: number | null }) {
  const faces = useAgentFaces();
  const mark = generateMark(id, { seed: seed === undefined ? faces.seeds[id] ?? null : seed, detail: faces.detail });
  return (
    <Disc size={size} pulse={pulse} gradient={mark.gradient} accent={mark.accent} label={name ?? id}>
      <MarkGlyph mark={mark} size={size} />
    </Disc>
  );
}

/** The mark alone (no disc), for previews and the agent header. */
export function MarkGlyph({ mark, size }: { mark: AgentMark; size: number }) {
  return (
    <svg width={size * 0.62} height={size * 0.62} viewBox={mark.viewBox} fill="white" aria-hidden data-mark-seed={mark.seed} data-mark-derived={mark.derived ? "1" : "0"}>
      {mark.paths.map((d, i) => <path key={i} d={d} opacity={0.96} />)}
      {mark.spots.map((sp, i) => <circle key={`s${i}`} cx={sp.cx} cy={sp.cy} r={sp.r} opacity={0.9} />)}
    </svg>
  );
}

function Disc({ size, pulse, gradient, accent, label, children }: { size: number; pulse: boolean; gradient: string; accent: string; label: string; children: React.ReactNode }) {
  const s = { gradient, accent };
  return (
    <motion.span
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 380, damping: 25 }}
      className="relative inline-grid place-items-center rounded-full overflow-hidden shrink-0"
      style={{
        width: size,
        height: size,
        background: s.gradient,
        boxShadow: `0 0 ${size}px -${size / 3}px ${s.accent}, inset 0 0 0 1px rgba(255,255,255,0.12)`,
      }}
      aria-label={label}
    >
      {children}
      {pulse && (
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            boxShadow: `0 0 0 0 ${s.accent}`,
            animation: "avatar-pulse 1.8s ease-out infinite",
          }}
        />
      )}
      <style jsx>{`
        @keyframes avatar-pulse {
          0%   { box-shadow: 0 0 0 0 ${s.accent}88; }
          70%  { box-shadow: 0 0 0 ${size * 0.5}px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </motion.span>
  );
}

// Hand-drawn agents answer from STYLE; any other id answers from its generated
// accent (lib/agentFaces.ts accentFor), so callers never hit an undefined style.
export function agentColor(agent: AgentKey | string): string {
  return STYLE[agent as AgentKey]?.accent ?? accentFor(String(agent)).accent;
}
export function agentBg(agent: AgentKey | string): string {
  return STYLE[agent as AgentKey]?.bg ?? accentFor(String(agent)).bg;
}
export function agentLabel(agent: AgentKey | string): string {
  return STYLE[agent as AgentKey]?.label ?? String(agent);
}
