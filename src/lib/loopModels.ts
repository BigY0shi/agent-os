// Shared Builder/Judge menus for the Loop.
//
// This lives in its own module (no node: imports) so BOTH the server engine
// (loopEngine.ts) and the client UI (LoopView.tsx) can use the same lists.
// They used to be hand-duplicated in the UI and had drifted badly: the UI
// offered models the engine doesn't support and defaulted to a worker AND judge
// that both required an OpenRouter key.
//
// CLI ONLY (owner, 2026-09-29): the Loop runs on the user's own CLI subscriptions,
// no API keys. The OpenRouter models (N2, GLM 5.2, the Fusion council), Nous Portal
// and MiniMax were removed from both menus and from the engine; an id outside these
// lists is refused before the loop starts. The judge may also be Ollama Cloud
// ("ollama-cloud", model from the Loop gear). There is no local Ollama here (owner,
// 2026-09-30); an old saved "local" judge is read as "ollama-cloud".

export interface LoopModel {
  id: string;
  label: string;
}

/** CLI agents with a verified one-shot mode in loopEngine.cliComplete (antigravity's
 *  `agy -p` prints nothing to a pipe, so it is not offered here). */
export const LOOP_CLI = ["claude", "codex", "cursor", "pi", "hermes"] as const;

export const WORKERS: LoopModel[] = [
  { id: "cli:claude", label: "Claude CLI · your subscription (default)" },
  { id: "cli:codex", label: "Codex CLI · your subscription" },
  { id: "cli:cursor", label: "Cursor CLI · your subscription" },
  { id: "cli:pi", label: "Pi CLI · your subscription" },
  { id: "cli:hermes", label: "Hermes CLI · local agent" },
];

export const JUDGES: LoopModel[] = [
  { id: "cli:claude", label: "Claude CLI · your subscription (default)" },
  { id: "cli:codex", label: "Codex CLI · independent lineage (good critic)" },
  { id: "cli:cursor", label: "Cursor CLI · your subscription" },
  { id: "cli:pi", label: "Pi CLI · your subscription" },
  { id: "cli:hermes", label: "Hermes CLI · local agent" },
  { id: "ollama-cloud", label: "Ollama Cloud · model from the Loop gear" },
];

export const DEFAULT_WORKER = "cli:claude";
export const DEFAULT_JUDGE = "cli:claude";

const isLoopCli = (id: string) => id.startsWith("cli:") && (LOOP_CLI as readonly string[]).includes(id.slice(4));
/** A builder the Loop will run: a wired CLI agent. */
export const isLoopBuilder = (id: string): boolean => isLoopCli(id);
/** A judge the Loop will run: a wired CLI agent, or Ollama Cloud. */
export const isLoopJudge = (id: string): boolean => isLoopCli(id) || id === "ollama-cloud";
/** Read an older saved judge id ("local" meant the Ollama judge) as today's. */
export const normalizeJudge = (id: string): string => (id === "local" ? "ollama-cloud" : id);
