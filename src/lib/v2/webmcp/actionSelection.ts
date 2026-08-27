import { z } from "zod";
import { readSettings } from "../../settings";

/**
 * SPEC-C D1.5 — LLM-filtered action selection. The system prompt is the
 * upstream INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT
 * (AgentOSCore apps/webapp/app/utils/mcp/prompts.ts), verbatim-adapted:
 * "integration action" → "tool" naming; contract otherwise unchanged
 * (exact-name anti-hallucination, dependency ordering, JSON array output).
 *
 * Contract (SPEC-C D1.5 + chunk brief):
 *  - provider-routed via memory/llm.ts modelCall (low tier), temp 0.3;
 *  - JSON-parse failure or LLM error → caller returns ALL tools + LOUD
 *    console.error (never silently narrow);
 *  - settings.webmcp.llmGetActions (default ON) gates the whole path — off
 *    → callers use their keyword-scorer fallback;
 *  - AGENTOS_MOCK_LLM=1 swaps a deterministic mock (engine.ts precedent;
 *    llm.ts untouched) + setActionSelectLlmForTests seam.
 */

export const ACTION_SELECTION_SYSTEM_PROMPT = `You are an AI assistant that helps select relevant tools based on user queries.

Given a user's query and a list of available tools, analyze the query and return ONLY the tool names that directly fulfill the user's intent.

CRITICAL RULES - STRICTLY ENFORCE:
1. ONLY return tools that EXIST in the available tools list
2. NEVER hallucinate or invent tool names
3. NEVER return tools that are not explicitly provided in the available tools list
4. Tool names must EXACTLY match the names in the available tools (case-sensitive)

DEPENDENCY HANDLING:
5. ALWAYS include prerequisite tools when a tool requires parameters from another tool
6. Check tool input schemas - if a tool requires parameters that must be fetched from another tool, include both tools
7. Return dependencies in the correct execution order (dependency first, then dependent tool)

Dependency Examples:
- A mail "list_emails" tool requiring "accountId" parameter → Must return ["get_accounts", "list_emails"]
- Any tool requiring "accountId" when the user doesn't provide it → Include "get_accounts" first
- Any tool requiring "folderId" when the user doesn't specify → Include "get_folders" first

SELECTION GUIDELINES:
8. Be VERY selective - only return tools that directly accomplish the stated goal
9. For list/fetch queries (e.g., "get latest issues"), return ONLY plural list tools (e.g., "get_issues"), NOT singular item tools (e.g., "get_issue")
10. For specific item queries (e.g., "get issue #123"), return ONLY singular item tools (e.g., "get_issue")
11. Do NOT include unrelated tools (e.g., don't include "get_comments" just because the query mentions "issues")
12. Prefer the most direct tool that accomplishes the goal

Examples:

SIMPLE QUERIES (No Dependencies):
- Query: "get the latest issues" → ["get_issues"]
  ✗ WRONG: ["get_issues", "get_issue", "get_comments"]
- Query: "create a new issue" → ["create_issue"]
  ✗ WRONG: ["create_issue", "get_issues"]
- Query: "get details of PR #42" → ["get_pr"]
  ✗ WRONG: ["get_pr", "get_prs"]
- Query: "list all pull requests" → ["get_prs"]
  ✗ WRONG: ["get_prs", "get_pr"]

DEPENDENCY QUERIES:
- Query: "show my emails" → ["get_accounts", "list_emails"]
  ✓ Correct: get_accounts provides accountId required by list_emails
  ✗ WRONG: ["list_emails"] (missing accountId dependency)
- Query: "delete this email" → ["get_accounts", "list_emails", "delete_email"]
  ✓ Correct: get_accounts → accountId, list_emails → messageId, delete_email uses both
  ✗ WRONG: ["delete_email"] (missing both dependencies)

HALLUCINATION PREVENTION:
- Query: "fetch my tasks"
  ✓ If "get_tasks" exists: ["get_tasks"]
  ✗ WRONG: ["fetch_tasks"] (tool name doesn't exist)
  ✗ WRONG: ["get_my_tasks"] (tool name doesn't exist)

VALIDATION CHECKLIST BEFORE RETURNING:
✓ Every tool name exists in the available tools list?
✓ All required dependencies included?
✓ Dependencies in correct execution order?
✓ No hallucinated or invented tool names?
✓ Tool names exactly match available tools?

Return your response as a JSON array of tool name strings. For example: ["create_issue"] or ["get_accounts", "list_emails"]`;

export interface SelectionCandidate {
  name: string;
  description: string;
  /** JSON Schema of the tool's input (dependency-detection signal for the LLM). */
  inputSchema?: unknown;
  /** Optional owning package/module tag rendered into the prompt. */
  scope?: string;
}

