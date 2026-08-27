import { z } from "zod";
import { registerAction, type ActionContext, type ActionResult } from "./registry";
import { emit, recent } from "../events";
import { listJobs } from "../scheduler";
import {
  createTask,
  listTasks,
  getTask,
  resolveTaskId,
  changeTaskStatus,
} from "../tasks/store";
import { TASK_STATUSES, type TaskStatus } from "../tasks/types";
import { getOrCreateDailyPage, savePageDocInternal, type PageDocNode } from "../pages/store";

/**
 * SPEC-C D4 internal actions backing the seeded 'agentos' WebMCP package
 * (seedSelfTools.ts). Registered lazily beside ensureCoreActions in
 * mcp/server.ts + boot.ts (BEFORE seedSelfTools runs) + resolved at call
 * time by webmcp/execute.ts 'internal' dispatch.
 *
 * Approval semantics for the state-changing pair (tasks_update_status,
 * pages_append): requiresApproval=true on the registry entry (the Jarvis
 * brain's execute_action refuses these cleanly — the verified path) AND the
 * seeded webmcp tool rows carry requires_approval=1 (webmcp/execute.ts
 * published-lane gate). Belt+braces: the handlers ALSO hard-refuse strict
 * (external /api/mcp) callers, since server.ts's execute_action does not
 * consult requiresApproval itself. The Test-tab draft lane (strict=false)
 * still runs them — you, testing your own tool, are the human in the loop.
 */

function refuseStrict(key: string, ctx: ActionContext): ActionResult | null {
  if (ctx.strict) {
    return {
      ok: false,
      output: "",
      error: `'${key}' is a state-changing action and requires human approval — refused for non-interactive/MCP callers`,
    };
  }
  return null;
}

const TRUNC = (s: string | null | undefined, n: number): string =>
  !s ? "" : s.length > n ? s.slice(0, n) + `… [truncated ${s.length - n} chars]` : s;

declare global {
  // eslint-disable-next-line no-var
  var __agentosTaskActions: boolean | undefined;
}

