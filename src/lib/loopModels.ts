// Shared Builder/Judge menus for the Loop.
//
// This lives in its own module (no node: imports) so BOTH the server engine
// (loopEngine.ts) and the client UI (LoopView.tsx) can use the same lists.
// They used to be hand-duplicated in the UI and had drifted badly: the UI
// offered models the engine doesn't support and defaulted to a worker AND judge
// that both required an OpenRouter key.
//
// The CLI agents run on the user's own subscriptions (no API key) and are what's
// actually installed, so they lead. MiniMax is deliberately absent — it isn't
// provisioned on this machine.

export interface LoopModel {
  id: string;
  label: string;
}

export const WORKERS: LoopModel[] = [
  { id: "cli:claude", label: "Claude CLI · your subscription (default)" },
  { id: "cli:codex", label: "Codex CLI · your subscription" },
  { id: "cli:cursor", label: "Cursor CLI · your subscription" },
  { id: "cli:hermes", label: "Hermes CLI · local agent" },
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ · free (needs OpenRouter key)" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2 · cheap (needs OpenRouter key)" },
];

export const JUDGES: (LoopModel & { free: boolean })[] = [
  { id: "cli:claude", label: "Claude CLI · your subscription (default)", free: true },
  { id: "cli:codex", label: "Codex CLI · independent lineage (good critic)", free: true },
  { id: "local", label: "Local · free, offline (Ollama)", free: true },
  { id: "nex-agi/nex-n2-pro:free", label: "N2 ✦ · free (needs OpenRouter key)", free: true },
  { id: "openrouter/fusion", label: "Fusion council · premium (needs OpenRouter key)", free: false },
];

export const DEFAULT_WORKER = "cli:claude";
export const DEFAULT_JUDGE = "cli:claude";
