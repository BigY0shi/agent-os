import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/list → the user's CLI agents and whether each is installed on THIS machine.
// Powers every "pick an agent" dropdown in the Self modules so the same source of truth drives
// them all. No API keys: these are the user's CLI subscriptions (claude/codex/cursor/pi/hermes/
// antigravity/openclaw) plus Ollama Cloud (hosted open models) and the local Ollama daemon.

interface AgentEntry {
  id: string;
  label: string;
  kind: "cli" | "http" | "local";
  installed: boolean;
  note?: string;
}

export async function GET() {
  const agents: AgentEntry[] = [
    { id: "claude",      label: "Claude",       kind: "cli",   installed: !!config.claude,      note: "Anthropic CLI · your subscription" },
    { id: "codex",       label: "Codex",        kind: "cli",   installed: !!config.codex,       note: "OpenAI codex exec" },
    { id: "cursor",      label: "Cursor",       kind: "cli",   installed: !!config.cursor,      note: "cursor-agent · your subscription" },
    { id: "pi",          label: "Pi",           kind: "cli",   installed: !!config.pi,          note: "pi CLI · Ollama glm-5.2:cloud" },
    { id: "hermes",      label: "Hermes",       kind: "cli",   installed: !!config.hermes,      note: "multi-step agent" },
    { id: "antigravity", label: "Antigravity",  kind: "cli",   installed: !!config.antigravity, note: "agy CLI" },
    { id: "openclaw",    label: "OpenClaw",     kind: "cli",   installed: !!config.openclaw,    note: "OpenClaw agent" },
    { id: "ollama",      label: "Ollama Cloud", kind: "http",  installed: true,                 note: "hosted open models · ollama.com" },
  ];
  return Response.json(
    { ok: true, agents, installed: agents.filter((a) => a.installed).map((a) => a.id) },
    { headers: { "cache-control": "no-store" } },
  );
}
