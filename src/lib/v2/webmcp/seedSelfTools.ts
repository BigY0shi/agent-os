import { getPackage, createPackage, addTool, publishPackage, listTools } from "./store";

/**
 * SPEC-C D4-lite — seed the first 'agentos' self-tools package (MINIMAL
 * starter; the full self-tools set — pipeline/marketing/memory/settings —
 * is chunk 3's D4.1). All handlers are 'internal' → registry actions
 * registered in mcp/taskActions.ts.
 *
 * Idempotent: once the package exists AND is published, this is a no-op —
 * repeated boots never create versions or duplicate tools. requires_approval
 * stays 0 on all three (navigate is UI-only, tasks_create is additive,
 * tasks_list is read-only).
 */

const SLUG = "agentos";

const SEED_TOOLS = [
  {
    name: "navigate",
    description:
      "Navigate the Agent OS app to an in-app route, e.g. {\"route\":\"/tasks\"}. The UI performs the navigation; nothing changes server-side.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string", description: "In-app route path starting with '/'" },
      },
      required: ["route"],
    },
    handlerKind: "internal" as const,
    handlerConfig: { actionKey: "ui.navigate" },
    position: 0,
  },
  {
    name: "tasks_create",
    description:
      "Create a new Agent OS task. Provide a short title and optionally a markdown spec. Returns the created task's display id (tk-N).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        spec: { type: "string", description: "Optional markdown spec" },
      },
      required: ["title"],
    },
    handlerKind: "internal" as const,
    handlerConfig: { actionKey: "tasks_create" },
    position: 1,
  },
  {
    name: "tasks_list",
    description:
      "List Agent OS tasks, optionally filtered by status (Todo, Waiting, Ready, Working, Review, Done).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["Todo", "Waiting", "Ready", "Working", "Review", "Done"],
          description: "Optional status filter",
        },
      },
    },
    handlerKind: "internal" as const,
    handlerConfig: { actionKey: "tasks_list" },
    position: 2,
  },
];

/** Create + publish the 'agentos' package. Safe to call on every boot. */
export function seedSelfTools(): { seeded: boolean; version: number } {
  const existing = getPackage(SLUG);
  if (existing && existing.status === "published" && existing.currentVersion >= 1) {
    return { seeded: false, version: existing.currentVersion };
  }
  if (existing?.status === "archived") {
    // The user archived it deliberately — respect that, never resurrect.
    return { seeded: false, version: existing.currentVersion };
  }

  const pkg =
    existing ??
    createPackage({
      slug: SLUG,
      name: "Agent OS self-tools",
      description: "Built-in tools that let agents drive the OS: navigation + task CRUD (starter set).",
      icon: "🛠️",
    });

  const have = new Set(listTools(pkg.id).map((t) => t.name));
  for (const tool of SEED_TOOLS) {
    if (!have.has(tool.name)) addTool(pkg.id, tool);
  }
  const { version } = publishPackage(pkg.id);
  return { seeded: true, version };
}
