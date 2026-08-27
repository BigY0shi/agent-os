// SPEC-B B1 — client-safe task types + the actor-gated transition rule.
// NO node imports in this file (eventTypes.ts convention).

/**
 * Working status set for the v2 store. 'Recurring' exists in the DB CHECK for
 * REF-enum parity but is never set here — a task is recurring iff
 * `schedule IS NOT NULL`; its lifecycle runs through the same six statuses.
 */
export const TASK_STATUSES = [
  "Todo",
  "Waiting",
  "Ready",
  "Working",
  "Review",
  "Done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that count as "still active" for parent auto-Done (REF parity:
 *  Review is non-terminal — the user still has to move Review → Done). */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "Todo",
  "Working",
  "Waiting",
  "Ready",
  "Review",
];

export type PlanStatus = "none" | "drafted" | "approved" | "rejected";

export type TaskSource = "manual" | "daily" | "agent" | "automation" | "seed";

/**
 * Who is attempting a status transition (REF task.phase.ts, verbatim-adapt):
 * - "agent"  = agent calling update_task (or equivalent tool)
 * - "user"   = explicit user action (UI button, manual status change)
 * - "system" = time-driven wake-up handler or recurring-advance scheduler
 */
export type TransitionActor = "agent" | "user" | "system";

/**
 * Legal-transition table (REF task.phase.ts canTransition, verbatim):
 * - from === to is always allowed (no-op);
 * - agents may ONLY move a task into Waiting (blocked, needs user input) or
 *   Review (work complete, awaiting user verification) — Working / Done /
 *   Todo / Ready are reserved for system (runtime promotions, scheduled
 *   fires) or user (UI / approval);
 * - user and system may perform any transition.
 */
export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: TransitionActor,
): boolean {
  if (from === to) return true;
  if (
    actor === "agent" &&
    (to === "Working" || to === "Done" || to === "Todo" || to === "Ready")
  ) {
    return false;
  }
  return true;
}

export interface Task {
  id: string;
  displayId: string; // 'tk-N' | 'tk-N.M'
  title: string;
  descriptionMd: string | null;
  status: TaskStatus;
  parentId: string | null;
  childCount: number;
  specMd: string | null;
  planMd: string | null;
  planStatus: PlanStatus;
  schedule: string | null; // RRULE, user-local tz semantics
  runAt: string | null; // UTC ISO next wake
  lastRunAt: string | null;
  occurrenceCount: number;
  maxOccurrences: number | null;
  isActive: boolean;
  endDate: string | null;
  scheduledDate: string | null; // 'YYYY-MM-DD'
  source: string;
  agentId: string | null;
  result: string | null;
  error: string | null;
  jobId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  kind: string;
  actor: TransitionActor;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type TaskSessionKind = "coding" | "browser" | "exec";

export interface TaskSession {
  id: string;
  taskId: string;
  kind: TaskSessionKind;
  sessionRef: string | null;
  agent: string | null;
  dir: string | null;
  prompt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationSource = "task" | "scheduled-task" | "daily" | "chat";

export interface Conversation {
  id: string;
  source: ConversationSource;
  taskId: string | null;
  agentId: string | null;
  runNo: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  userType: "human" | "system";
  ephemeral: boolean;
  content: string;
  createdAt: string;
}
