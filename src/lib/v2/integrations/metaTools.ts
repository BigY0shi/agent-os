import { z } from "zod";
import {
  registerAction,
  getAction,
  type ActionContext,
  type ActionResult,
} from "../mcp/registry";
import {
  IntegrationError,
  getAccount,
  listActiveAccounts,
} from "./store";
import { getConnector } from "./registry";
import { getTools, callTool } from "./runtime";
import { selectActionNames, type SelectionCandidate } from "../webmcp/actionSelection";
import { createApproval, REGISTRY_SLUG } from "../webmcp/approvals";
import type { ApprovalRequiredInfo } from "../webmcp/execute";
import { ConnectorConfigError, type ConnectorTool } from "./types";

/**
 * SPEC-D G4.1 — the three integration meta-tools (§5.6), descriptions ported
 * VERBATIM from AOC apps/webapp/app/utils/mcp/memory.ts (they encode the
 * accountId-not-slug contract agents rely on; the one adaptation: upstream's
 * "hasMcp" return field became "toolCount" — custom remote MCPs are wave 2).
 *
 * LLM's ONLY role here is schema selection (§8 risk 11): get_integration_actions
 * filters tool schemas through the ONE Phase-4 selector
 * (webmcp/actionSelection.selectActionNames — the ported ACTION_SELECTION
 * prompt; no second selection prompt exists). It never constructs or executes
 * calls, and nothing in this module ever feeds activity text to a model.
 *
 * Failure split for the selector (chunk-4 contract):
 *   - provider/LLM-call failure  → LOUD (IntegrationError 502; never a silent
 *     all-tools fallback that hides a dead provider);
 *   - JSON-parse/validation failure or zero-valid-names → ALL tools + loud
 *     console.warn (never silently narrow);
 *   - settings.webmcp.llmGetActions=false → keyword-scorer fallback (hub
 *     precedent), zero hits → ALL tools + loud log.
 *
 * requires-approval semantics for execute_integration_action (conditional —
 * depends on the TARGET tool's destructiveHint annotation, so it cannot be a
 * static `requiresApproval` registry flag):
 *   - strict (non-interactive / /api/mcp) caller + destructive target → HARD
 *     REFUSE, no record;
 *   - interactive (strict=false) caller + destructive target → Phase-4
 *     Human-Gate pending record (slug 'registry', tool
 *     'execute_integration_action') + approval-required result carrying
 *     meta.approval — approve re-enters this handler as source 'human-gate';
 *   - source 'human-gate' is the approved bypass: it is set ONLY by
 *     approvals.resolveApproval's registry lane (strict callers refuse BEFORE
 *     the bypass check, so ?source=human-gate on /api/mcp cannot spoof it).
 *
 * §9.4 recall taint: these actions execute through the brain's execute_action
 * gate (jarvis/tools.ts gateTaint) — a tainted session refuses BEFORE any
 * handler here runs, so integration writes are covered by the existing gate.
 */

// ─── AOC-verbatim descriptions (utils/mcp/memory.ts) ─────────────────────────

const GET_INTEGRATIONS_DESCRIPTION =
  "List all connected integrations (GitHub, Linear, Slack, etc.). USE THIS TOOL: Before using integration actions to see what's available. WORKFLOW: 1) Call this to see available integrations, 2) Call get_integration_actions with a slug to see what you can do, 3) Call execute_integration_action to do it. Returns: Array with slug, name, accountId, and toolCount for each integration.";

const ACCOUNT_ID_PROP_DESCRIPTION =
  "Account ID (UUID) from the `id` field returned by get_integrations. This identifies the specific integration account to use. Do NOT pass the integration slug ('github', 'gmail', 'slack') — pass the UUID.";

const GET_INTEGRATION_ACTIONS_DESCRIPTION =
  "Get ONLY the most relevant action names for a specific integration account based on user's intent. USE THIS TOOL: Before execute_integration_action to discover which actions can fulfill the user's request. The LLM intelligently filters available actions to return ONLY the most relevant ones (typically 1-3 actions), preventing context bloat. For example: query='get latest issues' returns ['get_issues'], NOT ['get_issues', 'get_issue', 'get_comments']. HOW TO USE: Provide accountId (from get_integrations) and a clear query describing what you want to accomplish. Returns: Array of 1-3 relevant action names (strings only, not full schemas). Use these action names with execute_integration_action.";

const QUERY_PROP_DESCRIPTION =
  "Clear description of what you want to accomplish. Examples: 'get the latest issues', 'create a new pull request', 'send a message to #general'. Be specific - the LLM uses this to filter down to 1-3 most relevant actions.";