export function buildActionSelectionPrompt(query: string, candidates: SelectionCandidate[]): string {
  const rendered = candidates.map((c) => ({
    name: c.name,
    description: c.description,
    ...(c.scope ? { package: c.scope } : {}),
    ...(c.inputSchema !== undefined ? { inputSchema: c.inputSchema } : {}),
  }));
  return `User Query: "${query}"

Available Tools:
${JSON.stringify(rendered, null, 2)}

Return ONLY the relevant tool names as a JSON array of strings.`;
}

// ---------------------------------------------------------------------------
// LLM seam (injectable; AGENTOS_MOCK_LLM=1 → deterministic mock)
// ---------------------------------------------------------------------------

export type ActionSelectLlm = (query: string, candidates: SelectionCandidate[]) => Promise<string[]>;

const SelectionSchema = z.array(z.string());

const realSelect: ActionSelectLlm = async (query, candidates) => {
  // Lazy import: keeps this module importable in client-adjacent contexts and
  // avoids paying the llm.ts settings read on plain enumeration paths.
  const { modelCall } = await import("../memory/llm");
  return modelCall(
    [
      { role: "system", content: ACTION_SELECTION_SYSTEM_PROMPT },
      { role: "user", content: buildActionSelectionPrompt(query, candidates) },
    ],
    "low",
    { schema: SelectionSchema, temperature: 0.3, timeoutMs: 45_000 },
  );
};

/**
 * Deterministic mock (AGENTOS_MOCK_LLM=1): a candidate is selected when EVERY
 * word of its name (split on [_./-], trailing 's' tolerated both ways) appears
 * in the query. Query containing 'MOCK_SELECT_FAIL' throws (parse-fail leg).
 */
const mockSelect: ActionSelectLlm = async (query, candidates) => {
  if (query.includes("MOCK_SELECT_FAIL")) {
    throw new Error("no JSON found in model output (AGENTOS_MOCK_LLM forced failure)");
  }
  const q = query.toLowerCase();
  const hasWord = (w: string) => {
    const base = w.replace(/s$/, "");
    return q.includes(w) || q.includes(base) || (base && q.includes(base + "s"));
  };
  return candidates
    .filter((c) => {
      const words = c.name.toLowerCase().split(/[_./-]+/).filter(Boolean);
      return words.length > 0 && words.every(hasWord);
    })
    .map((c) => c.name);
};

let overrideSelect: ActionSelectLlm | null = null;

/** Test seam (null restores default resolution). */
export function setActionSelectLlmForTests(fn: ActionSelectLlm | null): void {
  overrideSelect = fn;
}

function selectLlm(): ActionSelectLlm {
  if (overrideSelect) return overrideSelect;
  return process.env.AGENTOS_MOCK_LLM ? mockSelect : realSelect;
}

// ---------------------------------------------------------------------------
// The one shared selector (hub.getActions + the brain's get_actions both use it)
// ---------------------------------------------------------------------------

export type SelectionOutcome =
  | { mode: "selected"; names: string[] }
  /** LLM/parse failure or nothing-valid — caller must return ALL tools (never narrow). */
  | { mode: "all" }
  /** settings.webmcp.llmGetActions is off — caller uses its keyword-scorer fallback. */
  | { mode: "off" };

export function llmGetActionsEnabled(): boolean {
  return readSettings().webmcp?.llmGetActions !== false;
}

/**
 * Select 1–3 (typically) relevant tool names for a query. Anti-hallucination:
 * returned names are filtered to the candidate set, LLM order preserved.
 */
export async function selectActionNames(
  query: string,
  candidates: SelectionCandidate[],
): Promise<SelectionOutcome> {
  if (!llmGetActionsEnabled()) return { mode: "off" };
  if (candidates.length === 0) return { mode: "selected", names: [] };
  try {
    const raw = await selectLlm()(query, candidates);
    const valid = new Set(candidates.map((c) => c.name));
    const names: string[] = [];
    for (const n of raw) {
      if (valid.has(n) && !names.includes(n)) names.push(n);
    }
    if (names.length === 0) {
      console.error(
        `[webmcp/actionSelection] LLM selection for '${query.slice(0, 120)}' returned no valid tool names ` +
          `(raw: ${JSON.stringify(raw).slice(0, 300)}) — returning ALL tools`,
      );
      return { mode: "all" };
    }
    return { mode: "selected", names };
  } catch (err) {
    console.error(
      `[webmcp/actionSelection] LLM selection FAILED for '${query.slice(0, 120)}' — returning ALL tools:`,
      err instanceof Error ? err.message : err,
    );
    return { mode: "all" };
  }
}
