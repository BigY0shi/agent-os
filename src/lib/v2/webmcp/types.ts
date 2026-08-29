import { z } from "zod";

/**
 * SPEC-C D1.1 — WebMCP contract types, ported from the upstream reference
 * (AgentOSCore packages/types/src/integration.ts + oauth/params.ts), TUI/widget
 * variants dropped per the port map. These shapes are the wire contract for
 * D5 exports: the generated index.mjs implements run(IntegrationEventPayload)
 * and the IntegrationCLI subcommand surface (NDJSON Message lines to stdout).
 *
 * Client-safe: no node imports (SpecForm.tsx consumes WebmcpSpec + the schema).
 */

// ---------------------------------------------------------------------------
// Upstream event/message contract (verbatim-adapt)
// ---------------------------------------------------------------------------

export enum IntegrationEventType {
  /** Processes authentication data and returns tokens/credentials to be saved */
  SETUP = "setup",
  /** Processing incoming data from the integration */
  PROCESS = "process",
  /** Identifying which account a webhook belongs to */
  IDENTIFY = "identify",
  /** Scheduled synchronization of data */
  SYNC = "sync",
  /** For returning integration metadata/config */
  SPEC = "spec",
  /** Get available MCP tools for this integration */
  GET_TOOLS = "get-tools",
  /** Call a specific MCP tool */
  CALL_TOOL = "call-tool",
}

export type MessageType =
  | "spec"
  | "activity"
  | "state"
  | "identifier"
  | "account"
  | "tools"
  | "tool_result"
  | "error";

export interface Message {
  type: MessageType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/** Runtime config handed to an exported package (--config JSON): key → value. */
export interface IntegrationConfig {
  [key: string]: string;
}

export interface IntegrationEventPayload {
  event: IntegrationEventType;
  /** Event body based on the event (CALL_TOOL: { name, arguments }). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBody: any;
  /** For everything other than setup. */
  config?: IntegrationConfig;
  /** For sync command. */
  state?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [x: string]: any;
}

// ---------------------------------------------------------------------------
// Upstream auth param shapes (oauth/params.ts, classes → interfaces)
// ---------------------------------------------------------------------------

export interface OAuth2Params {
  authorization_url: string;
  authorization_params?: Record<string, string>;
  default_scopes?: string[];
  scope_separator?: string;
  scope_identifier?: string;
  token_url: string;
  token_params?: Record<string, string>;
  redirect_uri_metadata?: string[];
  token_response_metadata?: string[];
  /** In seconds. */
  token_expiration_buffer?: number;
  scopes?: string[];
  token_request_auth_method?: string;
}

export interface AuthParam {
  name: string;
  label: string;
  placeholder: string;
  description: string;
}

export interface APIKeyParams {
  fields: AuthParam[];
}

export interface McpAuthParams {
  server_url: string;
}

export type AuthType = "OAuth2" | "api_key" | "mcp";

/** Upstream integration Spec (widgets/toolUI dropped — TUI surface not ported). */
export interface IntegrationSpec {
  name: string;
  key: string;
  description: string;
  icon: string;
  category?: string;
  schedule?: { frequency?: string };
  auth?: {
    OAuth2?: OAuth2Params;
    api_key?: APIKeyParams;
    mcp?: McpAuthParams;
  };
}

// ---------------------------------------------------------------------------
// Our spec_json shape (webmcp_packages.spec_json, migration 032) + zod gate
// ---------------------------------------------------------------------------

export const SPEC_AUTH_KINDS = ["none", "api_key", "oauth2", "mcp"] as const;
export type SpecAuthKind = (typeof SPEC_AUTH_KINDS)[number];

export const SPEC_MCP_TYPES = ["stdio", "http"] as const;
export type SpecMcpType = (typeof SPEC_MCP_TYPES)[number];

/**
 * One `${config:NAME}` field the exported package expects at runtime
 * (client-onboarding mode, D5). Names share the secret-name grammar so a
 * `{{secret:NAME}}` reference maps 1:1 onto `${config:NAME}`.
 */
export interface SpecConfigField {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * The Spec-shaped metadata stored as JSON in webmcp_packages.spec_json.
 * Kept deliberately lean: name/key/description/icon live on the package row
 * itself — spec_json carries only what the row doesn't.
 */
export interface WebmcpSpec {
  /** How a deployed copy of this package authenticates. Default 'none'. */
  authKind?: SpecAuthKind;
  /** Cron frequency for SYNC-style scheduling (metadata only for now). */
  schedule?: { frequency?: string };
  /** Transport surface the export is meant to be mounted on. Default 'stdio'. */
  mcpType?: SpecMcpType;
  /** Declared `${config:*}` fields for client-mode exports (D5). */
  configManifest?: SpecConfigField[];
}

export const CONFIG_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const SpecConfigFieldSchema = z.strictObject({
  name: z
    .string()
    .regex(CONFIG_NAME_RE, "config field name must match [A-Za-z_][A-Za-z0-9_]*"),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
});

/**
 * The PATCH gate: spec_json must parse AND match this schema exactly —
 * unknown keys or wrong types are a loud 400 (strictObject all the way down).
 */
export const WebmcpSpecSchema = z.strictObject({
  authKind: z.enum(SPEC_AUTH_KINDS).optional(),
  schedule: z.strictObject({ frequency: z.string().max(120).optional() }).optional(),
  mcpType: z.enum(SPEC_MCP_TYPES).optional(),
  configManifest: z.array(SpecConfigFieldSchema).max(50).optional(),
});
