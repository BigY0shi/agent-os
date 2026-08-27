// Client-safe event types for the V2 bus. NO node imports in this file.

/** Known event type strings. Modules may emit others; these are the documented core. */
export type V2EventType =
  | "memory.ingested"
  | "memory.invalidated"
  | "memory.queue.failed"
  | "job.fired"
  | "job.failed"
  | "task.created"
  | "task.status"
  | "task.wake"
  | "task.run" // B2 engine: {taskId, displayId, status: 'started'|'ok'|'failed', ...}
  | "task.gc" // B2 dispatcher: empty daily task exiled at buffer expiry
  | "task.deleted"
  | "page.created" // B5: daily page find-or-create
  | "scratchpad.reply" // B5: @jarvis mention answered ({pageId, commentId, nodeId})
  | "scratchpad.ingested" // B6: nightly page-text ingest ran
  | "agent.status"
  | "attention.flag" // CONVENTIONS §5: {kind, severity, title, route, dedupeKey}
  | "mcp.execute"
  | (string & {});

export interface V2Event {
  id: number;
  type: V2EventType;
  source: string | null;
  payload: Record<string, unknown>;
  createdAt: string; // UTC ISO
}

/** attention.flag payload contract (CONVENTIONS §5) — consumed by the H4 aggregator. */
export interface AttentionFlagPayload {
  kind: string;
  severity: "info" | "warn" | "urgent";
  title: string;
  route: string; // in-app path the user clicks through to
  dedupeKey: string;
  [extra: string]: unknown;
}
