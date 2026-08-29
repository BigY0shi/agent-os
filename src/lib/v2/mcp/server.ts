import { z } from "zod";
import { ensureCoreActions } from "./actions";
import {
  getAction,
  searchActions,
  listActions,
  actionJsonSchema,
  type ActionContext,
} from "./registry";
import { emit } from "../events";
import { redactArgs } from "../redact";
import { ensureTaskActions } from "./taskActions";
import {
  callMemoryTool,
  ensureMemoryActions,
  isMemoryTool,
  memoryToolDefs,
} from "../memory/mcpTools";
import {
  callIntegrationMetaTool,
  ensureIntegrationMetaActions,
  isIntegrationMetaTool,
  integrationMetaTools,
} from "../integrations/metaTools";

/**
 * F4 stateless MCP server (Streamable HTTP, JSON responses). Framework-free:
 * takes a parsed JSON-RPC message + context, returns the response body (or
 * null for notifications). The Next route is a thin adapter; smoke tests call
 * handleMcpMessage directly.
 *
 * Stateless mode is spec-legal for Streamable HTTP: every POST gets a single
 * application/json response; GET (server-push SSE) is 405 until a consumer
 * needs it (SPEC-A open question, deliberately deferred).
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "agentos", version: "2.0.0" };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse = Record<string, unknown>;

function rpcResult(id: number | string | null | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: number | string | null | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function text(s: string): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return { content: [{ type: "text", text: s }] };
}

function errText(s: string): { content: { type: "text"; text: string }[]; isError: boolean } {
  return { content: [{ type: "text", text: s }], isError: true };
}

/** MCP tool defs exposed at the top level. Memory tools (A7) come from
 *  memory/mcpTools.ts with their REF-verbatim descriptions; the integration
 *  meta-tools (SPEC-D G4.1/G4.2) from integrations/metaTools.ts with their
 *  AOC-verbatim descriptions. */
function toolDefs() {
  return [
    {
      name: "get_actions",
      description:
        "Discover Agent OS actions matching an intent. Describe what you want to do (e.g. 'run a shell command', 'read a file') and get back 1-3 action schemas to pass to execute_action.",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string", description: "What you want to accomplish" },
          limit: { type: "number", minimum: 1, maximum: 3 },
        },
        required: ["intent"],
      },
    },
    {
      name: "execute_action",
      description:
        "Execute a registered Agent OS action by key with an args object. Discover keys and schemas via get_actions first.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Action key from get_actions" },
          args: { type: "object", description: "Arguments matching the action's inputSchema" },
        },
        required: ["key"],
      },
    },
    ...memoryToolDefs(),
    ...integrationMetaTools(),
  ];
}

export async function handleMcpMessage(
  msg: JsonRpcMessage,
  ctx: ActionContext,
): Promise<JsonRpcResponse | null> {
  ensureCoreActions();
  ensureMemoryActions();
  ensureTaskActions();
  ensureIntegrationMetaActions();

  // Notifications (no id) are accepted and produce no body.
  if (msg.method?.startsWith("notifications/")) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = String(
        (msg.params?.protocolVersion as string | undefined) ?? PROTOCOL_VERSIONS[0],
      );
      const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "ping":
      return rpcResult(msg.id, {});

    case "tools/list":
      return rpcResult(msg.id, { tools: toolDefs() });

    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      switch (name) {
        case "get_actions": {
          const intent = String(args.intent ?? "");
          if (!intent) return rpcResult(msg.id, errText("intent is required"));
          const hits = searchActions(intent, Number(args.limit ?? 3));
          if (hits.length === 0) {
            const all = listActions().map((a) => a.key).join(", ");
            return rpcResult(msg.id, text(`No actions matched. Registered actions: ${all}`));
          }
          return rpcResult(
            msg.id,
            text(
              JSON.stringify(
                hits.map((a) => ({
                  key: a.key,
                  module: a.module,
                  description: a.description,
                  inputSchema: actionJsonSchema(a),
                })),
                null,
                2,
              ),
            ),
          );
        }

        case "execute_action": {
          const key = String(args.key ?? "");
          const action = getAction(key);
          if (!action) return rpcResult(msg.id, errText(`Unknown action key '${key}'. Use get_actions to discover keys.`));
          const rawArgs = (args.args ?? {}) as Record<string, unknown>;
          const parsed = (action.inputSchema as z.ZodType).safeParse(rawArgs);
          if (!parsed.success) {
            return rpcResult(msg.id, errText(`Invalid args for '${key}': ${parsed.error.message}`));
          }
          // CONVENTIONS §9.1: every external execute_action is audited.
          // Args are logged REDACTED via the shared redactArgs (CONVENTIONS §9.3).
          emit(
            "mcp.execute",
            {
              key,
              source: ctx.source,
              remoteAddr: ctx.remoteAddr ?? null,
              strict: ctx.strict,
              args: redactArgs(parsed.data),
            },
            "mcp",
          );
          try {
            const result = await action.handler(parsed.data as Record<string, unknown>, ctx);
            if (!result.ok) return rpcResult(msg.id, errText(result.error ?? "action failed"));
            return rpcResult(
              msg.id,
              text(result.output + (result.meta ? `\n\n[meta] ${JSON.stringify(result.meta)}` : "")),
            );
          } catch (err) {
            return rpcResult(msg.id, errText(`Action '${key}' threw: ${String(err)}`));
          }
        }

        default: {
          if (isIntegrationMetaTool(name)) {
            // Same audit contract as execute_action (CONVENTIONS §9.1/§9.3).
            // ctx.strict stays true through /api/mcp — destructive-annotated
            // integration tools HARD REFUSE on this path (G4.1 semantics).
            emit(
              "mcp.execute",
              {
                key: name,
                source: ctx.source,
                remoteAddr: ctx.remoteAddr ?? null,
                strict: ctx.strict,
                args: redactArgs(args),
              },
              "mcp",
            );
            return rpcResult(msg.id, await callIntegrationMetaTool(name, args, ctx));
          }
          if (isMemoryTool(name)) {
            // Same audit contract as execute_action (CONVENTIONS §9.1/§9.3).
            emit(
              "mcp.execute",
              {
                key: name,
                source: ctx.source,
                remoteAddr: ctx.remoteAddr ?? null,
                strict: ctx.strict,
                args: redactArgs(args),
              },
              "mcp",
            );
            return rpcResult(msg.id, await callMemoryTool(name, args, ctx));
          }
          return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
        }
      }
    }

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
