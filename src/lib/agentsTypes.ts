// Agents module — client-safe types + constants. NO node imports here: this file
// is imported by client components, and a node:fs import would break the client
// bundle (the HIRE_COLUMNS lesson). Server-side logic lives in agentsStore.ts /
// agentsRuntime.ts.

/** The per-agent permission dial (Claude Code-style). The constitution applies in
 *  ALL modes — even bypass can't send/post/pay/delete without approval. */
export type AgentPermissionMode = "bypass" | "gated" | "ask";

/** Model dial: fast = cheap sonnet-tier, standard = sonnet, deep = the pinned
 *  opus-tier CLAUDE_MODEL. Resolution happens server-side. */
export type AgentIntelligence = "fast" | "standard" | "deep";

export type AgentTrigger =
  | { type: "manual" }
  | { type: "webhook"; secret: string }
  | { type: "gmail"; query: string; intervalMin: number }
  | { type: "webwatch"; url: string; intervalMin: number }
  | { type: "filewatch"; path: string; glob?: string }
  | { type: "schedule"; cron: string };

// ── SPEC-E F1.1 — Agents-page V2 additions (all OPTIONAL: old agent.json ─────
// files parse unchanged; absent lifecycle = "deployed" so nothing pre-existing
// stops firing).

export type AgentLifecycle = "ideation" | "forge" | "test" | "deployed" | "retired";

/** The five shared status-band states (CONVENTIONS §6). StatusBand.tsx's
 *  StatusBandKind aliases THIS type — single source, no forks. */
export type BandStatus = "running" | "idle" | "waiting" | "error" | "offline";

/** Model-agnostic writing/voice persona (rule 17 — data, never prompt code).
 *  Mirrors the JarvisPersona shape. */
export interface AgentPersona {
  name: string;
  voiceRules: string;
  audience?: string;
  bannedPhrases: string[];
  ctaStyle?: string;
}

/** Run provider override. Absent = "sdk" (the current agentsRuntime path).
 *  cli/ollama route through cliComplete / a direct Ollama chat — rule 11: an
 *  unresolvable provider FAILS LOUDLY (run status error), never silent SDK
 *  fallback. */
export type AgentProvider =
  | { kind: "sdk" }
  | { kind: "cli"; agent: string }
  | { kind: "ollama"; model: string };

export interface AgentDefV2Fields {
  /** Absent = "deployed" (every pre-existing agent is live). Trigger tick
   *  SKIPS lifecycle ∈ {ideation, forge, test, retired} (F1.2). */
  lifecycle?: AgentLifecycle;
  /** FK into the harnesses table; absent = plain single-run (today's behavior). */
  harnessId?: string;
  persona?: AgentPersona;
  /** WebMCP/Fd4 tool package ids; absent = today's {mcp, browser} only. */
  toolIds?: string[];
  /** G-workstream connector ids; tolerated-unknown until G exists. */
  connectorIds?: string[];
  provider?: AgentProvider;
  /** Browser session names this agent may drive (E3∩F3). */
  browserSessions?: string[];
}

export interface AgentDef extends AgentDefV2Fields {
  id: string;
  name: string;
  /** One-liner shown on the card. The real instructions live in system.md. */
  description: string;
  permissionMode: AgentPermissionMode;
  intelligence: AgentIntelligence;
  triggers: AgentTrigger[];
  tools: { mcp: "inherit" | "none"; browser: boolean };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "running" | "waiting" | "done" | "error" | "killed";

export interface RunMeta {
  id: string;
  agentId: string;
  /** What fired it — "manual", "webhook", "gmail", ... */
  trigger: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  /** Final result text (from the SDK result message). */
  result?: string;
  costUsd?: number;
  numTurns?: number;
  error?: string;
}

/** One line in the live run transcript. seq is a monotonic cursor for polling. */
export interface RunEvent {
  seq: number;
  ts: number;
  kind: "init" | "text" | "tool" | "tool-result" | "approval" | "status" | "result" | "error" | "stderr";
  text?: string;
  toolName?: string;
  /** Compact preview of tool input / result — full payloads stay in the JSONL. */
  detail?: string;
  approvalId?: string;
}

export type ApprovalReason = "constitution" | "gated" | "ask";

export interface ApprovalReq {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  toolName: string;
  /** Pretty-printed tool input for the approval card. */
  inputPreview: string;
  reason: ApprovalReason;
  createdAt: number;
}

export interface McpServerHealth { name: string; status: string }

export const MODE_META: Record<AgentPermissionMode, { label: string; color: string; blurb: string }> = {
  bypass: { label: "Bypass", color: "#f87171", blurb: "Everything auto-approved except constitution actions (send / post / pay / delete)." },
  gated:  { label: "Gated",  color: "#fbbf24", blurb: "Workspace + research run free; outbound and out-of-workspace writes queue for approval." },
  ask:    { label: "Ask",    color: "#22d3ee", blurb: "Every tool call queues for approval." },
};

export const INTELLIGENCE_META: Record<AgentIntelligence, { label: string; blurb: string }> = {
  fast:     { label: "Fast",     blurb: "Cheapest tier — triage, routing, simple digests." },
  standard: { label: "Standard", blurb: "Sonnet-tier default — most tasks." },
  deep:     { label: "Deep",     blurb: "Opus-tier — research, writing, judgment calls." },
};

export const STATUS_COLORS: Record<RunStatus, string> = {
  running: "#22d3ee",
  waiting: "#fbbf24",
  done: "#34d399",
  error: "#f87171",
  killed: "#9ca3af",
};
