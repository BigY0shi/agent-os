import { z } from "zod";
import { uuid as newUuid } from "../ids";
import { registerAction, type ActionContext, type ActionResult } from "../mcp/registry";
import { addToQueue } from "./queue";
import { getPersonaDocument } from "./persona";
import { listLabels } from "./labels";
import { searchV2 } from "./search/index";
import type { RecallResult } from "./types";

/**
 * A7.1 — memory MCP tools. Tool DESCRIPTIONS are ported VERBATIM from
 * REF apps/webapp/app/utils/mcp/memory.ts (battle-tested prompt material —
 * do not "improve" them). Input schemas follow SPEC-A §5.1: memory_search
 * gains labelIds/endUserIds/structured, memory_ingest gains referenceTime,
 * memory_about_user and initialize_conversation_session take {}.
 *
 * The tools exist in two places by design (SPEC A7.1):
 *  1. First-class MCP tools on mcp/server.ts (toolDefs + tools/call) via
 *     memoryToolDefs() + callMemoryTool().
 *  2. Registry actions (F4 get_actions/execute_action discovery) via
 *     ensureMemoryActions().
 * Both wrap the same core handlers below. `?source=` from the MCP route
 * arrives as ctx.source and is stamped onto every ingest as `mcp:<source>`.
 */

// ---------------------------------------------------------------------------
// Descriptions — VERBATIM from REF apps/webapp/app/utils/mcp/memory.ts
// ---------------------------------------------------------------------------

const MEMORY_INGEST_DESCRIPTION =
  "Store conversation in memory for future reference. USE THIS TOOL: At the END of every conversation after fully answering the user. WHAT TO STORE: 1) User's question or request, 2) Your solution or explanation, 3) Important decisions made, 4) Key insights discovered. HOW TO USE: Put the entire conversation summary in the 'message' field. IMPORTANT: You MUST provide a sessionId - if you don't have one, call initialize_conversation_session tool FIRST to obtain it at the start of the conversation, then use that SAME sessionId for all memory_ingest calls. Optionally add labelIds array to organize by topic. Returns: Success confirmation with storage ID.";

const MEMORY_SEARCH_DESCRIPTION =
  "Intelligent memory search agent that analyzes user intent and performs multiple parallel searches when needed to gather comprehensive context. USE THIS TOOL: When you need deep contextual understanding that might require multiple search angles, or when the query is complex and multifaceted. The agent will automatically decompose your intent into optimal search queries, execute them in parallel, and synthesize the results. BENEFITS: Handles complex multi-faceted queries, automatically determines best query patterns (entity-centric, temporal, relationship-based, semantic). HOW TO USE: Provide a natural language description of what context you need. Examples: 'What do we know about the authentication implementation and related bugs?', 'Recent work on MCP integrations and configuration', 'User preferences for code style and project setup'. Returns: Synthesized response with relevant context from multiple search angles.";

const GET_LABELS_DESCRIPTION =
  "List all workspace labels. USE THIS TOOL: To discover available labels and get their IDs for filtering memories. Labels organize episodes and conversations by topic or project. Returns: Array of labels with id, name, description, and color.";

const MEMORY_ABOUT_USER_DESCRIPTION =
  "Get user's profile information (background, preferences, work, interests). USE THIS TOOL: At the start of conversations to understand who you're helping. This provides context about the user's technical preferences, work style, and personal details. Returns: User profile summary as text.";

const INITIALIZE_SESSION_DESCRIPTION =
  "Initialize a session for this conversation. MUST be called FIRST at the start of every conversation before any memory_ingest calls. This generates a unique UUID that tracks the entire conversation session. IMPORTANT: One conversation = one session. Call this tool once at the beginning, store the returned sessionId, and use that SAME sessionId for ALL memory_ingest operations throughout this conversation. DO NOT create custom session IDs. Returns: A UUID string to use as sessionId for all subsequent memory operations.";

// Property descriptions verbatim from REF IngestSchema / memory_search schema.
const MESSAGE_PROP_DESCRIPTION =
  "The conversation text to store. Include both what the user asked and what you answered. Keep it concise but complete.";
