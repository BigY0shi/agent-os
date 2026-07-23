import { config, CLAUDE_MODEL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Powers the Mission Control fleet (store.hydrateFromConfig). Returns the operator,
// vault, and the configured agents with hasAuth = whether the CLI/key is present on
// this machine, so the fleet shows what's actually wired.
type Glyph = "spiral" | "hex-orbit" | "triangle-stack" | "ring-cross" | "dual-cone" | "fractal";

function agent(
  id: string, name: string, role: string, tagline: string,
  kind: "claude-cli" | "remote-http", model: string, glyph: Glyph,
  from: string, to: string, hasAuth: boolean, gateway: string | null = null,
) {
  return { id, name, role, tagline, kind, model, glyph, accent: { from, to }, cwd: null, gateway, hasAuth };
}

export async function GET() {
  const ollamaKey = !!(process.env.OLLAMA_API_KEY || process.env.OLLAMA_CLOUD_KEY);

  const agents = [
    agent("claude", "Claude", "Reasoning + code", "Anthropic CLI", "claude-cli", CLAUDE_MODEL, "spiral", "#d97757", "#f2b8a2", !!config.claude),
    agent("codex", "Codex", "OpenAI coding agent", "codex exec", "claude-cli", "gpt-5.5", "hex-orbit", "#22c55e", "#86efac", !!config.codex),
    agent("hermes", "Hermes", "Tool-using agent", "multi-step jobs", "claude-cli", "openrouter", "ring-cross", "#60a5fa", "#bfdbfe", !!config.hermes),
    agent("antigravity", "Antigravity", "Gemini successor", "agy CLI", "claude-cli", "agy", "dual-cone", "#7c3aed", "#c4b5fd", !!config.antigravity),
    agent("ollama", "Ollama Cloud", "Hosted open models", "ollama.com", "remote-http", "qwen3-coder:480b", "fractal", "#6CA8FF", "#bcd6ff", ollamaKey, "https://ollama.com"),
    agent("cursor", "Cursor", "Cursor coding agent", "cursor-agent CLI", "claude-cli", "composer", "hex-orbit", "#cbd5e1", "#e2e8f0", !!config.cursor),
    agent("pi", "Pi", "AI coding CLI", "pi CLI", "claude-cli", "glm-5.2:cloud", "spiral", "#fbbf24", "#fde68a", !!config.pi),
    agent("openclaw", "OpenClaw", "OpenClaw agent", "local agent", "claude-cli", "openclaw", "triangle-stack", "#f472b6", "#fbcfe8", !!config.openclaw),
  ];

  return Response.json({
    ok: true,
    config: {
      operator: { name: config.userName || "You" },
      vault: { dir: config.vaultRoot || "" },
      agents,
      meta: { sources: ["~/.agentic-os/config.json", ".env.local", "~/.hermes profile"] },
    },
  });
}
