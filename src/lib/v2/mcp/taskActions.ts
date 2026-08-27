import { z } from "zod";
import { registerAction } from "./registry";
import { emit } from "../events";
import { createTask, listTasks } from "../tasks/store";
import { TASK_STATUSES, type TaskStatus } from "../tasks/types";

/**
 * SPEC-C D4-lite internal actions backing the seeded 'agentos' WebMCP package
 * (seedSelfTools.ts). Registered lazily beside ensureCoreActions in
 * mcp/server.ts + resolved at call time by webmcp/execute.ts 'internal'
 * dispatch. The full self-tools set (pipeline/marketing/memory/settings)
 * lands with chunk 3.
 */

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
}
