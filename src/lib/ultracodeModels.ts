// Ultracode's model + effort choices (owner, 2026-09-30: "make sure the model/effort is
// configurable. At least between opus 5.5, sonnet 5.5, fable 5.1 and opus 5"). Client-safe
// (no node: imports) so the Ultracode tab and the route share one list. Saved in
// settings.ultracode; the route validates whatever arrives against these.

export const ULTRACODE_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-opus-5", label: "Opus 5" },
] as const;

/** The claude CLI's --effort levels (claude --help: low, medium, high, xhigh, max). */
export const ULTRACODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type UltracodeEffort = (typeof ULTRACODE_EFFORTS)[number];

export const DEFAULT_ULTRACODE_MODEL = "claude-opus-5-5";
export const DEFAULT_ULTRACODE_EFFORT: UltracodeEffort = "xhigh";

/** A model id the CLI could accept: one of the list, or another claude model id / alias the
 *  owner typed (claude --help: "an alias ... (e.g. 'fable', 'opus', or 'sonnet') or a model's
 *  full name"). Rejects anything that could smuggle a flag or a path. */
export const isUltracodeModel = (m: string): boolean => /^(claude-[a-z0-9.-]{2,60}|opus|sonnet|fable|haiku)$/.test(m);
export const isUltracodeEffort = (e: string): e is UltracodeEffort => (ULTRACODE_EFFORTS as readonly string[]).includes(e);
