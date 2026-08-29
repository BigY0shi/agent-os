// SPEC-D G5 — client-safe automation types. NO node imports in this file
// (repo convention, cf. integrations/types.ts). The engine (engine.ts) and the
// /automations UI both import from here.
//
// §8 risk 11 (BINDING): conditions and templates are DETERMINISTIC string ops.
// The op list below is a hard whitelist enforced at save (422) AND at eval;
// {{payload.*}} templates are string substitution only — no eval, no Function
// constructor, and the LLM has no role anywhere in this module.

export const CONDITION_OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "regex",
  "gt",
  "lt",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface RuleCondition {
  /** Dot path into the trigger context: 'text', 'payload.subject', 'account.slug', 'event'. */
  field: string;
  op: ConditionOp;
  value: string;
}

export const ACTION_KINDS = ["create_attention", "create_task", "notify", "run_tool"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface CreateAttentionAction {
  kind: "create_attention";
  severity?: "info" | "warn" | "urgent";
  titleTemplate: string;
  bodyTemplate?: string;
  route?: string;
  /** Optional per-item dedupe key template; default `automation:<ruleId>` (one refreshed item per rule). */
  dedupeKeyTemplate?: string;
}

export interface CreateTaskAction {
  kind: "create_task";
  titleTemplate: string;
  descriptionTemplate?: string;
}

export interface NotifyAction {
  kind: "notify";
  /** Bus event type to emit; default 'automation.notify'. */
  eventType?: string;
  messageTemplate?: string;
}

export interface RunToolAction {
  kind: "run_tool";
  /** Integration account row id (UUID) — the tool executes on this account. */
  accountId: string;
  /** Advertised (slug-prefixed) tool name, passed verbatim. */
  tool: string;
  /** Args object; string values get {{payload.*}} substitution (see engine.ts). */
  argsTemplate?: Record<string, unknown>;
  /**
   * REQUIRED true for destructive-annotated tools: the builder/route refuses to
   * save without it (422) and the engine re-checks the annotation at fire time
   * — destructive without confirm NEVER silently executes.
   */
  confirmDestructive?: boolean;
}

export type AutomationAction =
  | CreateAttentionAction
  | CreateTaskAction
  | NotifyAction
  | RunToolAction;

export interface AutomationRule {
  id: string;
  name: string;
  /** Connector slug, 'system', or '*' (wildcard). */
  triggerSlug: string;
  /** Activity eventType (e.g. GMAIL_MESSAGE_RECEIVED) or bus event type (e.g. sync.failed). */
  triggerEvent: string;
  conditions: RuleCondition[];
  actions: AutomationAction[];
  isActive: boolean;
  lastFiredAt: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = "ok" | "condition_miss" | "action_failed";

export interface ConditionResult {
  field: string;
  op: ConditionOp;
  value: string;
  actual: string;
  pass: boolean;
  error?: string; // e.g. rejected regex pattern
}

export interface ActionResultDetail {
  kind: ActionKind;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface AutomationRunRow {
  id: string;
  ruleId: string;
  activityId: string | null;
  /** Bus event id that produced this run (hardening item 12) — the
   *  UNIQUE(rule_id, event_id) guard keys boot-replay idempotency. NULL on
   *  legacy rows and test dry-runs. */
  eventId: number | null;
  trigger: Record<string, unknown>;
  status: AutomationRunStatus;
  detail: {
    conditions?: ConditionResult[];
    actions?: ActionResultDetail[];
  } | null;
  error: string | null;
  createdAt: string;
}

/** Builder metadata: known trigger events (connector triggers + system events). */
export interface TriggerOption {
  slug: string;
  event: string;
  label: string;
}
