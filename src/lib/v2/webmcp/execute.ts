import vm from "node:vm";
import { readSettings } from "../../settings";
import { redactArgs } from "../redact";
import { ensureCoreActions } from "../mcp/actions";
import { ensureMemoryActions } from "../memory/mcpTools";
import { ensureTaskActions } from "../mcp/taskActions";
import { getAction } from "../mcp/registry";
import { jsonSchemaToZod } from "./schema";
import { readPackageSecrets } from "./secrets";
import {
  getPackage,
  getPublishedSnapshot,
  getTool,
  listTools,
  writeCallLog,
  type SnapshotTool,
} from "./store";

/**
 * SPEC-C D1.4 — WebMCP tool execution.
 *
 * Lanes (draft-vs-published drift rule §8.10):
 *  - executeTool: runs the PUBLISHED snapshot's tool — never the draft rows.
 *    This is what the hub / F4 registry / Jarvis call.
 *  - executeDraftTool: the Test-tab lane — runs the current DRAFT working set
 *    (works on unpublished packages; bypasses the approval gate since you are
 *    testing your own tool interactively). Logged with source 'test'.
 *
 * Args are validated against the authored JSON Schema via the minimal
 * jsonSchemaToZod converter (schema.ts documents its limitations: top-level
 * object + primitive/enum/array/one-level-nested-object types + required —
 * no format/pattern/bounds/oneOf).
 *
 * EVERY call — success, validation failure, handler error — writes ONE
 * webmcp_call_logs row with redactArgs(args, <resolved secret values>)
 * (CONVENTIONS §9.3): secret-looking keys masked + any value equal to a
 * configured secret masked, then 4KB-capped.
 */

export interface ExecuteCtx {
  source: string;
  /** true when a human is in the loop (Jarvis overlay, in-app UI). */
  interactive?: boolean;
  /** passthrough to internal registry actions (capability deny-by-default gates). */
  strict?: boolean;
  /** Originating jarvis conversation — threaded onto Human-Gate approval records. */
  conversationId?: string | null;
  /** Human-Gate bypass: set ONLY by approvals.resolveApproval (source 'human-gate'). */
  approved?: boolean;
}

/** Route/stream-safe approval summary (redacted args only). */
export interface ApprovalRequiredInfo {
  id: string;
  slug: string;
  tool: string;
  redactedArgs: Record<string, unknown>;
  expiresAt: string;
}

export interface ExecuteResult {
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
  /** js-handler console capture (Test tab surface). */
  logs?: string[];
  /** Human-Gate: set when a pending approval record was created instead of executing. */
  approval?: ApprovalRequiredInfo;
}

const OUTPUT_CAP = 32 * 1024; // truncation discipline (SPEC D1.4)
const HTTP_BODY_CAP = 100 * 1024; // http response body cap
const DEFAULT_JS_TIMEOUT_MS = 5000;
const DEFAULT_HTTP_TIMEOUT_MS = 15000;

function cap(s: string, limit: number): string {
  return s.length > limit ? s.slice(0, limit) + `\n...[truncated at ${limit} bytes]` : s;
}

// ---------------------------------------------------------------------------
// Template substitution ({{secret:NAME}} + {{args.X}} / {{arg:X}})
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{\s*(secret:([A-Za-z_][A-Za-z0-9_]*)|args?[.:]([A-Za-z0-9_]+))\s*\}\}/g;

function substitute(
  template: string,
  args: Record<string, unknown>,
  secrets: Record<string, string>,
): string {
  return template.replace(TEMPLATE_RE, (_m, _g1, secretName?: string, argName?: string) => {
    if (secretName) {
      const v = secrets[secretName];
      if (v === undefined) {
        throw new Error(`secret '${secretName}' is not configured for this package (Settings → secrets)`);
      }
      return v;
    }
    const v = args[argName!];
    return v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  });
}

