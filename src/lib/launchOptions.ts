// Launch options — what a module run is configured with BEFORE it starts.
//
// Owner decision 2026-09-02 (roadmap S3): configuration happens in a pre-launch
// drawer; the only mid-run control is STOP. This module is the contract both
// sides share: the drawer (RunLaunchDrawer.tsx) renders exactly the fields
// declared here, the route validates the body against the same declaration,
// and the last-used values persist in settings.launch.<module> (rule 16).
//
// Pure: no fs, no settings import, safe in the client bundle. Every guardrail
// declared for a module is one its routes actually enforce; a guardrail that
// nothing reads is not listed, because a switch wired to nothing is a lie.

export type LaunchModule = "content-engine" | "agent-kanban";
export const LAUNCH_MODULES: readonly LaunchModule[] = ["content-engine", "agent-kanban"];

export interface GuardrailDef {
  key: string;
  label: string;
  hint: string;
  kind: "number" | "boolean";
  min?: number;
  max?: number;
  default: number | boolean;
}

export interface SeatDef { id: string; label: string }

export interface LaunchModuleDef {
  label: string;
  /** Where the tray's "Open" link goes. */
  href: string;
  /** Which seat runs the work. The first entry is the default. */
  seats: SeatDef[];
  guardrails: GuardrailDef[];
}

export const LAUNCH_MODULE_DEFS: Record<LaunchModule, LaunchModuleDef> = {
  "content-engine": {
    label: "Content Engine",
    href: "/content-engine",
    seats: [
      { id: "rotation", label: "Rotation (codex / kimi / claude per item; claude plans)" },
      { id: "claude", label: "Claude (CLI)" },
      { id: "codex", label: "Codex (CLI)" },
      { id: "kimi", label: "Kimi (Ollama Cloud)" },
    ],
    guardrails: [
      { key: "timeoutMin", label: "Model call timeout (min)", hint: "Each model call is killed after this many minutes.", kind: "number", min: 1, max: 15, default: 5 },
      { key: "noFallback", label: "No fallback to Claude", hint: "If the chosen seat fails, fail the run instead of letting Claude rescue it.", kind: "boolean", default: false },
    ],
  },
  "agent-kanban": {
    label: "Agent Kanban",
    href: "/agent-kanban",
    seats: [
      { id: "local", label: "Local team (Ollama)" },
      { id: "claude", label: "Claude (CLI)" },
      { id: "codex", label: "Codex (CLI)" },
      { id: "cursor", label: "Cursor (CLI)" },
      { id: "pi", label: "Pi (CLI)" },
      { id: "hermes", label: "Hermes (CLI)" },
    ],
    guardrails: [
      { key: "timeoutMin", label: "Model call timeout (min)", hint: "Each plan or build call is killed after this many minutes.", kind: "number", min: 1, max: 15, default: 4 },
      { key: "maxCards", label: "Max cards per plan", hint: "The Planner may not put more than this many cards on the board.", kind: "number", min: 1, max: 6, default: 5 },
      { key: "noExternalScripts", label: "No external scripts", hint: "The Builder must inline everything; the Reviewer rejects any <script src> or stylesheet that points off the page.", kind: "boolean", default: false },
    ],
  },
};

export interface LaunchOptions {
  /** Seat id from LAUNCH_MODULE_DEFS[module].seats. */
  agent: string;
  /** Skill names (~/.agentic-os/skills/<name>) applied to THIS run, on top of settings.skills. */
  skills: string[];
  /** Only the keys declared for the module; validated by parseLaunchOptions. */
  guardrails: Record<string, number | boolean>;
  /** Operator instructions appended to the prompt for this run. */
  instructions: string;
}

export const MAX_INSTRUCTIONS_CHARS = 2000;
export const MAX_SKILLS_PER_RUN = 8;
const SKILL_NAME = /^[a-z0-9-]{1,64}$/;
const TOP_KEYS = new Set(["agent", "skills", "guardrails", "instructions"]);

export function defaultLaunchOptions(module: LaunchModule): LaunchOptions {
  const def = LAUNCH_MODULE_DEFS[module];
  const guardrails: Record<string, number | boolean> = {};
  for (const g of def.guardrails) guardrails[g.key] = g.default;
  return { agent: def.seats[0].id, skills: [], guardrails, instructions: "" };
}

export type ParsedLaunch = { ok: true; value: LaunchOptions } | { ok: false; error: string };

/**
 * Strict parse of a launch object from a request body. Unknown fields are an
 * error, not a silent drop: a typo in a guardrail name would otherwise launch
 * a run WITHOUT the guardrail the operator thought they set.
 */
