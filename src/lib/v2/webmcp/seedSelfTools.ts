import { getDb } from "../db";
import {
  getPackage,
  createPackage,
  addTool,
  updateTool,
  publishPackage,
  listTools,
  type ToolInput,
} from "./store";

/**
 * SPEC-C D4 — the full 'agentos' self-tools package: the tool surface that
 * lets Jarvis (and any MCP client) drive the OS. All handlers are 'internal'
 * → registry actions registered in mcp/taskActions.ts, which boot.ts wires
 * BEFORE this seed runs.
 *
 * Versioning: SEED_TOOLS changes MUST bump SEED_VERSION. The applied seed
 * version is stored in the `meta` table ('webmcp_agentos_seed_version');
 * when the code's SEED_VERSION is newer, the seed definitions are synced
 * into the draft working set (missing tools added, seed-named tools updated
 * in place — user-added extra tools are never touched) and the package is
 * republished EXACTLY ONCE (publishPackage bumps current_version and swaps
 * the registry; the brain's toolsSignature() invalidates its warm session
 * automatically). Idempotent across boots; an ARCHIVED package is the
 * user's deliberate choice and is never resurrected.
 *
 * Approval: state-changing tools (tasks_update_status, pages_append) carry
 * requires_approval=1 — webmcp/execute.ts refuses them on the published
 * lane and the Jarvis brain relays the refusal cleanly (the verified path).
 * memory_search / memory_ingest / get_actions / execute_action / navigate
 * are RESERVED brain built-in names — a same-named seed tool would be
 * skipped first-wins in the brain ('navigate' collides by design: its
 * function is identical). No memory_* wrapper is seeded: the memory tools
 * are already first-class on /api/mcp (A7.1) and built into the brain.
 */

const SLUG = "agentos";

/** Bump on ANY change to SEED_TOOLS — drives the republish-once path. */
export const SEED_VERSION = 2;

const META_KEY = "webmcp_agentos_seed_version";

const SEED_TOOLS: (ToolInput & { handlerConfig: { actionKey: string } })[] = [
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
    handlerKind: "internal",
    handlerConfig: { actionKey: "ui.navigate" },
    requiresApproval: false,
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
    handlerKind: "internal",
    handlerConfig: { actionKey: "tasks_create" },
    requiresApproval: false,
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
    handlerKind: "internal",
    handlerConfig: { actionKey: "tasks_list" },
    requiresApproval: false,
    position: 2,
  },
  {
    name: "tasks_get",
    description:
      "Read ONE Agent OS task in full by uuid or display id (tk-N): title, status, schedule, spec, plan, result, error. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task uuid or display id like 'tk-12'" },
      },
      required: ["id"],
    },
    handlerKind: "internal",
    handlerConfig: { actionKey: "tasks_get" },
    requiresApproval: false,
    position: 3,
  },
  {
    name: "tasks_update_status",
    description:
      "Move a task to 'Waiting' (blocked — needs the user) or 'Review' (done — awaiting verification). The only agent-settable statuses. Requires human approval.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task uuid or display id like 'tk-12'" },
        status: {
          type: "string",
          enum: ["Waiting", "Review"],
          description: "Agent-settable target status",
        },
      },
      required: ["id", "status"],
    },
    handlerKind: "internal",
    handlerConfig: { actionKey: "tasks_update_status" },
    requiresApproval: true,
    position: 4,
  },
  {
    name: "pages_append",
    description:
      "Append text to today's scratchpad page (/today) — each line becomes a paragraph; append-only, never overwrites. Requires human approval.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to append; newlines split into paragraphs" },
        date: { type: "string", description: "Optional 'YYYY-MM-DD' page (default: today)" },
      },
      required: ["text"],
    },
    handlerKind: "internal",
    handlerConfig: { actionKey: "pages_append" },
    requiresApproval: true,
    position: 5,
  },
  {
    name: "events_recent",
    description:
      "Read the last N events from the Agent OS event bus (task status changes, memory ingests, job runs, …), optionally filtered by exact type. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Exact event type filter, e.g. 'task.status'" },
        limit: { type: "integer", description: "Max events, 1-50 (default 20)" },
      },
    },
    handlerKind: "internal",
    handlerConfig: { actionKey: "events_recent" },
    requiresApproval: false,
    position: 6,
  },
  {
    name: "jobs_list",
    description:
      "List the scheduler's jobs: id, kind, schedule, next run, last status, enabled. Read-only.",
    inputSchema: { type: "object", properties: {} },
    handlerKind: "internal",
    handlerConfig: { actionKey: "jobs_list" },
    requiresApproval: false,
    position: 7,
  },
];

function readAppliedSeedVersion(): number {
  try {
    const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(META_KEY) as
      | { value: string }
      | undefined;
    const n = row ? Number(row.value) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeAppliedSeedVersion(v: number): void {
  getDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(META_KEY, String(v));
}

/** Seed-def equality against a stored tool row (drives update-in-place). */
function toolMatchesSeed(
  existing: { description: string; inputSchema: Record<string, unknown>; handlerKind: string; handlerConfig: Record<string, unknown>; requiresApproval: boolean; position: number },
  seed: (typeof SEED_TOOLS)[number],
): boolean {
  return (
    existing.description === (seed.description ?? "") &&
    JSON.stringify(existing.inputSchema) === JSON.stringify(seed.inputSchema ?? { type: "object", properties: {} }) &&
    existing.handlerKind === seed.handlerKind &&
    JSON.stringify(existing.handlerConfig) === JSON.stringify(seed.handlerConfig) &&
    existing.requiresApproval === !!seed.requiresApproval &&
    existing.position === (seed.position ?? 0)
  );
}

/** Create/sync + publish the 'agentos' package. Safe to call on every boot. */
export function seedSelfTools(): { seeded: boolean; version: number } {
  const existing = getPackage(SLUG);
  if (existing?.status === "archived") {
    // The user archived it deliberately — respect that, never resurrect.
    return { seeded: false, version: existing.currentVersion };
  }
  const applied = readAppliedSeedVersion();
  if (existing && existing.status === "published" && applied >= SEED_VERSION) {
    return { seeded: false, version: existing.currentVersion };
  }

  const pkg =
    existing ??
    createPackage({
      slug: SLUG,
      name: "Agent OS self-tools",
      description:
        "Built-in tools that let agents drive the OS: navigation, task CRUD + status, scratchpad append, event bus + scheduler reads.",
      icon: "🛠️",
    });

  // Sync the seed definitions into the DRAFT working set. Seed-named tools
  // are updated in place; tools the user added to this package are untouched.
  const have = new Map(listTools(pkg.id).map((t) => [t.name, t]));
  let changed = false;
  for (const tool of SEED_TOOLS) {
    const current = have.get(tool.name);
    if (!current) {
      addTool(pkg.id, tool);
      changed = true;
    } else if (!toolMatchesSeed(current, tool)) {
      updateTool(pkg.id, tool.name, {
        description: tool.description,
        inputSchema: tool.inputSchema,
        handlerKind: tool.handlerKind,
        handlerConfig: tool.handlerConfig,
        requiresApproval: !!tool.requiresApproval,
        position: tool.position,
      });
      changed = true;
    }
  }

  // Republish only when the draft actually moved (or was never published) —
  // a lost meta row alone must not burn a version number.
  if (!changed && pkg.status === "published") {
    writeAppliedSeedVersion(SEED_VERSION);
    return { seeded: false, version: pkg.currentVersion };
  }
  const { version } = publishPackage(pkg.id);
  writeAppliedSeedVersion(SEED_VERSION);
  return { seeded: true, version };
}