function substituteDeep(
  value: unknown,
  args: Record<string, unknown>,
  secrets: Record<string, string>,
): unknown {
  if (typeof value === "string") return substitute(value, args, secrets);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, args, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteDeep(v, args, secrets);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Handler dispatch
// ---------------------------------------------------------------------------

async function runInternal(
  tool: SnapshotTool,
  args: Record<string, unknown>,
  ctx: ExecuteCtx,
): Promise<{ output: string; logs?: string[] }> {
  // The registry lives on globalThis and may be empty in a fresh worker —
  // ensure the built-in action sets before resolving the key.
  ensureCoreActions();
  ensureMemoryActions();
  ensureTaskActions();
  const key = String(tool.handlerConfig.actionKey ?? "");
  if (!key) throw new Error("internal handler has no handlerConfig.actionKey");
  const action = getAction(key);
  if (!action) throw new Error(`internal action '${key}' is not registered`);
  const result = await action.handler(args, {
    source: ctx.source,
    strict: ctx.strict ?? false,
  });
  if (!result.ok) throw new Error(result.error ?? `internal action '${key}' failed`);
  return { output: result.output };
}

async function runHttp(
  tool: SnapshotTool,
  args: Record<string, unknown>,
  slug: string,
): Promise<{ output: string }> {
  const cfg = tool.handlerConfig as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    bodyTemplate?: unknown;
    timeoutMs?: number;
  };
  if (typeof cfg.url !== "string" || !cfg.url) throw new Error("http handler has no url");
  const secrets = readPackageSecrets(slug); // resolved SERVER-SIDE; never echoed
  const url = substitute(cfg.url, args, secrets);
  const method = (cfg.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    headers[k] = substitute(String(v), args, secrets);
  }
  let body: string | undefined;
  if (cfg.bodyTemplate !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof cfg.bodyTemplate === "string") {
      body = substitute(cfg.bodyTemplate, args, secrets);
    } else {
      body = JSON.stringify(substituteDeep(cfg.bodyTemplate, args, secrets));
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }
  }
  const timeoutMs = typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_HTTP_TIMEOUT_MS;
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = cap(await res.text(), HTTP_BODY_CAP);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${cap(text, 1024)}`);
  return { output: text };
}

/**
 * 'js' handlers run user-authored code in node:vm with a frozen minimal
 * sandbox (args + console capture; fetch/process/require DISABLED).
 * EXPLICITLY NOT A SECURITY BOUNDARY (SPEC-C §8.8): node:vm provides
 * crash/timeout isolation on a single-user box, nothing more — the code runs
 * with server privileges. settings.webmcp.allowJsHandlers gates creation.
 */
async function runJs(
  tool: SnapshotTool,
  args: Record<string, unknown>,
): Promise<{ output: string; logs: string[] }> {
  const cfg = tool.handlerConfig as { code?: string; timeoutMs?: number };
  if (typeof cfg.code !== "string" || !cfg.code.trim()) throw new Error("js handler has no code");
  const settingsTimeout = readSettings().webmcp?.sandboxTimeoutMs;
  const timeoutMs =
    typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0
      ? cfg.timeoutMs
      : typeof settingsTimeout === "number" && settingsTimeout > 0
        ? settingsTimeout
        : DEFAULT_JS_TIMEOUT_MS;

  const logs: string[] = [];
  const capture = (level: string) => (...parts: unknown[]) => {
    logs.push(
      `[${level}] ` +
        parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "),
    );
  };
  const frozenArgs = Object.freeze(JSON.parse(JSON.stringify(args ?? {})));
  const sandbox = vm.createContext({
    args: frozenArgs,
    console: Object.freeze({ log: capture("log"), warn: capture("warn"), error: capture("error") }),
    fetch: undefined, // network deliberately disabled in the js lane (use the 'http' kind)
  });

  const script = new vm.Script(`(async () => { "use strict";\n${cfg.code}\n})()`, {
    filename: `webmcp:${tool.name}.js`,
  });
  // The vm timeout kills synchronous infinite loops; the race covers async hangs.
  const resultPromise = script.runInContext(sandbox, { timeout: timeoutMs }) as Promise<unknown>;
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve(resultPromise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`js handler timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const output = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return { output, logs };
  } catch (err) {
    if (err instanceof Error && /Script execution timed out/i.test(err.message)) {
      throw new Error(`js handler timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Shared runner (validation → approval gate → dispatch → log)
// ---------------------------------------------------------------------------

async function run(
  slug: string,
  tool: SnapshotTool,
  rawArgs: Record<string, unknown>,
  ctx: ExecuteCtx,
  lane: "published" | "draft",
): Promise<ExecuteResult> {
  const started = Date.now();
  const secretValues = Object.values(readPackageSecrets(slug));
  const log = (ok: boolean, error?: string) =>
    writeCallLog({
      packageSlug: slug,
      toolName: tool.name,
      source: ctx.source,
      redactedArgs: redactArgs(rawArgs, secretValues),
      ok,
      error,
      durationMs: Date.now() - started,
    });

  // Validate args against the authored JSON Schema.
  const parsed = jsonSchemaToZod(tool.inputSchema).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const error = `invalid args for '${slug}/${tool.name}': ${parsed.error.message}`;
    log(false, error);
    return { ok: false, output: "", error, durationMs: Date.now() - started };
  }
  const args = parsed.data as Record<string, unknown>;

  // Approval gate (published lane only — the Test tab is you, testing your own
  // tool). Human-Gate (Phase-4 chunk 2): an INTERACTIVE caller gets a PENDING
  // approval record + an approval-required result naming the id; the user
  // approves/denies via /api/v2/webmcp/approvals. Non-interactive/strict
  // callers keep the HARD REFUSE (no record). resolveApproval re-enters this
  // path with ctx.approved=true (source 'human-gate') to actually execute.
  if (lane === "published" && tool.requiresApproval && !ctx.approved) {
    if (!ctx.interactive || ctx.strict) {
      const error = `'${slug}/${tool.name}' requires human approval and cannot run non-interactively`;
      log(false, error);
      return { ok: false, output: "", error, durationMs: Date.now() - started };
    }
    try {
      const { createApproval } = await import("./approvals"); // lazy: breaks the execute↔approvals cycle
      const approval = createApproval({
        slug,
        tool: tool.name,
        args,
        requestedBy: ctx.source,
        conversationId: ctx.conversationId ?? null,
      });
      const error =
        `'${slug}/${tool.name}' requires human approval — approval request ${approval.id} created ` +
        `and shown to the user (expires ${approval.expiresAt}). Tell the user to approve or deny it; do NOT retry.`;
      log(false, error);
      return {
        ok: false,
        output: "",
        error,
        durationMs: Date.now() - started,
        approval: {
          id: approval.id,
          slug: approval.slug,
          tool: approval.tool,
          redactedArgs: approval.redactedArgs,
          expiresAt: approval.expiresAt,
        },
      };
    } catch (err) {
      // Approval record creation failing must never silently run the tool.
      const error = `'${slug}/${tool.name}' requires human approval — approval record creation failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      log(false, error);
      return { ok: false, output: "", error, durationMs: Date.now() - started };
    }
  }

  try {
    let out: { output: string; logs?: string[] };
    switch (tool.handlerKind) {
      case "internal":
        out = await runInternal(tool, args, ctx);
        break;
      case "http":
        out = await runHttp(tool, args, slug);
        break;
      case "js":
        out = await runJs(tool, args);
        break;
      default:
        throw new Error(`unknown handler kind '${String(tool.handlerKind)}'`);
    }
    log(true);
    return {
      ok: true,
      output: cap(out.output, OUTPUT_CAP),
      durationMs: Date.now() - started,
      logs: out.logs,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(false, error);
    return { ok: false, output: "", error, durationMs: Date.now() - started };
  }
}

/** Hub/registry lane: PUBLISHED snapshot only — never the draft rows. */
export async function executeTool(
  slug: string,
  toolName: string,
  args: Record<string, unknown>,
  ctx: ExecuteCtx,
): Promise<ExecuteResult> {
  const snapshot = getPublishedSnapshot(slug);
  if (!snapshot) {
    return {
      ok: false,
      output: "",
      error: `package '${slug}' has no published version (drafts run only in the Test tab)`,
      durationMs: 0,
    };
  }
  const tool = snapshot.tools.find((t) => t.name === toolName);
  if (!tool) {
    return {
      ok: false,
      output: "",
      error: `tool '${toolName}' is not in the published snapshot of '${slug}' (v${snapshot.package.version})`,
      durationMs: 0,
    };
  }
  return run(slug, tool, args, ctx, "published");
}

/** Test-tab lane: runs the DRAFT working set (webmcp_tools rows). */
export async function executeDraftTool(
  packageIdOrSlug: string,
  toolName: string,
  args: Record<string, unknown>,
  source = "test",
): Promise<ExecuteResult> {
  const pkg = getPackage(packageIdOrSlug);
  if (!pkg) return { ok: false, output: "", error: "package not found", durationMs: 0 };
  const tool = getTool(pkg.id, toolName) ?? listTools(pkg.id).find((t) => t.name === toolName);
  if (!tool) {
    return { ok: false, output: "", error: `tool '${toolName}' not found in draft of '${pkg.slug}'`, durationMs: 0 };
  }
  const draftTool: SnapshotTool = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handlerKind: tool.handlerKind,
    handlerConfig: tool.handlerConfig,
    requiresApproval: tool.requiresApproval,
    position: tool.position,
  };
  return run(pkg.slug, draftTool, args, { source, interactive: true, strict: false }, "draft");
}
