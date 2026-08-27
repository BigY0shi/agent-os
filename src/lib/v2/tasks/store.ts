import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, tx } from "../db";
import { uuid, now } from "../ids";
import { emit } from "../events";
import { enqueueScheduledTask, removeScheduledTask } from "../scheduler";
import { readSettings } from "../../settings";
import {
  canTransition,
  ACTIVE_STATUSES,
  type Task,
  type TaskStatus,
  type TaskEvent,
  type TaskSession,
  type TaskSessionKind,
  type Conversation,
  type Message,
  type TransitionActor,
  type PlanStatus,
} from "./types";

/**
 * SPEC-B B1 — task store: CRUD + display-id allocation + status machine +
 * activity log + conversations/messages + session linkage + exile-delete.
 *
 * Port notes (REF apps/webapp/app/services/task.server.ts, pattern-only):
 *  - display ids come from a synchronous transaction over meta.task_root_counter
 *    (root: 'tk-N') / parent child_count (child: 'tk-N.M') — the Postgres
 *    trigger reimplemented per SPEC-B §2;
 *  - depth cap is 2 LEVELS (root + subtask): a parent whose display_id already
 *    contains a dot cannot take children (stricter than REF's 3 levels, per
 *    the B1 brief);
 *  - changeTaskStatus keeps REF's canonical wake-up rules verbatim (park on
 *    Todo/Waiting/Review, Ready buffer only when no pending wake-up, parent
 *    auto-Done with Review counting active, Done deactivates scheduling);
 *  - updateTask NEVER touches the scheduler queue (upstream stall fix: title /
 *    description edits must not cancel a pending wake-up) — schedule changes go
 *    through tasks/recurrence.ts applySchedule;
 *  - deleteTask is exile-pattern: full JSON bundle to
 *    ~/.agentic-os/.exile/tasks/ verified on disk BEFORE any row is removed
 *    (mirrors src/lib/v2/memory/exile.ts).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  display_id: string;
  title: string;
  description_md: string | null;
  status: string;
  parent_uuid: string | null;
  child_count: number;
  spec_md: string | null;
  plan_md: string | null;
  plan_status: string;
  schedule: string | null;
  run_at: string | null;
  last_run_at: string | null;
  occurrence_count: number;
  max_occurrences: number | null;
  is_active: number;
  end_date: string | null;
  scheduled_date: string | null;
  source: string;
  agent_id: string | null;
  result: string | null;
  error: string | null;
  job_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    displayId: r.display_id,
    title: r.title,
    descriptionMd: r.description_md,
    status: r.status as TaskStatus,
    parentId: r.parent_uuid,
    childCount: r.child_count,
    specMd: r.spec_md,
    planMd: r.plan_md,
    planStatus: r.plan_status as PlanStatus,
    schedule: r.schedule,
    runAt: r.run_at,
    lastRunAt: r.last_run_at,
    occurrenceCount: r.occurrence_count,
    maxOccurrences: r.max_occurrences,
    isActive: r.is_active === 1,
    endDate: r.end_date,
    scheduledDate: r.scheduled_date,
    source: r.source,
    agentId: r.agent_id,
    result: r.result,
    error: r.error,
    jobId: r.job_id,
    metadata: safeJson(r.metadata),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

function getRow(id: string): TaskRow | undefined {
  return getDb().prepare("SELECT * FROM v2_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export function appendTaskEvent(
  taskId: string,
  kind: string,
  actor: TransitionActor,
  detail: Record<string, unknown> = {},
): void {
  getDb()
    .prepare(
      "INSERT INTO v2_task_events(task_id, kind, actor, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(taskId, kind, actor, JSON.stringify(detail), now());
}

export function listTaskEvents(taskId: string, limit = 50): TaskEvent[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM v2_task_events WHERE task_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(taskId, Math.min(Math.max(limit, 1), 500)) as Array<{
    id: number;
    task_id: string;
    kind: string;
    actor: string;
    detail: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    kind: r.kind,
    actor: r.actor as TransitionActor,
    detail: safeJson(r.detail),
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Create + display-id allocation
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title?: string;
  descriptionMd?: string;
  specMd?: string;
  status?: TaskStatus; // default 'Todo'; 'Ready' arms the editing buffer
  parentId?: string;
  source?: string; // manual | daily | agent | automation | seed
  agentId?: string;
  scheduledDate?: string; // 'YYYY-MM-DD' calendar pin
  metadata?: Record<string, unknown>;
  actor?: TransitionActor; // default 'user'
}

function editingBufferSec(): number {
  const v = readSettings().tasks?.editingBufferSec;
  return typeof v === "number" && v > 0 ? v : 120;
}

/** Arm the Ready editing buffer: run_at = now + bufferSec, remove-then-enqueue
 *  the deterministic wake job (SPEC-B: NO idempotency key by design). */
