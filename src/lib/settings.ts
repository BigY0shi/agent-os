// Runtime, user-editable settings for the dashboard's Self modules.
//
// Unlike lib/config.ts (CLI bin paths, read ONCE at server start), these are the
// per-module preferences the user changes from the UI config menus — which CLI agent
// a module uses, SEO target sites, the Video lab endpoint, Suno creds, Open Design
// ports, etc. They live in ~/.agentic-os/settings.json and are read/written at
// REQUEST time, so changing a setting takes effect immediately — no rebuild, no restart.
//
// Nothing here is an API key the project ships with; everything is the user's own
// CLI subscription selection or a local endpoint. The only "keys" are ones the user
// pastes themselves into a config field (e.g. an optional Suno third-party key).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SeoSite {
  label: string;
  url: string;        // the live site / repo this SEO content targets
  deployCmd?: string; // optional shell command to publish (run from the site dir)
  dir?: string;       // optional local working dir (site root) for the site
  postsDir?: string;  // optional explicit blog-posts dir (defaults to <dir>/src/blog/posts)
}

export interface Settings {
  // The CLI agent a module reaches for when it just needs "an agent" (id from /api/agents/list).
  defaultAgent: string;

  loop: { builder?: string; judge?: string };

  seo: {
    sites: SeoSite[];
    brand?: string;          // the user's brand/name (replaces the old hardcoded "Julian Goldie")
    author?: string;         // byline used in generated content
    audience?: string;       // who the content targets
    transcriptsDir?: string; // where SEO source transcripts live (defaults under the first site)
    skillPath?: string;      // path to the blog-post skill md (defaults under the first site)
    agent?: string;          // which CLI agent writes the articles (claude/codex/cursor/pi/hermes)
  };

  // Leads: which CLI agent does the reasoning (ICP, company finder, scoring) + which data
  // provider finds the leads. "ai" = the agent guesses companies (legacy). The others search/
  // scrape the web for real matches; keys are pasted here (these services need an API key).
  leads: {
    agent?: string;
    dataProvider?: "ai" | "agent" | "tavily" | "perplexity" | "firecrawl" | "apify";
    tavilyKey?: string;
    perplexityKey?: string;
    firecrawlKey?: string;
    apifyToken?: string;
    apifyActor?: string; // e.g. "apify/google-search-scraper" or a lead-gen actor id
  };

  video: {
    // "eidolon" = the user's local Eidolon LTX/WAN Video Studio (Pinokio). "cli" = a CLI
    // agent driving generation via its Higgsfield skill/MCP.
    backend?: "eidolon" | "cli";
    eidolonUrl?: string; // local endpoint of the Eidolon studio (Pinokio/Gradio)
    comfyUrl?: string;   // optional direct ComfyUI API endpoint
    model?: "ltx" | "wan";
    agent?: string;      // CLI agent id used when backend === "cli"
  };

  music: {
    backend?: "key" | "cookie";
    sunoApiKey?: string; // optional third-party Suno API key (user-pasted)
    sunoCookie?: string; // optional Suno account cookie (self-host suno-api style)
    sunoBaseUrl?: string;
  };

  opendesign: {
    webUrl?: string;     // the iframe UI (default http://127.0.0.1:7456)
    daemonUrl?: string;  // health-check daemon (default http://127.0.0.1:7455)
    launchCmd?: string;  // command to START Open Design (cross-platform; run via the OS shell)
    stopCmd?: string;    // command to STOP it
    installPath?: string; // working dir the launch/stop commands run from
  };

  // Paperclip launcher URL. Empty = auto-detect (http://<dashboard host>:3100). Override to a
  // specific LAN IP, a Tailscale MagicDNS name, or a custom domain.
  paperclip: { url?: string };

  // Per-module default agent overrides for the lighter modules.
  games: { agent?: string };
  thumbnails: { agent?: string; backend?: "cli" | "gpt-image" };
  notebook: { agent?: string; nlmBin?: string; notebookId?: string };
  kanban: { agent?: string; board?: string };

