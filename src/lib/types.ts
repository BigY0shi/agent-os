export type AgentStatus = "idle" | "running" | "paused" | "error" | "completed";

export type AgentGlyph =
  | "spiral"
  | "hex-orbit"
  | "triangle-stack"
  | "ring-cross"
  | "dual-cone"
  | "fractal";

export interface AgentAccent {
  /** Primary accent (hex). */
  from: string;
  /** Secondary accent (hex). */
  to: string;
}

export type AgentKind = "claude-cli" | "remote-http";

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  /** Source of truth: where does this agent run? */
  kind: AgentKind;
  /** Local working dir (for claude-cli kind). */
  cwd?: string | null;
  /** Remote gateway URL (for remote-http kind). */
  gateway?: string | null;
  /** True if the server is configured with a bearer for this agent. */
  hasAuth?: boolean;
  status: AgentStatus;
  systemPrompt?: string;
  sessionId?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  lastActivity: string; // ISO
  createdAt: string; // ISO
  /** Geometric glyph used by AgentAvatar. */
  glyph: AgentGlyph;
  /** Gradient accent colours (used by avatar + UI highlights). */
  accent: AgentAccent;
  /** Short tagline shown under agent name. */
  tagline?: string;
}

export type TimelineLevel = "info" | "success" | "warn" | "error" | "tool";

export interface TimelineEvent {
  id: string;
  ts: string; // ISO
  agentId?: string;
  agentName?: string;
  level: TimelineLevel;
  category: "system" | "agent" | "tool" | "chat" | "kanban";
  title: string;
  detail?: string;
}

export type KanbanColumnId = "backlog" | "running" | "review" | "done";

export interface KanbanCard {
  id: string;
  title: string;
  detail?: string;
  agentId?: string;
  agentName?: string;
  priority: "low" | "medium" | "high";
  column: KanbanColumnId;
  createdAt: string;
}

/* ─── Vault: Goals + Journal ─────────────────────────────────────────────── */

export type GoalStatus = "active" | "done" | "archived";
export type GoalPriority = "low" | "medium" | "high";

export interface GoalTask {
  /** 0-based line index inside the task list — used to round-trip toggling. */
  index: number;
  done: boolean;
  text: string;
}

export interface Goal {
  id: string;
  slug: string;
  /** File path relative to vault root, e.g. `goals/ship-v2--g_abc.md`. */
  path: string;
  title: string;
  description?: string;
  status: GoalStatus;
  priority: GoalPriority;
  tags: string[];
  tasks: GoalTask[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type JournalSlot = "morning" | "evening";

export interface JournalEntry {
  id: string;
  /** "YYYY-MM-DD" — derived from path. */
  date: string;
  slot: JournalSlot;
  /** File path relative to vault root, e.g. `journal/2026-05-27/morning.md`. */
  path: string;
  /** Optional self-rating 1–5. */
  mood?: number | null;
  energy?: number | null;
  /** Full markdown body (including prompt headings). */
  body: string;
  createdAt: string;
  updatedAt: string;
}

// Claude CLI stream-json event shapes (subset we care about)
export type ClaudeStreamEvent =
  | {
      type: "system";
      subtype: "init";
      session_id: string;
      model: string;
      cwd?: string;
      tools?: string[];
    }
  | {
      type: "assistant";
      message: {
        id?: string;
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
        model?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      session_id?: string;
    }
  | {
      type: "user";
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
        >;
      };
      session_id?: string;
    }
  | {
      type: "result";
      subtype: "success" | "error_max_turns" | "error_during_execution";
      result?: string;
      is_error?: boolean;
      duration_ms?: number;
      duration_api_ms?: number;
      num_turns?: number;
      session_id?: string;
      total_cost_usd?: number;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | { type: "stream_event"; event: unknown };