function armReadyBuffer(taskId: string): string {
  const runAt = new Date(Date.now() + editingBufferSec() * 1000).toISOString();
  getDb()
    .prepare("UPDATE v2_tasks SET run_at = ?, updated_at = ? WHERE id = ?")
    .run(runAt, now(), taskId);
  removeScheduledTask(taskId);
  enqueueScheduledTask(taskId, { runAt });
  return runAt;
}

export function createTask(input: CreateTaskInput = {}): Task {
  const actor = input.actor ?? "user";
  const status: TaskStatus = input.status ?? "Todo";
  const id = uuid();
  const ts = now();

  tx((db) => {
    let displayId: string;
    if (input.parentId) {
      const parent = db
        .prepare("SELECT id, display_id, child_count FROM v2_tasks WHERE id = ?")
        .get(input.parentId) as
        | { id: string; display_id: string; child_count: number }
        | undefined;
      if (!parent) throw new Error(`parent task ${input.parentId} not found`);
      if (parent.display_id.includes(".")) {
        throw new Error(
          "Task depth limit reached: max 2 levels (task → sub-task)",
        );
      }
      const n = parent.child_count + 1;
      db.prepare(
        "UPDATE v2_tasks SET child_count = ?, updated_at = ? WHERE id = ?",
      ).run(n, ts, parent.id);
      displayId = `${parent.display_id}.${n}`;
    } else {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'task_root_counter'")
        .get() as { value: string } | undefined;
      const n = (row ? parseInt(row.value, 10) || 0 : 0) + 1;
      db.prepare(
        "INSERT INTO meta(key, value) VALUES ('task_root_counter', ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(n));
      displayId = `tk-${n}`;
    }

    db.prepare(
      `INSERT INTO v2_tasks(
        id, display_id, title, description_md, status, parent_uuid, spec_md,
        source, agent_id, scheduled_date, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      displayId,
      input.title ?? "",
      input.descriptionMd ?? null,
      status,
      input.parentId ?? null,
      input.specMd ?? null,
      input.source ?? "manual",
      input.agentId ?? null,
      input.scheduledDate ?? null,
      JSON.stringify(input.metadata ?? {}),
      ts,
      ts,
    );

    db.prepare(
      "INSERT INTO v2_task_events(task_id, kind, actor, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, "created", actor, JSON.stringify({ status, source: input.source ?? "manual" }), ts);
  });

  // Buffer wake-up (REF createTask): a freshly-created Ready task sits for the
  // editing buffer before execution. Todo/Waiting skip it; scheduled tasks go
  // through recurrence.applySchedule instead.
  if (status === "Ready") {
    try {
      armReadyBuffer(id);
    } catch (err) {
      console.warn(`[v2/tasks] failed to arm Ready buffer for ${id}:`, err);
    }
  }

  const task = rowToTask(getRow(id)!);
  emit(
    "task.created",
    { taskId: task.id, displayId: task.displayId, title: task.title, status: task.status, source: task.source },
    "tasks",
  );
  return task;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getTask(id: string): Task | null {
  const r = getRow(id);
  return r ? rowToTask(r) : null;
}

export function getTaskByDisplayId(displayId: string): Task | null {
  const r = getDb()
    .prepare("SELECT * FROM v2_tasks WHERE display_id = ?")
    .get(displayId) as TaskRow | undefined;
  return r ? rowToTask(r) : null;
}

/** Resolve a uuid OR a 'tk-…' display id to the internal uuid (REF resolveTaskId). */
export function resolveTaskId(input: string): string | null {
  if (!input) return null;
  if (UUID_RE.test(input)) {
    const r = getDb().prepare("SELECT id FROM v2_tasks WHERE id = ?").get(input) as
      | { id: string }
      | undefined;
    return r?.id ?? null;
  }
  const r = getDb()
    .prepare("SELECT id FROM v2_tasks WHERE display_id = ?")
    .get(input) as { id: string } | undefined;
  return r?.id ?? null;
}

export function listSubtasks(parentId: string): Task[] {
  const rows = getDb()
    .prepare("SELECT * FROM v2_tasks WHERE parent_uuid = ? ORDER BY created_at ASC")
    .all(parentId) as TaskRow[];
  return rows.map(rowToTask);
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

export interface ListTasksFilter {
  status?: TaskStatus[];
  source?: string;
  agentId?: string;
  /** undefined = all; null = roots only; string = children of that task. */
  parent?: string | null;
  dueAfter?: string; // ISO, run_at >=
  dueBefore?: string; // ISO, run_at <=
  scheduledDate?: string; // 'YYYY-MM-DD'
  q?: string; // FTS5 (LIKE fallback)
  limit?: number;
}

function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

export function listTasks(filter: ListTasksFilter = {}): Task[] {
  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [];

  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => "?").join(",")})`);
    args.push(...filter.status);
  }
  if (filter.source) {
    where.push("source = ?");
    args.push(filter.source);
  }
  if (filter.agentId) {
    where.push("agent_id = ?");
    args.push(filter.agentId);
  }
  if (filter.parent === null) {
    where.push("parent_uuid IS NULL");
  } else if (typeof filter.parent === "string") {
    where.push("parent_uuid = ?");
    args.push(filter.parent);
  }
  if (filter.dueAfter) {
    where.push("run_at IS NOT NULL AND run_at >= ?");
    args.push(filter.dueAfter);
  }
  if (filter.dueBefore) {
    where.push("run_at IS NOT NULL AND run_at <= ?");
    args.push(filter.dueBefore);
  }
  if (filter.scheduledDate) {
    where.push("scheduled_date = ?");
    args.push(filter.scheduledDate);
  }

  if (filter.q?.trim()) {
    let ids: string[] | null = null;
    try {
      ids = (
        db
          .prepare("SELECT task_id FROM v2_tasks_fts WHERE v2_tasks_fts MATCH ?")
          .all(ftsQuery(filter.q)) as { task_id: string }[]
      ).map((r) => r.task_id);
    } catch (err) {
      // FTS unavailable or query unparsable — LIKE fallback (documented in SPEC-B).
      console.warn("[v2/tasks] FTS search failed, using LIKE fallback:", err);
    }
    if (ids) {
      if (ids.length === 0) return [];
      where.push(`id IN (${ids.map(() => "?").join(",")})`);
      args.push(...ids);
    } else {
      where.push(
        "(title LIKE ? OR coalesce(description_md,'') LIKE ? OR coalesce(spec_md,'') LIKE ?)",
      );
      const like = `%${filter.q.trim()}%`;
      args.push(like, like, like);
    }
  }

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const sql = `SELECT * FROM v2_tasks ${
    where.length ? "WHERE " + where.join(" AND ") : ""
  } ORDER BY created_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...args, limit) as TaskRow[];
  return rows.map(rowToTask);
}

// ---------------------------------------------------------------------------
// Update (non-status, non-schedule)
// ---------------------------------------------------------------------------

export interface UpdateTaskInput {
  title?: string;
  descriptionMd?: string | null;
  specMd?: string | null;
  planMd?: string | null;
  planStatus?: PlanStatus;
  agentId?: string | null;
  scheduledDate?: string | null;
  result?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>; // replaced wholesale (REF parity)
}

/**
 * Field updates only. NEVER touches status (use changeTaskStatus) and NEVER
 * touches the scheduler queue (upstream stall fix: title/description edits on
 * a pending fire must not cancel the wake-up). Schedule changes go through
 * recurrence.applySchedule.
 */
export function updateTask(
  id: string,
  patch: UpdateTaskInput,
  actor: TransitionActor = "user",
): Task {
  const current = getRow(id);
  if (!current) throw new Error(`task ${id} not found`);

  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: string[] = [];
  const map: Array<[keyof UpdateTaskInput, string, (v: unknown) => unknown]> = [
    ["title", "title", (v) => v],
    ["descriptionMd", "description_md", (v) => v],
    ["specMd", "spec_md", (v) => v],
    ["planMd", "plan_md", (v) => v],
    ["planStatus", "plan_status", (v) => v],
    ["agentId", "agent_id", (v) => v],
    ["scheduledDate", "scheduled_date", (v) => v],
    ["result", "result", (v) => v],
    ["error", "error", (v) => v],
    ["metadata", "metadata", (v) => JSON.stringify(v ?? {})],
  ];
  for (const [key, col, conv] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      args.push(conv(patch[key]));
      changed.push(key);
    }
  }
  if (sets.length === 0) return rowToTask(current);

  sets.push("updated_at = ?");
  args.push(now(), id);
  getDb().prepare(`UPDATE v2_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  appendTaskEvent(id, "updated", actor, { fields: changed });
  return rowToTask(getRow(id)!);
}

// ---------------------------------------------------------------------------
// Status machine (REF changeTaskStatus, verbatim-adapt)
// ---------------------------------------------------------------------------

export function changeTaskStatus(
  id: string,
  status: TaskStatus,
  actor: TransitionActor = "agent",
): Task {
  const current = getRow(id);
  if (!current) throw new Error(`task ${id} not found`);
  const from = current.status as TaskStatus;

  if (!canTransition(from, status, actor)) {
    throw new Error(`Invalid transition: ${from} -> ${status} by ${actor}`);
  }

  const db = getDb();
  const ts = now();

  // Canonical wake-up rule for non-scheduled tasks (REF, verbatim):
  //  - Todo / Waiting / Review parks the task: cancel any pending wake-up and
  //    clear run_at so an old buffer doesn't fire late. Scheduled tasks keep
  //    their queue — the schedule is the user's intent and keeps ticking.
  if (status === "Todo" || status === "Waiting" || status === "Review") {
    if (!current.schedule) {
      removeScheduledTask(id);
      if (current.run_at) {
        db.prepare("UPDATE v2_tasks SET run_at = NULL WHERE id = ?").run(id);
      }
    }
  }

  //  - Ready with a pending wake-up leaves it alone (fires on its original
  //    schedule); otherwise arm a fresh editing buffer.
  if (status === "Ready" && !current.schedule) {
    if (!current.run_at) {
      try {
        armReadyBuffer(id);
      } catch (err) {
        console.warn(`[v2/tasks] failed to arm Ready buffer for ${id}:`, err);
      }
    }
  }

  //  - Done on a scheduled/pending task deactivates scheduling entirely.
  if (status === "Done" && (current.run_at || current.schedule)) {
    removeScheduledTask(id);
    db.prepare(
      "UPDATE v2_tasks SET is_active = 0, run_at = NULL WHERE id = ?",
    ).run(id);
  }

  const completedAt = status === "Done" ? ts : from === "Done" ? null : current.completed_at;
  db.prepare(
    "UPDATE v2_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
  ).run(status, completedAt, ts, id);

  appendTaskEvent(id, "status_change", actor, { from, to: status });
  emit(
    "task.status",
    { taskId: id, displayId: current.display_id, status, from, actor },
    "tasks",
  );

  // Parent auto-Done (REF): parent flips once every child left the active set.
  // Review counts as active — a sibling awaiting user verification blocks it.
  if (status === "Done" && current.parent_uuid) {
    const ph = ACTIVE_STATUSES.map(() => "?").join(",");
    const active = db
      .prepare(
        `SELECT COUNT(*) AS c FROM v2_tasks WHERE parent_uuid = ? AND id != ? AND status IN (${ph})`,
      )
      .get(current.parent_uuid, id, ...ACTIVE_STATUSES) as { c: number };
    if (active.c === 0) {
      const parent = getRow(current.parent_uuid);
      if (parent && parent.status !== "Done") {
        // System-on-behalf-of-user transition (REF uses actor 'user' here).
        changeTaskStatus(current.parent_uuid, "Done", "user");
      }
    }
  }

  return rowToTask(getRow(id)!);
}

export function completeTask(
  id: string,
  opts: { actor?: TransitionActor; result?: string } = {},
): Task {
  if (opts.result !== undefined) {
    getDb()
      .prepare("UPDATE v2_tasks SET result = ?, updated_at = ? WHERE id = ?")
      .run(opts.result, now(), id);
  }
  return changeTaskStatus(id, "Done", opts.actor ?? "user");
}

export function reopenTask(id: string, actor: TransitionActor = "user"): Task {
  return changeTaskStatus(id, "Todo", actor);
}

// ---------------------------------------------------------------------------
// Conversations + messages (B1.5)
// ---------------------------------------------------------------------------

interface ConvRow {
  id: string;
  source: string;
  task_id: string | null;
  agent_id: string | null;
  run_no: number | null;
  created_at: string;
  updated_at: string;
}

function rowToConv(r: ConvRow): Conversation {
  return {
    id: r.id,
    source: r.source as Conversation["source"],
    taskId: r.task_id,
    agentId: r.agent_id,
    runNo: r.run_no,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** One-shot tasks share a single thread, created lazily (REF policy). */
export function getOrCreateTaskConversation(
  taskId: string,
  agentId?: string,
): Conversation {
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT * FROM v2_conversations WHERE task_id = ? AND run_no IS NULL AND source = 'task' ORDER BY created_at LIMIT 1",
    )
    .get(taskId) as ConvRow | undefined;
  if (existing) return rowToConv(existing);
  const id = uuid();
  const ts = now();
  db.prepare(
    "INSERT INTO v2_conversations(id, source, task_id, agent_id, created_at, updated_at) VALUES (?, 'task', ?, ?, ?, ?)",
  ).run(id, taskId, agentId ?? null, ts, ts);
  return rowToConv(
    db.prepare("SELECT * FROM v2_conversations WHERE id = ?").get(id) as ConvRow,
  );
}

/** Recurring tasks get a FRESH conversation per run (REF policy). */
export function createRunConversation(
  taskId: string,
  runNo: number,
  agentId?: string,
): Conversation {
  const db = getDb();
  const id = uuid();
  const ts = now();
  db.prepare(
    "INSERT INTO v2_conversations(id, source, task_id, agent_id, run_no, created_at, updated_at) VALUES (?, 'scheduled-task', ?, ?, ?, ?, ?)",
  ).run(id, taskId, agentId ?? null, runNo, ts, ts);
  return rowToConv(
    db.prepare("SELECT * FROM v2_conversations WHERE id = ?").get(id) as ConvRow,
  );
}

export function listTaskConversations(taskId: string): Conversation[] {
  const rows = getDb()
    .prepare("SELECT * FROM v2_conversations WHERE task_id = ? ORDER BY created_at")
    .all(taskId) as ConvRow[];
  return rows.map(rowToConv);
}

export function appendMessage(
  conversationId: string,
  input: {
    role: Message["role"];
    content: string;
    userType?: Message["userType"];
    ephemeral?: boolean;
  },
): Message {
  const db = getDb();
  const id = uuid();
  const ts = now();
  db.prepare(
    "INSERT INTO v2_messages(id, conversation_id, role, user_type, ephemeral, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    conversationId,
    input.role,
    input.userType ?? "human",
    input.ephemeral ? 1 : 0,
    input.content,
    ts,
  );
  db.prepare("UPDATE v2_conversations SET updated_at = ? WHERE id = ?").run(
    ts,
    conversationId,
  );
  return {
    id,
    conversationId,
    role: input.role,
    userType: input.userType ?? "human",
    ephemeral: !!input.ephemeral,
    content: input.content,
    createdAt: ts,
  };
}

export function listMessages(
  conversationId: string,
  opts: { includeEphemeral?: boolean } = {},
): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM v2_messages WHERE conversation_id = ? ${
        opts.includeEphemeral === false ? "AND ephemeral = 0" : ""
      } ORDER BY created_at, id`,
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    role: string;
    user_type: string;
    ephemeral: number;
    content: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Message["role"],
    userType: r.user_type as Message["userType"],
    ephemeral: r.ephemeral === 1,
    content: r.content,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Session linkage
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  task_id: string;
  kind: string;
  session_ref: string | null;
  agent: string | null;
  dir: string | null;
  prompt: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToSession(r: SessionRow): TaskSession {
  return {
    id: r.id,
    taskId: r.task_id,
    kind: r.kind as TaskSessionKind,
    sessionRef: r.session_ref,
    agent: r.agent,
    dir: r.dir,
    prompt: r.prompt,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function addTaskSession(
  taskId: string,
  input: {
    kind: TaskSessionKind;
    sessionRef?: string;
    agent?: string;
    dir?: string;
    prompt?: string;
    status?: string;
  },
): TaskSession {
  const db = getDb();
  const id = uuid();
  const ts = now();
  db.prepare(
    `INSERT INTO v2_task_sessions(id, task_id, kind, session_ref, agent, dir, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    taskId,
    input.kind,
    input.sessionRef ?? null,
    input.agent ?? null,
    input.dir ?? null,
    input.prompt ?? null,
    input.status ?? "starting",
    ts,
    ts,
  );
  appendTaskEvent(taskId, "session_linked", "system", { sessionId: id, kind: input.kind });
  return rowToSession(
    db.prepare("SELECT * FROM v2_task_sessions WHERE id = ?").get(id) as SessionRow,
  );
}

export function updateTaskSession(
  id: string,
  patch: { sessionRef?: string; status?: string },
): TaskSession {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.sessionRef !== undefined) {
    sets.push("session_ref = ?");
    args.push(patch.sessionRef);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    args.push(now(), id);
    db.prepare(`UPDATE v2_task_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  }
  const row = db.prepare("SELECT * FROM v2_task_sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  if (!row) throw new Error(`task session ${id} not found`);
  return rowToSession(row);
}

export function listTaskSessions(taskId: string): TaskSession[] {
  const rows = getDb()
    .prepare("SELECT * FROM v2_task_sessions WHERE task_id = ? ORDER BY created_at")
    .all(taskId) as SessionRow[];
  return rows.map(rowToSession);
}

// ---------------------------------------------------------------------------
// Exile-delete (global rule 1: nothing is unrecoverably destroyed)
// ---------------------------------------------------------------------------

export interface TaskExileResult {
  ok: true;
  taskId: string;
  displayId: string;
  exiledTo: string;
  removedTasks: number;
}

function exileDir(): string {
  return path.join(os.homedir(), ".agentic-os", ".exile", "tasks");
}

/**
 * Delete = exile: the task, its subtasks, events, sessions, conversations,
 * messages, and page links are bundled to
 * `~/.agentic-os/.exile/tasks/<stamp>-<taskId>.json` and VERIFIED on disk
 * before any row is removed (mirrors memory/exile.ts). No bundle ⇒ no delete.
 */
export function deleteTask(id: string): TaskExileResult {
  const db = getDb();
  const root = getRow(id);
  if (!root) throw new Error(`task ${id} not found`);

  const children = db
    .prepare("SELECT * FROM v2_tasks WHERE parent_uuid = ?")
    .all(id) as TaskRow[];
  const allIds = [id, ...children.map((c) => c.id)];
  const ph = allIds.map(() => "?").join(",");

  const events = db
    .prepare(`SELECT * FROM v2_task_events WHERE task_id IN (${ph}) ORDER BY id`)
    .all(...allIds);
  const sessions = db
    .prepare(`SELECT * FROM v2_task_sessions WHERE task_id IN (${ph})`)
    .all(...allIds);
  const conversations = db
    .prepare(`SELECT * FROM v2_conversations WHERE task_id IN (${ph})`)
    .all(...allIds) as ConvRow[];
  const convIds = conversations.map((c) => c.id);
  const messages = convIds.length
    ? db
        .prepare(
          `SELECT * FROM v2_messages WHERE conversation_id IN (${convIds
            .map(() => "?")
            .join(",")}) ORDER BY created_at`,
        )
        .all(...convIds)
    : [];
  const pageLinks = db
    .prepare(`SELECT * FROM v2_page_task_links WHERE task_id IN (${ph})`)
    .all(...allIds);

  // ---- Write the bundle FIRST ----
  const dir = exileDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().slice(0, 19).replace(/:/g, "-").replace("T", "_");
  const exilePath = path.join(dir, `${stamp}-${id}.json`);
  const bundle = {
    exiledAt: now(),
    kind: "task-exile",
    task: rowToTask(root),
    subtasks: children.map(rowToTask),
    events,
    sessions,
    conversations,
    messages,
    pageLinks,
  };
  fs.writeFileSync(exilePath, JSON.stringify(bundle, null, 2), "utf8");

  // Hard gate: no bundle on disk ⇒ no deletion.
  if (!fs.existsSync(exilePath) || fs.statSync(exilePath).size === 0) {
    throw new Error(
      `exile export did not land at ${exilePath} — aborting delete (nothing was removed)`,
    );
  }

  // ---- Remove: scheduler jobs first, then rows (FK cascades children/log) ----
  for (const taskId of allIds) removeScheduledTask(taskId);
  tx((d) => {
    d.prepare("DELETE FROM v2_tasks WHERE id = ?").run(id);
  });

  const result: TaskExileResult = {
    ok: true,
    taskId: id,
    displayId: root.display_id,
    exiledTo: exilePath,
    removedTasks: allIds.length,
  };
  emit("task.deleted", { taskId: id, displayId: root.display_id, exiledTo: exilePath }, "tasks");
  return result;
}