export function parseLaunchOptions(module: LaunchModule, raw: unknown): ParsedLaunch {
  const def = LAUNCH_MODULE_DEFS[module];
  if (!def) return { ok: false, error: `unknown launch module "${String(module)}"` };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "launch must be an object" };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!TOP_KEYS.has(k)) return { ok: false, error: `unknown launch option "${k}"` };

  const base = defaultLaunchOptions(module);

  let agent = base.agent;
  if (o.agent !== undefined) {
    if (typeof o.agent !== "string") return { ok: false, error: "launch.agent must be a string" };
    if (!def.seats.some((s) => s.id === o.agent)) return { ok: false, error: `launch.agent "${o.agent}" is not a seat for ${def.label}` };
    agent = o.agent;
  }

  let skills: string[] = [];
  if (o.skills !== undefined) {
    if (!Array.isArray(o.skills)) return { ok: false, error: "launch.skills must be an array of skill names" };
    if (o.skills.length > MAX_SKILLS_PER_RUN) return { ok: false, error: `launch.skills: at most ${MAX_SKILLS_PER_RUN} skills per run` };
    for (const s of o.skills) {
      if (typeof s !== "string" || !SKILL_NAME.test(s)) return { ok: false, error: `launch.skills: "${String(s)}" is not a skill name` };
    }
    skills = [...new Set(o.skills as string[])];
  }

  const guardrails = { ...base.guardrails };
  if (o.guardrails !== undefined) {
    if (!o.guardrails || typeof o.guardrails !== "object" || Array.isArray(o.guardrails)) return { ok: false, error: "launch.guardrails must be an object" };
    for (const [k, v] of Object.entries(o.guardrails as Record<string, unknown>)) {
      const g = def.guardrails.find((x) => x.key === k);
      if (!g) return { ok: false, error: `unknown guardrail "${k}" for ${def.label}` };
      if (g.kind === "boolean") {
        if (typeof v !== "boolean") return { ok: false, error: `guardrail "${k}" must be true or false` };
        guardrails[k] = v;
      } else {
        if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `guardrail "${k}" must be a number` };
        if ((g.min !== undefined && v < g.min) || (g.max !== undefined && v > g.max)) {
          return { ok: false, error: `guardrail "${k}" must be between ${g.min} and ${g.max}` };
        }
        guardrails[k] = v;
      }
    }
  }

  let instructions = "";
  if (o.instructions !== undefined) {
    if (typeof o.instructions !== "string") return { ok: false, error: "launch.instructions must be a string" };
    if (o.instructions.length > MAX_INSTRUCTIONS_CHARS) return { ok: false, error: `launch.instructions: at most ${MAX_INSTRUCTIONS_CHARS} characters` };
    instructions = o.instructions.trim();
  }

  return { ok: true, value: { agent, skills, guardrails, instructions } };
}

/**
 * What a route runs with: the body's `launch` when present (strict), else the
 * last-used values from settings.launch.<module> (lenient: a stale or partial
 * stored value falls back to defaults field by field, and says nothing), else
 * the defaults. `source` tells the run label who decided.
 */
export function resolveLaunchOptions(
  module: LaunchModule,
  bodyLaunch: unknown,
  stored: unknown,
): ParsedLaunch & { source?: "body" | "settings" | "defaults" } {
  if (bodyLaunch !== undefined) {
    const p = parseLaunchOptions(module, bodyLaunch);
    return p.ok ? { ...p, source: "body" } : p;
  }
  if (stored && typeof stored === "object") {
    const p = parseLaunchOptions(module, stored);
    if (p.ok) return { ...p, source: "settings" };
  }
  return { ok: true, value: defaultLaunchOptions(module), source: "defaults" };
}

/** Milliseconds for the `timeoutMin` guardrail (every module declares it). */
export function launchTimeoutMs(launch: LaunchOptions, fallbackMs = 240_000): number {
  const m = launch.guardrails.timeoutMin;
  return typeof m === "number" && m > 0 ? Math.round(m * 60_000) : fallbackMs;
}

/** Append the operator's per-run instructions to a prompt (no-op when empty). */
export function withInstructions(prompt: string, launch: LaunchOptions): string {
  const t = launch.instructions.trim();
  return t ? `${prompt}\n\nOPERATOR INSTRUCTIONS FOR THIS RUN (follow them, they outrank the defaults above):\n${t}` : prompt;
}

/** One-line description for the run label / tray: "claude · 2 skills · no fallback". */
export function describeLaunch(module: LaunchModule, launch: LaunchOptions): string {
  const def = LAUNCH_MODULE_DEFS[module];
  const parts = [launch.agent];
  if (launch.skills.length) parts.push(`${launch.skills.length} skill${launch.skills.length === 1 ? "" : "s"}`);
  for (const g of def.guardrails) {
    const v = launch.guardrails[g.key];
    if (g.kind === "boolean" && v === true) parts.push(g.label.toLowerCase());
    else if (g.kind === "number" && v !== g.default) parts.push(`${g.key} ${v}`);
  }
  if (launch.instructions.trim()) parts.push("instructions");
  return parts.join(" · ");
}