const SESSION_ID_PROP_DESCRIPTION =
  "IMPORTANT: Session ID (UUID) is required to track the conversation session. If you don't have a sessionId in your context, you MUST call the initialize_conversation_session tool first to obtain one before calling memory_ingest.";
const LABEL_IDS_PROP_DESCRIPTION =
  "Optional: Array of label UUIDs (from get_labels). Add this to organize the memory by topic or project. Example: If discussing 'core' project, include the 'core' label ID. Leave empty to store without specific labels.";
const INTENT_PROP_DESCRIPTION =
  "Natural language description of what memory context you need. Be specific about what you're looking for. The agent will decompose this into multiple optimal searches.";

const NO_PERSONA_MESSAGE =
  "No persona document exists yet. The persona is generated automatically once identity/preference/directive facts have been ingested into memory — ingest some conversations first (memory_ingest), or trigger a full generation from the Memory page.";

export const MEMORY_TOOL_NAMES = [
  "memory_search",
  "memory_ingest",
  "memory_about_user",
  "get_labels",
  "initialize_conversation_session",
] as const;

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

export function isMemoryTool(name: string): name is MemoryToolName {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// First-class MCP tool definitions (JSON Schema, mcp/server.ts toolDefs)
// ---------------------------------------------------------------------------

export function memoryToolDefs() {
  return [
    {
      name: "memory_ingest",
      description: MEMORY_INGEST_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: MESSAGE_PROP_DESCRIPTION },
          sessionId: { type: "string", description: SESSION_ID_PROP_DESCRIPTION },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: LABEL_IDS_PROP_DESCRIPTION,
          },
          referenceTime: {
            type: "string",
            description:
              "Optional: ISO-8601 timestamp the content refers to (defaults to now). Use when storing information about a past or future point in time.",
          },
        },
        required: ["message", "sessionId"],
      },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    },
    {
      name: "memory_search",
      description: MEMORY_SEARCH_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string", description: INTENT_PROP_DESCRIPTION },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional: restrict the search to these label UUIDs (from get_labels).",
          },
          endUserIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional: restrict the search to memories scoped to these counterparty (end-user) ids.",
          },
          structured: {
            type: "boolean",
            description:
              "Optional: true returns the structured RecallResult JSON instead of markdown.",
          },
        },
        required: ["intent"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    {
      name: "get_labels",
      description: GET_LABELS_DESCRIPTION,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    {
      name: "memory_about_user",
      description: MEMORY_ABOUT_USER_DESCRIPTION,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    {
      name: "initialize_conversation_session",
      description: INITIALIZE_SESSION_DESCRIPTION,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    },
  ];
}

// ---------------------------------------------------------------------------
// Core handlers (shared by first-class tools and registry actions)
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map(String).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/** memory_ingest core: enqueue with source stamped `mcp:<ctx.source>`. */
export function memoryIngestTool(
  args: Record<string, unknown>,
  ctx: ActionContext,
): { queueId: string } {
  const message = typeof args.message === "string" ? args.message : "";
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
  if (!message.trim()) throw new Error("message is required");
  if (!sessionId.trim()) {
    throw new Error(
      "sessionId is required — call initialize_conversation_session first and reuse its sessionId",
    );
  }
  return addToQueue({
    episodeBody: message,
    sessionId,
    source: `mcp:${ctx.source || "unknown"}`,
    labelIds: asStringArray(args.labelIds),
    referenceTime:
      typeof args.referenceTime === "string" && args.referenceTime ? args.referenceTime : undefined,
  });
}

/** memory_search core: searchV2 → markdown (or RecallResult when structured). */
export async function memorySearchTool(
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string | RecallResult> {
  const intent = typeof args.intent === "string" ? args.intent : "";
  if (!intent.trim()) throw new Error("intent is required");
  return searchV2(intent, {
    labelIds: asStringArray(args.labelIds),
    endUserIds: asStringArray(args.endUserIds),
    structured: args.structured === true,
    source: `mcp:${ctx.source || "unknown"}`,
  });
}

/** memory_about_user core: persona document markdown or a clear absence message. */
export function memoryAboutUserTool(): string {
  const doc = getPersonaDocument();
  return doc?.content || NO_PERSONA_MESSAGE;
}

/** get_labels core: {id, name, description, color}[] (SPEC §5.1 shape). */
export function getLabelsTool(): { id: string; name: string; description: string | null; color: string }[] {
  return listLabels().map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    color: l.color,
  }));
}