export function ensureTaskActions(): void {
  if (globalThis.__agentosTaskActions) return;
  globalThis.__agentosTaskActions = true;

  registerAction({
    key: "ui.navigate",
    module: "ui",
    description:
      "Navigate the Agent OS UI to an in-app route (e.g. '/tasks', '/pipeline'). Emits a 'ui.navigate' event that the overlay/pages consume — nothing runs server-side.",
    inputSchema: z.object({
      route: z.string().min(1).regex(/^\//, "route must start with '/'").describe("In-app route path"),
    }),
    handler: (args, ctx) => {
      const route = String(args.route);
      emit("ui.navigate", { route, source: ctx.source }, "ui");
      return { ok: true, output: `navigating to ${route}` };
    },
  });

  registerAction({
    key: "tasks_create",
    module: "tasks",
    description:
      "Create an Agent OS task (SPEC-B store). Returns the new task's display id (tk-N). Additive — never modifies existing tasks.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Short task title"),
      spec: z.string().optional().describe("Optional markdown spec for the task body"),
    }),
    handler: (args, ctx) => {
      const task = createTask({
        title: String(args.title),
        specMd: typeof args.spec === "string" ? args.spec : undefined,
        source: "agent",
        metadata: { createdVia: `mcp:${ctx.source}` },
        actor: "agent",
      });
      return {
        ok: true,
        output: `created task ${task.displayId}: ${task.title}`,
        meta: { id: task.id, displayId: task.displayId },
      };
    },
  });

  registerAction({
    key: "tasks_list",
    module: "tasks",
    description:
      "List Agent OS tasks, optionally filtered by status (Todo|Waiting|Ready|Working|Review|Done).",
    inputSchema: z.object({
      status: z.enum(TASK_STATUSES as unknown as [string, ...string[]]).optional(),
    }),
    handler: (args) => {
      const status = typeof args.status === "string" ? (args.status as TaskStatus) : undefined;
      const tasks = listTasks({ status: status ? [status] : undefined, limit: 50 });
      const lines = tasks.map(
        (t) => `${t.displayId} [${t.status}] ${t.title || "(untitled)"}${t.schedule ? " (recurring)" : ""}`,
      );
      return {
        ok: true,
        output: lines.length ? lines.join("\n") : "no tasks match",
        meta: { count: tasks.length },
      };
    },
  });

  registerAction({
    key: "tasks_get",
    module: "tasks",
    description:
      "Read ONE Agent OS task in full by its uuid or display id (tk-N): title, status, schedule, spec, plan, result, error. Read-only.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Task uuid or display id like 'tk-12'"),
    }),
    handler: (args) => {
      const resolved = resolveTaskId(String(args.id));
      const task = resolved ? getTask(resolved) : null;
      if (!task) return { ok: false, output: "", error: `task '${String(args.id)}' not found` };
      const lines = [
        `${task.displayId} [${task.status}] ${task.title || "(untitled)"}`,
        task.schedule ? `schedule: ${task.schedule} (next: ${task.runAt ?? "—"}, active: ${task.isActive})` : null,
        task.scheduledDate ? `scheduledDate: ${task.scheduledDate}` : null,
        task.specMd ? `spec:\n${TRUNC(task.specMd, 2000)}` : null,
        task.planMd ? `plan (${task.planStatus}):\n${TRUNC(task.planMd, 2000)}` : null,
        task.result ? `result:\n${TRUNC(task.result, 2000)}` : null,
        task.error ? `error: ${TRUNC(task.error, 500)}` : null,
      ].filter(Boolean);
      return { ok: true, output: lines.join("\n"), meta: { id: task.id, displayId: task.displayId, status: task.status } };
    },
  });

  registerAction({
    key: "tasks_update_status",
    module: "tasks",
    description:
      "Move an Agent OS task to 'Waiting' (blocked — needs the user) or 'Review' (work done — awaiting user verification). " +
      "Those are the ONLY statuses an agent may set (Todo/Ready/Working/Done are user/system-owned). State-changing — requires human approval.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Task uuid or display id like 'tk-12'"),
      status: z.enum(["Waiting", "Review"]).describe("Agent-settable target status"),
    }),
    requiresApproval: true,
    handler: (args, ctx) => {
      const refused = refuseStrict("tasks_update_status", ctx);
      if (refused) return refused;
      const resolved = resolveTaskId(String(args.id));
      if (!resolved) return { ok: false, output: "", error: `task '${String(args.id)}' not found` };
      try {
        const task = changeTaskStatus(resolved, args.status as TaskStatus, "agent");
        return {
          ok: true,
          output: `${task.displayId} is now ${task.status}`,
          meta: { id: task.id, displayId: task.displayId, status: task.status },
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerAction({
    key: "pages_append",
    module: "pages",
    description:
      "Append text to TODAY's scratchpad page (/today). Each line becomes a plain paragraph (markdown is stored as-is, not rendered). " +
      "State-changing — requires human approval. Never overwrites existing content; append-only.",
    inputSchema: z.object({
      text: z.string().min(1).max(8000).describe("Text to append; newlines split into paragraphs"),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Optional 'YYYY-MM-DD' page (default: today in the user's timezone)"),
    }),
    requiresApproval: true,
    handler: (args, ctx) => {
      const refused = refuseStrict("pages_append", ctx);
      if (refused) return refused;
      try {
        const page = getOrCreateDailyPage(typeof args.date === "string" ? args.date : undefined);
        const doc: PageDocNode = { ...page.doc, content: [...(page.doc.content ?? [])] };
        const lines = String(args.text).replace(/\r\n/g, "\n").split("\n");
        let appended = 0;
        for (const line of lines) {
          const trimmed = line.trimEnd();
          doc.content!.push(
            trimmed
              ? { type: "paragraph", content: [{ type: "text", text: trimmed }] }
              : { type: "paragraph" },
          );
          appended++;
        }
        const saved = savePageDocInternal(page.id, doc);
        return {
          ok: true,
          output: `appended ${appended} paragraph(s) to the ${saved.date ?? "daily"} page (rev ${saved.rev})`,
          meta: { pageId: saved.id, date: saved.date, rev: saved.rev },
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerAction({
    key: "events_recent",
    module: "events",
    description:
      "Read the last N events from the Agent OS event bus (memory ingests, task status changes, job runs, webmcp publishes, …). " +
      "Optionally filter by exact event type (e.g. 'task.status', 'memory.ingested', 'ui.navigate'). Read-only.",
    inputSchema: z.object({
      type: z.string().optional().describe("Exact event type filter"),
      limit: z.number().int().min(1).max(50).optional().describe("Max events (default 20)"),
    }),
    handler: (args) => {
      const events = recent({
        type: typeof args.type === "string" && args.type.trim() ? args.type.trim() : undefined,
        limit: typeof args.limit === "number" ? args.limit : 20,
      });
      if (events.length === 0) return { ok: true, output: "no events match", meta: { count: 0 } };
      const lines = events.map(
        (e) => `${e.createdAt} [${e.type}] (${e.source}) ${TRUNC(JSON.stringify(e.payload), 200)}`,
      );
      return { ok: true, output: lines.join("\n"), meta: { count: events.length } };
    },
  });

  registerAction({
    key: "jobs_list",
    module: "jobs",
    description:
      "List the Agent OS scheduler's jobs: id, kind, schedule (RRULE or one-shot run time), next run, last status, enabled. Read-only.",
    inputSchema: z.object({}),
    handler: () => {
      const jobs = listJobs();
      if (jobs.length === 0) return { ok: true, output: "no jobs scheduled", meta: { count: 0 } };
      const lines = jobs.map((j) =>
        [
          `${j.id} [${j.kind}] ${j.name}`,
          j.rrule ? `rrule=${j.rrule}` : "one-shot",
          `next=${j.run_at ?? "—"}`,
          `last=${j.last_run_at ?? "never"}${j.last_status ? ` (${j.last_status})` : ""}`,
          j.enabled ? "enabled" : "DISABLED",
        ].join(" · "),
      );
      return { ok: true, output: lines.join("\n"), meta: { count: jobs.length } };
    },
  });
}