const EXECUTE_INTEGRATION_ACTION_DESCRIPTION =
  "Execute an action on an integration account (fetch GitHub PR, create Linear issue, send Slack message, etc.). USE THIS TOOL: After using get_integration_actions to see available actions. HOW TO USE: 1) Set accountId (from get_integrations) to specify which account to use, 2) Set action name (like 'get_pr'), 3) Set parameters object with required parameters from the action's inputSchema. Returns: Result of the action execution.";

const ACTION_PROP_DESCRIPTION =
  "Action name from get_integration_actions. Examples: 'get_pr', 'get_issues', 'create_issue'";

const PARAMETERS_PROP_DESCRIPTION =
  "Parameters for the action. Check the action's inputSchema from get_integration_actions to see what's required.";

// ─── Core: get_integrations ──────────────────────────────────────────────────

/** Upstream integration-operations.ts formatted-text shape (+ Tools count line). */
export function getIntegrationsText(): string {
  const accounts = listActiveAccounts();
  if (accounts.length === 0) return "No integrations connected.";
  const lines = accounts.map((a, index) => {
    const spec = getConnector(a.definitionSlug)?.spec;
    let toolCount = 0;
    try {
      toolCount = getTools(a.definitionSlug).length;
    } catch {
      /* connector missing → 0 (row survives a removed connector) */
    }
    const name = spec?.name ?? a.definitionSlug;
    const display = a.displayName && a.displayName !== name ? `${name} — ${a.displayName}` : name;
    return (
      `${index + 1}. ${display}\n` +
      `   accountId: ${a.id}\n` +
      `   User identifier: ${a.accountId}\n` +
      `   Slug: ${a.definitionSlug}\n` +
      `   Tools: ${toolCount}`
    );
  });
  return `Connected Integrations (${accounts.length}):\n\n` + lines.join("\n\n");
}

// ─── Core: get_integration_actions ───────────────────────────────────────────

const MAX_SELECTED = 3;

/** modelCall's structured-output parse failures (memory/llm.ts parseStructured). */
function isParseFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no JSON found|failed schema validation/i.test(msg);
}

