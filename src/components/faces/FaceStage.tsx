"use client";

// The hero row every agent tab opens with: the agent's face, its name in the display
// face, and the state it is ACTUALLY in (the caller passes real state; see AgentFace).

import { AgentFace, FACE_PALETTE, type FaceState, type FaceVariant } from "./AgentFace";

const STATE_WORD: Record<FaceState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  working: "Working",
  speaking: "Replying",
  error: "Error",
};

export function FaceStage({
  variant,
  state,
  name,
  subtitle,
  getLevel,
  height = 300,
  detail,
}: {
  variant: FaceVariant;
  state: FaceState;
  name: string;
  subtitle?: string;
  getLevel?: () => number;
  height?: number;
  /** One honest line under the state, e.g. what is running. */
  detail?: string;
}) {
  const tint = FACE_PALETTE[variant][state];
  return (
    <section className="glass-strong relative mb-5 overflow-hidden px-6 pt-4 pb-5" aria-label={`${name} face`}>
      <AgentFace
        variant={variant}
        state={state}
        getLevel={getLevel}
        label={`${name}, ${STATE_WORD[state].toLowerCase()}`}
        style={{ height, width: "100%" }}
      />
      <div className="-mt-6 flex flex-col items-center gap-1.5 text-center">
        <div
          className="type-display text-[26px] leading-none uppercase tracking-[0.06em]"
        >
          {name}
        </div>
        {subtitle && <div className="text-[12px] text-[var(--fg-dim)]">{subtitle}</div>}
        <div className="mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 glass-inset" role="status" aria-live="polite">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tint, boxShadow: `0 0 10px ${tint}` }} />
          <span className="glass-eyebrow" style={{ color: tint }}>{STATE_WORD[state]}</span>
        </div>
        {detail && <div className="text-[11.5px] text-[var(--fg-dimmer)] max-w-[520px]">{detail}</div>}
      </div>
    </section>
  );
}
