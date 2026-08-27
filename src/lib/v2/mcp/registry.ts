import { z } from "zod";

/**
 * F4 Action registry — the single mount point for /api/mcp (CONVENTIONS §3).
 * WebMCP packages register published tools here as `<packageSlug>/<toolName>`;
 * core modules register plain keys like `exec_command`. execute_action input is
 * `{key, args}` with args as an OBJECT.
 */

export interface Action {
  key: string;
  module: string;
  description: string;
  inputSchema: z.ZodType;
  /** requires_approval semantics arrive with SPEC-C; carried now for registration compat. */
  requiresApproval?: boolean;
  handler: (args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult> | ActionResult;
}

export interface ActionContext {
  source: string; // ?source= tag or "internal"
  strict: boolean; // true for MCP/external callers (gate deny-by-default)
  remoteAddr?: string;
}

export interface ActionResult {
  ok: boolean;
  output: string;
  error?: string;
  meta?: Record<string, unknown>;
}

interface RegistryState {
  actions: Map<string, Action>;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosActionRegistry: RegistryState | undefined;
}

function state(): RegistryState {
  if (!globalThis.__agentosActionRegistry) {
    globalThis.__agentosActionRegistry = { actions: new Map() };
  }
  return globalThis.__agentosActionRegistry;
}

export function registerAction(action: Action): void {
  state().actions.set(action.key, action);
}

export function unregisterAction(key: string): void {
  state().actions.delete(key);
}

export function getAction(key: string): Action | undefined {
  return state().actions.get(key);
}

export function listActions(): Action[] {
  return [...state().actions.values()];
}

/** Keyword scoring over key/module/description. Embedding rerank is a TODO
 *  (needs A-phase embed.ts warm); keyword-only ships first per SPEC F4.1. */
export function searchActions(intent: string, limit = 3): Action[] {
  const terms = intent
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const scored = listActions().map((a) => {
    const hay = `${a.key} ${a.module} ${a.description}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += a.key.toLowerCase().includes(t) ? 3 : 1;
    }
    return { a, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.min(Math.max(limit, 1), 3))
    .map((s) => s.a);
}

/** JSON Schema for a registered action (zod 4 native conversion). */
export function actionJsonSchema(a: Action): Record<string, unknown> {
  try {
    return z.toJSONSchema(a.inputSchema) as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}