/** Hub-precedent keyword scorer — the settings-off fallback (NOT a second LLM prompt). */
function keywordFilter(tools: ConnectorTool[], query: string): ConnectorTool[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const scored = tools
    .map((t) => {
      const hay = `${t.name} ${t.description}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += t.name.toLowerCase().includes(term) ? 3 : 1;
      }
      return { t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    console.warn(
      `[integrations/metaTools] keyword fallback matched nothing for '${query.slice(0, 120)}' — returning ALL tools`,
    );
    return tools;
  }
  return scored.slice(0, MAX_SELECTED).map((s) => s.t);
}

function requireActiveAccount(accountId: string) {
  const account = getAccount(accountId);
  if (!account) {
    throw new IntegrationError(
      `integration account '${accountId}' not found — pass the accountId UUID from get_integrations, not the slug`,
      404,
    );
  }
  if (!account.isActive) {
    throw new IntegrationError(`integration account '${accountId}' is disconnected`, 409);
  }
  return account;
}

/**
 * LLM-filtered ≤3 tool schemas as JSON text (§5.6). Provider errors throw
 * LOUD; parse failures fall back to ALL tools with a console.warn; empty
 * selection returns an explicit "no matching actions" text, never a silent [].
 */
export async function getIntegrationActionsText(accountId: string, query: string): Promise<string> {
  const account = requireActiveAccount(accountId);
  const tools = getTools(account.definitionSlug);
  if (tools.length === 0) {
    return `No matching actions — the '${account.definitionSlug}' integration advertises no tools.`;
  }

  const candidates: SelectionCandidate[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    scope: account.definitionSlug,
  }));

  const outcome = await selectActionNames(query, candidates);

  let selected: ConnectorTool[];
  if (outcome.mode === "selected") {
    const byName = new Map(tools.map((t) => [t.name, t]));
    selected = outcome.names
      .map((n) => byName.get(n))
      .filter((t): t is ConnectorTool => Boolean(t))
      .slice(0, MAX_SELECTED); // LLM order kept (dependency chains), §5.6 cap
  } else if (outcome.mode === "off") {
    selected = keywordFilter(tools, query);
  } else {
    // mode 'all' — distinguish provider failure (LOUD) from parse failure
    // (all-tools fallback + loud warn). Zero-valid-names counts as a parse-
    // grade failure (the model answered, just not usably).
    if (outcome.cause === "llm-error" && !isParseFailure(outcome.error)) {
      const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      throw new IntegrationError(`action-selection provider call failed: ${msg}`, 502);
    }
    console.warn(
      `[integrations/metaTools] action selection for '${query.slice(0, 120)}' failed to parse — returning ALL ${tools.length} tools`,
    );
    selected = tools;
  }

  if (selected.length === 0) {
    return `No matching actions for '${query}' on the '${account.definitionSlug}' integration.`;
  }
  return JSON.stringify(selected);
}

// ─── Core: execute_integration_action ────────────────────────────────────────

export async function executeIntegrationActionMeta(
  accountId: string,
  action: string,
  parameters: Record<string, unknown>,
  ctx: ActionContext,
): Promise<ActionResult> {
  let account;
  try {
    account = requireActiveAccount(accountId);
  } catch (err) {
    return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
  }

  let destructive = false;
  try {
    const tool = getTools(account.definitionSlug).find((t) => t.name === action);
    destructive = tool?.annotations?.destructiveHint === true;
  } catch {
    /* unknown-tool handling happens at callTool (loud, audited) */
  }

  if (destructive) {
    if (ctx.strict) {
      // Non-interactive / MCP callers: HARD REFUSE, no approval record.
      return {
        ok: false,
        output: "",
        error:
          `'${action}' is a destructive-annotated integration tool and requires human approval — ` +
          "refused for non-interactive/MCP callers",
      };
    }
    if (ctx.source !== "human-gate") {
      // Interactive → Phase-4 Human-Gate: pending record + approval-required
      // result (same pattern as webmcp requires_approval tools). Approve
      // re-enters this handler via resolveApproval's registry lane (source
      // 'human-gate', strict:false — the ONLY producer of that source).
      const a = createApproval({
        slug: REGISTRY_SLUG,
        tool: "execute_integration_action",
        args: { accountId, action, parameters },
        requestedBy: ctx.source,
        conversationId: ctx.conversationId ?? null,
      });
      const approval: ApprovalRequiredInfo = {
        id: a.id,
        slug: a.slug,
        tool: a.tool,
        redactedArgs: a.redactedArgs,
        expiresAt: a.expiresAt,
      };
      return {
        ok: false,
        output: "",
        error:
          `'${action}' is destructive and requires human approval — an approval request (${a.id}) ` +
          `has been shown to the user (expires ${a.expiresAt}). Tell them what it will do and ask ` +
          "them to Approve or Deny it. Do NOT retry the tool.",
        meta: { approval },
      };
    }
    // source 'human-gate' + strict:false → the human approved this exact call.
  }

  try {
    // §5.6: the action name is passed VERBATIM (decision 2) to the same
    // runtime path the /call route uses — call log row + source tag included.
    const result = await callTool(accountId, action, parameters, { source: ctx.source });
    return result.isError
      ? { ok: false, output: "", error: result.text }
      : { ok: true, output: result.text };
  } catch (err) {
    // ConnectorConfigError (unknown tool / config problem) and IntegrationError
    // are LOUD at the runtime; as a registry action they surface as ok:false
    // with the loud message (the attempt is already call-logged).
    const msg = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof ConnectorConfigError && /unknown tool/i.test(msg)
        ? " — action names are the advertised tool names from get_integration_actions, passed verbatim"
        : "";
    return { ok: false, output: "", error: `${msg}${hint}` };
  }
}

// ─── F4 registry registration (G4.2 — taskActions.ts idiom) ──────────────────

declare global {
  // eslint-disable-next-line no-var
  var __agentosIntegrationMetaActions: boolean | undefined;
}

export function ensureIntegrationMetaActions(): void {
  if (globalThis.__agentosIntegrationMetaActions) return;
  globalThis.__agentosIntegrationMetaActions = true;

  // Name-collision guard: these keys were checked against brain built-ins
  // (memory_search/memory_ingest/get_actions/execute_action/navigate), the
  // memory registry actions, and every existing registry key — but a webmcp
  // package registered later could still collide, so refuse to clobber.
  for (const key of INTEGRATION_META_TOOL_NAMES) {
    if (getAction(key)) {
      console.error(
        `[integrations/metaTools] registry key '${key}' is already taken — integration meta-action NOT registered`,
      );
      globalThis.__agentosIntegrationMetaActions = false;
      return;
    }
  }

  registerAction({
    key: "get_integrations",
    module: "integrations",
    description: GET_INTEGRATIONS_DESCRIPTION,
    inputSchema: z.object({}),
    handler: () => {
      try {
        return { ok: true, output: getIntegrationsText() };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerAction({
    key: "get_integration_actions",
    module: "integrations",
    description: GET_INTEGRATION_ACTIONS_DESCRIPTION,
    inputSchema: z.object({
      accountId: z.string().min(1).describe(ACCOUNT_ID_PROP_DESCRIPTION),
      query: z.string().min(1).describe(QUERY_PROP_DESCRIPTION),
    }),
    handler: async (args) => {
      try {
        return {
          ok: true,
          output: await getIntegrationActionsText(String(args.accountId), String(args.query)),
        };
      } catch (err) {
        // Includes the LOUD provider-failure path (IntegrationError 502).
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerAction({
    key: "execute_integration_action",
    module: "integrations",
    description: EXECUTE_INTEGRATION_ACTION_DESCRIPTION,
    // requiresApproval is deliberately NOT set: approval is CONDITIONAL on the
    // target tool's destructiveHint — enforced inside the handler (see header).
    inputSchema: z.object({
      accountId: z.string().min(1).describe(ACCOUNT_ID_PROP_DESCRIPTION),
      action: z.string().min(1).describe(ACTION_PROP_DESCRIPTION),
      parameters: z.looseObject({}).optional().describe(PARAMETERS_PROP_DESCRIPTION),
    }),
    handler: (args, ctx) =>
      executeIntegrationActionMeta(
        String(args.accountId),
        String(args.action),
        (args.parameters && typeof args.parameters === "object"
          ? args.parameters
          : {}) as Record<string, unknown>,
        ctx,
      ),
  });
}

// ─── /api/mcp top-level surface (G4.2 — memory/mcpTools.ts pattern) ──────────

export const INTEGRATION_META_TOOL_NAMES = [
  "get_integrations",
  "get_integration_actions",
  "execute_integration_action",
] as const;

export type IntegrationMetaToolName = (typeof INTEGRATION_META_TOOL_NAMES)[number];

export function isIntegrationMetaTool(name: string): name is IntegrationMetaToolName {
  return (INTEGRATION_META_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * §5.6 F4 export: the three meta-tools as flat MCP tool defs (AOC-verbatim
 * descriptions + JSON schemas + annotations). mcp/server.ts spreads these into
 * tools/list and dispatches tools/call through callIntegrationMetaTool.
 */
export function integrationMetaTools() {
  return [
    {
      name: "get_integrations",
      description: GET_INTEGRATIONS_DESCRIPTION,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    {
      name: "get_integration_actions",
      description: GET_INTEGRATION_ACTIONS_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: ACCOUNT_ID_PROP_DESCRIPTION },
          query: { type: "string", description: QUERY_PROP_DESCRIPTION },
        },
        required: ["accountId", "query"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    {
      name: "execute_integration_action",
      description: EXECUTE_INTEGRATION_ACTION_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: ACCOUNT_ID_PROP_DESCRIPTION },
          action: { type: "string", description: ACTION_PROP_DESCRIPTION },
          parameters: { type: "object", description: PARAMETERS_PROP_DESCRIPTION },
        },
        required: ["accountId", "action"],
      },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    },
  ];
}

interface McpToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const mcpText = (text: string, isError = false): McpToolContent => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

/** tools/call dispatcher for the three meta-tools (callMemoryTool pattern). */
export async function callIntegrationMetaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<McpToolContent> {
  try {
    switch (name) {
      case "get_integrations":
        return mcpText(getIntegrationsText());
      case "get_integration_actions": {
        const accountId = String(args.accountId ?? "");
        const query = String(args.query ?? "");
        if (!accountId) return mcpText("accountId is required", true);
        if (!query) return mcpText("query is required", true);
        return mcpText(await getIntegrationActionsText(accountId, query));
      }
      case "execute_integration_action": {
        const accountId = String(args.accountId ?? "");
        const action = String(args.action ?? "");
        if (!accountId) return mcpText("accountId is required", true);
        if (!action) return mcpText("action is required", true);
        const parameters = (
          args.parameters && typeof args.parameters === "object" && !Array.isArray(args.parameters)
            ? args.parameters
            : {}
        ) as Record<string, unknown>;
        const result = await executeIntegrationActionMeta(accountId, action, parameters, ctx);
        return result.ok ? mcpText(result.output) : mcpText(result.error ?? "action failed", true);
      }
      default:
        throw new Error(`Unknown integration meta-tool: ${name}`);
    }
  } catch (err) {
    return mcpText(
      `Error calling integration tool: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}
