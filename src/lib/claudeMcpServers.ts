// S16: Claude Code's own user-scope MCP servers, read-only, for the Jarvis MCP tab.
// Source: the top-level `mcpServers` of ~/.claude.json (CLAUDE_JSON_PATH for smokes).
// Only names, transport, URL (query string dropped) and command are returned: header
// and env VALUES stay in the file (e.g. the agent-os entry carries the Agent OS MCP
// secret in a header).

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ClaudeMcpServer { name: string; transport: string; url?: string; command?: string; headerNames: string[]; envNames: string[] }

export function claudeJsonPath(): string {
  return process.env.CLAUDE_JSON_PATH || path.join(os.homedir(), ".claude.json");
}

export function listClaudeCodeServers(): { servers: ClaudeMcpServer[]; error: string | null } {
  const p = claudeJsonPath();
  if (!existsSync(p)) return { servers: [], error: null };
  let json: { mcpServers?: Record<string, Record<string, unknown>> };
  try { json = JSON.parse(readFileSync(p, "utf8")); } catch (e) { return { servers: [], error: `could not read ${p}: ${(e as Error).message}` }; }
  const servers = Object.entries(json.mcpServers ?? {}).map(([name, cfg]) => {
    let url: string | undefined;
    if (typeof cfg.url === "string") {
      try { const u = new URL(cfg.url); u.search = ""; u.username = ""; u.password = ""; url = u.toString(); } catch { url = undefined; }
    }
    return {
      name,
      transport: typeof cfg.type === "string" ? cfg.type : cfg.command ? "stdio" : "unknown",
      url,
      command: typeof cfg.command === "string" ? cfg.command : undefined,
      headerNames: cfg.headers && typeof cfg.headers === "object" ? Object.keys(cfg.headers as object) : [],
      envNames: cfg.env && typeof cfg.env === "object" ? Object.keys(cfg.env as object) : [],
    };
  });
  return { servers: servers.sort((a, b) => a.name.localeCompare(b.name)), error: null };
}