/** initialize_conversation_session core: one conversation = one session. */
export function initializeConversationSessionTool(): { sessionId: string } {
  return { sessionId: newUuid() };
}

// ---------------------------------------------------------------------------
// First-class tools/call dispatcher (mcp/server.ts)
// ---------------------------------------------------------------------------

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const ok = (text: string): ToolContent => ({ content: [{ type: "text", text }] });
const err = (text: string): ToolContent => ({
  content: [{ type: "text", text }],
  isError: true,
});

export async function callMemoryTool(
  name: MemoryToolName,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<ToolContent> {
  try {
    switch (name) {
      case "memory_ingest": {
        const { queueId } = memoryIngestTool(args, ctx);
        return ok(JSON.stringify({ queueId }));
      }
      case "memory_search": {
        const result = await memorySearchTool(args, ctx);
        return ok(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      }
      case "memory_about_user":
        return ok(memoryAboutUserTool());
      case "get_labels":
        return ok(JSON.stringify(getLabelsTool(), null, 2));
      case "initialize_conversation_session":
        return ok(JSON.stringify(initializeConversationSessionTool()));
      default:
        return err(`Unknown memory tool: ${String(name)}`);
    }
  } catch (e) {
    return err(
      `Error calling memory tool ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// F4 registry actions (get_actions / execute_action discovery path)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __agentosMemoryActions: boolean | undefined;
}

function toActionResult(promise: Promise<ToolContent> | ToolContent): Promise<ActionResult> | ActionResult {
  const map = (r: ToolContent): ActionResult =>
    r.isError
      ? { ok: false, output: "", error: r.content[0]?.text ?? "memory tool failed" }
      : { ok: true, output: r.content[0]?.text ?? "" };
  return promise instanceof Promise ? promise.then(map) : map(promise);
}

/** Register the memory tools on the F4 action registry. Idempotent. */
export function ensureMemoryActions(): void {
  if (globalThis.__agentosMemoryActions) return;
  globalThis.__agentosMemoryActions = true;

  registerAction({
    key: "memory_ingest",
    module: "memory",
    description: MEMORY_INGEST_DESCRIPTION,
    inputSchema: z.object({
      message: z.string().min(1).describe(MESSAGE_PROP_DESCRIPTION),
      sessionId: z.string().min(1).describe(SESSION_ID_PROP_DESCRIPTION),
      labelIds: z.array(z.string()).optional().describe(LABEL_IDS_PROP_DESCRIPTION),
      referenceTime: z.string().optional(),
    }),
    handler: (args, ctx) => toActionResult(callMemoryTool("memory_ingest", args, ctx)),
  });

  registerAction({
    key: "memory_search",
    module: "memory",
    description: MEMORY_SEARCH_DESCRIPTION,
    inputSchema: z.object({
      intent: z.string().min(1).describe(INTENT_PROP_DESCRIPTION),
      labelIds: z.array(z.string()).optional(),
      endUserIds: z.array(z.string()).optional(),
      structured: z.boolean().optional(),
    }),
    handler: (args, ctx) => toActionResult(callMemoryTool("memory_search", args, ctx)),
  });

  registerAction({
    key: "memory_about_user",
    module: "memory",
    description: MEMORY_ABOUT_USER_DESCRIPTION,
    inputSchema: z.object({}),
    handler: (args, ctx) => toActionResult(callMemoryTool("memory_about_user", args, ctx)),
  });

  registerAction({
    key: "get_labels",
    module: "memory",
    description: GET_LABELS_DESCRIPTION,
    inputSchema: z.object({}),
    handler: (args, ctx) => toActionResult(callMemoryTool("get_labels", args, ctx)),
  });

  registerAction({
    key: "initialize_conversation_session",
    module: "memory",
    description: INITIALIZE_SESSION_DESCRIPTION,
    inputSchema: z.object({}),
    handler: (args, ctx) =>
      toActionResult(callMemoryTool("initialize_conversation_session", args, ctx)),
  });
}