  // Pipeline: which provider (Ollama / CLI agent / MiniMax) drives the shape → reason → artifact flow.
  pipeline: {
    provider?: "ollama" | "cli" | "minimax";
    model?: string;           // for Ollama: which model to use (auto-detected if blank)
    ollamaUrl?: string;       // for Ollama: where the daemon is (default localhost:11434)
    agent?: string;           // for CLI: which agent (claude/codex/cursor/pi/hermes)
    minimaxKey?: string;      // for MiniMax: the API key
  };

  // ── Model dials for the 2026-07 modules ─────────────────────────────────────
  // User model policy: Kimi K2.6 for chat/agentic seats, K2.7 Code for coding.
  // Empty string = the module's built-in default (blank kimiModel = auto-resolve
  // preferring k2.6; blank claude models = the pinned CLAUDE_MODEL).
  brainstorm: { kimiModel?: string };                       // the council's Kimi seat
  jarvis: { kimiModel?: string };                           // Kimi voice provider's brain
  contentEngine: { kimiModel?: string };                    // the kimi slot in the generation rotation
  // The Agents module's intelligence dial → concrete claude model ids.
  agentsModels: { fast?: string; standard?: string; deep?: string };
  // Hire Engine analysis models: cheap triage sweep + full brief/pitch writer.
  hire: { triageModel?: string; briefModel?: string };

  [extra: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultAgent: "claude",
  loop: {},
  seo: { sites: [], brand: "", author: "", audience: "", agent: "claude" },
  leads: { agent: "claude", dataProvider: "ai" },
  video: { backend: "eidolon", eidolonUrl: "", comfyUrl: "http://127.0.0.1:8188", model: "ltx", agent: "claude" },
  music: { backend: "key", sunoApiKey: "", sunoCookie: "", sunoBaseUrl: "" },
  opendesign: { webUrl: "http://127.0.0.1:7456", daemonUrl: "http://127.0.0.1:7455", launchCmd: "", stopCmd: "", installPath: "" },
  paperclip: { url: "" },
  games: { agent: "claude" },
  thumbnails: { agent: "claude", backend: "cli" },
  notebook: { agent: "claude", nlmBin: "", notebookId: "" },
  kanban: { agent: "claude", board: "" },
  pipeline: { provider: "ollama", model: "", ollamaUrl: "", agent: "claude", minimaxKey: "" },
  brainstorm: { kimiModel: "kimi-k2.6" },
  jarvis: { kimiModel: "kimi-k2.6" },
  contentEngine: { kimiModel: "kimi-k2.6" },
  agentsModels: { fast: "claude-haiku-4-5", standard: "claude-sonnet-5", deep: "" },
  hire: { triageModel: "claude-haiku-4-5", briefModel: "" },
};

function settingsPath(): string {
  return path.join(os.homedir(), ".agentic-os", "settings.json");
}

// Deep-merge plain objects (arrays + scalars from `patch` win wholesale).
function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(patch)) return patch as unknown as T;
  if (patch === null || typeof patch !== "object") return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const bv = (base as Record<string, unknown>)?.[k];
    if (v && typeof v === "object" && !Array.isArray(v) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function readSettings(): Settings {
  try {
    const p = settingsPath();
    if (!existsSync(p)) return structuredCloneSafe(DEFAULT_SETTINGS);
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return deepMerge(structuredCloneSafe(DEFAULT_SETTINGS), raw);
  } catch {
    return structuredCloneSafe(DEFAULT_SETTINGS);
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const next = deepMerge(current, patch);
  const p = settingsPath();
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
  } catch { /* best-effort; return the merged value regardless */ }
  return next;
}

// structuredClone exists in Node 18+, but guard for older runtimes.
function structuredCloneSafe<T>(v: T): T {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}
