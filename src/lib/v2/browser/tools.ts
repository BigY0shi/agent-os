import { z } from "zod";
import type { Page, Locator } from "playwright";
import { readSettings } from "../../settings";
import {
  getOrLaunchSession,
  closeSession,
  closeAllSessions,
  getLiveSessions,
  isHostAllowed,
  type LaunchCallerInfo,
} from "./manager";
import {
  getConfiguredProfiles,
  getConfiguredSessions,
  getSessionConfig,
  getMaxProfiles,
  getMaxSessions,
  createSessionConfig,
  deleteSessionConfig,
} from "./config";
import { recordToolCall, recordSessionRow, touchSession, auditHealth } from "./audit";
import { checkProfileAccess, getSessionConfig as getSessionCfgForOwner } from "./config";
import { callerRef } from "@/lib/v2/identity/principals";

/**
 * E3.1/E3.2 — the 18 browser tools (verbatim-adapt of AOC browser-tools.ts:
 * handler bodies + JSON schemas kept; resolveLocator ref-over-text kept).
 * Additions per spec: E3.3 allowlist guard in browser_navigate
 * (DOMAIN_BLOCKED), an audit row for EVERY call (E1.4/E4.1c), a
 * browser_sessions history row on create_session, and the capability gate
 * (E3.4: slot disabled ⇒ CAPABILITY_DISABLED).
 *
 * Result contract (§5.1): { ok:true, result } | { ok:false, error:{code,message} }.
 * Tool-level failures (locator miss etc) return ok:false with the message —
 * upstream lesson: never throw away the payload.
 */

export type BrowserToolErrorCode =
  | "TOOL_NOT_FOUND"
  | "SESSION_NOT_CONFIGURED"
  | "DOMAIN_BLOCKED"
  | "TOOL_ERROR"
  | "CAPABILITY_DISABLED"
  // Credential containment: the caller does not own the profile behind this
  // session. Its own code because it is NOT a transient failure - retrying,
  // relaunching, or rephrasing will never help, and a run that hits it should
  // surface the reason to the human rather than flail.
  | "PROFILE_ACCESS_DENIED";

export type BrowserToolResult =
  | { ok: true; result: unknown; auditDegraded?: string }
  | { ok: false; error: { code: BrowserToolErrorCode; message: string }; auditDegraded?: string };

/**
 * A tool call that ran but was not recorded must SAY so, on success AND failure; without this
 * the caller cannot tell a complete audit history from a silently broken one. Success: plain
 * object results keep their fields plus `auditDegraded`; arrays and primitives are wrapped as
 * { value } so they are never spread into numeric keys. Failure: the notice is appended to the
 * error message (what callers already show). Both carry a top-level `auditDegraded`.
 * (Copilot review on PR #18, 2026-10-01: the old inline helper skipped failures, mangled
 * arrays, and was never applied at all.)
 */
export function withAuditWarning(
  r: BrowserToolResult,
  health: { ok: boolean; failures: number; lastError?: string },
): BrowserToolResult {
  if (health.ok) return r;
  const note = `This call ran but the audit trail is not recording (${health.failures} failed write(s); last: ${health.lastError ?? "unknown"}).`;
  if (!r.ok) return { ...r, error: { ...r.error, message: `${r.error.message} [${note}]` }, auditDegraded: note };
  const v = r.result;
  const plain = typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  return { ok: true, result: plain ? { ...(v as Record<string, unknown>), auditDegraded: note } : { value: v, auditDegraded: note }, auditDegraded: note };
}

export interface BrowserToolCallOptions extends LaunchCallerInfo {
  /** In-process trusted callers (e.g. the capability slot after its own gate
   *  check) may skip the redundant settings read. Default false. */
  skipCapabilityCheck?: boolean;
}

export function isBrowserCapabilityEnabled(): boolean {
  return readSettings().capability?.browserEnabled ?? false;
}

// ============ Helpers ============

function resolveLocator(page: Page, element: string, ref?: string): Locator {
  if (ref) return page.locator(ref);
  return page.getByText(element, { exact: false });
}

function fail(code: BrowserToolErrorCode, message: string): BrowserToolResult {
  return { ok: false, error: { code, message } };
}

/**
 * CONVENTIONS §9.5: `browser_evaluate` requires approval for ask-mode agents.
 * Non-ask agents (and non-agent callers) pass straight through. The approval
 * parks on the agent's ACTIVE run via agentsRuntime.requestAgentToolApproval;
 * an agent with no active run is denied (fail closed). Dynamic imports keep
 * the claude-agent-sdk dependency out of this module's static import graph.
 */
async function approveEvaluateForAgent(
  agentId: string,
  params: Record<string, unknown>,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { loadAgent } = await import("../../agentsStore");
    const def = await loadAgent(agentId);
    if (!def) return { allowed: false, reason: `agent "${agentId}" not found` };
    if (def.permissionMode !== "ask") return { allowed: true };
    const { requestAgentToolApproval } = await import("../../agentsRuntime");
    return await requestAgentToolApproval(
      agentId,
      "browser_evaluate",
      params,
      "browser_evaluate from an ask-mode agent (CONVENTIONS §9.5)",
    );
  } catch (err) {
    // Fail CLOSED — an approval seam failure never lets evaluate run unreviewed.
    return { allowed: false, reason: `approval seam failed: ${String((err as Error)?.message || err)}` };
  }
}

// ============ Zod schemas (AOC verbatim, session descriptions kept) ============

const SessionParam = z
  .string()
  .describe(
    "Session name (e.g. create_swiggy_order). Use browser_list_sessions to see available sessions.",
  );

const NavigateSchema = z.object({
  url: z.string().describe("URL to navigate to"),
  session: SessionParam,
  headed: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Launch in headed (visible) mode. Required for sites that block headless browsers (e.g. Swiggy, Amazon).",
    ),
});
const SnapshotSchema = z.object({ session: SessionParam });
const ClickSchema = z.object({
  element: z.string().describe("Element description for text lookup"),
  ref: z.string().optional().describe("CSS/ARIA ref selector (takes priority over element)"),
  session: SessionParam,
});
const FillSchema = z.object({
  element: z.string().describe("Input element description"),
  value: z.string().describe("Value to fill"),
  ref: z.string().optional().describe("CSS/ARIA ref selector"),
  session: SessionParam,
});
const TypeSchema = z.object({
  element: z.string().describe("Element description"),
  text: z.string().describe("Text to type character by character"),
  ref: z.string().optional().describe("CSS/ARIA ref selector"),
  session: SessionParam,
});
const PressKeySchema = z.object({
  key: z.string().describe("Key to press (e.g. Enter, Tab, ArrowDown)"),
  session: SessionParam,
});
const SelectOptionSchema = z.object({
  element: z.string().describe("Select element description"),
  value: z.string().describe("Option value to select"),
  ref: z.string().optional().describe("CSS/ARIA ref selector"),
  session: SessionParam,
});
const ScreenshotSchema = z.object({ session: SessionParam });
const WaitForSchema = z.object({
  state: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .default("load")
    .describe("Load state to wait for"),
  session: SessionParam,
});
const EvaluateSchema = z.object({
  script: z.string().describe("JavaScript expression to evaluate in the page context"),
  session: SessionParam,
});
const GoBackSchema = z.object({ session: SessionParam });
const GoForwardSchema = z.object({ session: SessionParam });
const ScrollSchema = z.object({
  deltaX: z.number().optional().default(0).describe("Horizontal scroll amount in pixels"),
  deltaY: z.number().optional().default(300).describe("Vertical scroll amount in pixels"),
  session: SessionParam,
});
const CloseSessionSchema = z.object({ session: SessionParam });
const CloseAllSchema = z.object({});
const ListSessionsSchema = z.object({});
const CreateSessionSchema = z.object({
  session: z.string().describe("Session name to create (e.g. swiggy_order)"),
  profile: z.string().describe("Profile to bind this session to (e.g. personal, work)"),
});
const DeleteSessionSchema = z.object({
  session: z.string().describe("Session name to delete"),
});

/** Zod schema per tool — reused by the F4 action registration (E3.4). */
export const BROWSER_TOOL_SCHEMAS: Record<string, z.ZodType> = {
  browser_navigate: NavigateSchema,
  browser_snapshot: SnapshotSchema,
  browser_click: ClickSchema,
  browser_fill: FillSchema,
  browser_type: TypeSchema,
  browser_press_key: PressKeySchema,
  browser_select_option: SelectOptionSchema,
  browser_screenshot: ScreenshotSchema,
  browser_wait_for: WaitForSchema,
  browser_evaluate: EvaluateSchema,
  browser_go_back: GoBackSchema,
  browser_go_forward: GoForwardSchema,
  browser_scroll: ScrollSchema,
  browser_close_session: CloseSessionSchema,
  browser_close_all: CloseAllSchema,
  browser_list_sessions: ListSessionsSchema,
  browser_create_session: CreateSessionSchema,
  browser_delete_session: DeleteSessionSchema,
};

// ============ JSON schemas + tool defs (AOC verbatim) ============

const sessionProp = {
  type: "string",
  description:
    "Session name (e.g. create_swiggy_order). Use browser_list_sessions to see configured sessions.",
};

const jsonSchemas: Record<string, Record<string, unknown>> = {
  browser_navigate: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to navigate to" },
      session: sessionProp,
      headed: {
        type: "boolean",
        description:
          "Launch in headed (visible) mode. Required for sites that block headless browsers (e.g. Swiggy, Amazon). Default: false",
      },
    },
    required: ["url", "session"],
  },
  browser_snapshot: { type: "object", properties: { session: sessionProp }, required: ["session"] },
  browser_click: {
    type: "object",
    properties: {
      element: { type: "string", description: "Element text/description for lookup" },
      ref: { type: "string", description: "CSS/ARIA selector (takes priority)" },
      session: sessionProp,
    },
    required: ["element", "session"],
  },
  browser_fill: {
    type: "object",
    properties: {
      element: { type: "string", description: "Input element text/description" },
      value: { type: "string", description: "Value to fill" },
      ref: { type: "string", description: "CSS/ARIA selector (takes priority)" },
      session: sessionProp,
    },
    required: ["element", "value", "session"],
  },
  browser_type: {
    type: "object",
    properties: {
      element: { type: "string", description: "Element text/description" },
      text: { type: "string", description: "Text to type character by character" },
      ref: { type: "string", description: "CSS/ARIA selector (takes priority)" },
      session: sessionProp,
    },
    required: ["element", "text", "session"],
  },
  browser_press_key: {
    type: "object",
    properties: {
      key: { type: "string", description: "Key to press (e.g. Enter, Tab, ArrowDown)" },
      session: sessionProp,
    },
    required: ["key", "session"],
  },
  browser_select_option: {
    type: "object",
    properties: {
      element: { type: "string", description: "Select element text/description" },
      value: { type: "string", description: "Option value to select" },
      ref: { type: "string", description: "CSS/ARIA selector (takes priority)" },
      session: sessionProp,
    },
    required: ["element", "value", "session"],
  },
  browser_screenshot: { type: "object", properties: { session: sessionProp }, required: ["session"] },
  browser_wait_for: {
    type: "object",
    properties: {
      state: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        description: "Load state to wait for (default: load)",
      },
      session: sessionProp,
    },
    required: ["session"],
  },
  browser_evaluate: {
    type: "object",
    properties: {
      script: { type: "string", description: "JavaScript expression to evaluate in page context" },
      session: sessionProp,
    },
    required: ["script", "session"],
  },
  browser_go_back: { type: "object", properties: { session: sessionProp }, required: ["session"] },
  browser_go_forward: { type: "object", properties: { session: sessionProp }, required: ["session"] },
  browser_scroll: {
    type: "object",
    properties: {
      deltaX: { type: "number", description: "Horizontal scroll pixels (default: 0)" },
      deltaY: { type: "number", description: "Vertical scroll pixels (default: 300)" },
      session: sessionProp,
    },
    required: ["session"],
  },
  browser_close_session: {
    type: "object",
    properties: { session: sessionProp },
    required: ["session"],
  },
  browser_close_all: { type: "object", properties: {}, required: [] },
  browser_list_sessions: { type: "object", properties: {}, required: [] },
  browser_create_session: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session name to create (e.g. swiggy_order)" },
      profile: { type: "string", description: "Profile to bind this session to (e.g. personal, work)" },
    },
    required: ["session", "profile"],
  },
  browser_delete_session: {
    type: "object",
    properties: { session: { type: "string", description: "Session name to delete" } },
    required: ["session"],
  },
};

export interface BrowserToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const BROWSER_TOOLS: BrowserToolDef[] = [
  {
    name: "browser_navigate",
    description: "Navigate to a URL in a named browser session.",
    inputSchema: jsonSchemas.browser_navigate,
  },
  {
    name: "browser_snapshot",
    description:
      "Get an ARIA accessibility snapshot of the current page. Use this before interacting with elements to discover refs.",
    inputSchema: jsonSchemas.browser_snapshot,
  },
  {
    name: "browser_click",
    description: "Click an element on the page by text description or ref selector.",
    inputSchema: jsonSchemas.browser_click,
  },
  {
    name: "browser_fill",
    description: "Fill an input field with a value (clears existing content first).",
    inputSchema: jsonSchemas.browser_fill,
  },
  {
    name: "browser_type",
    description: "Type text into an element character by character (simulates real typing).",
    inputSchema: jsonSchemas.browser_type,
  },
  {
    name: "browser_press_key",
    description: "Press a keyboard key (e.g. Enter, Tab, ArrowDown, Escape).",
    inputSchema: jsonSchemas.browser_press_key,
  },
  {
    name: "browser_select_option",
    description: "Select an option from a <select> dropdown element.",
    inputSchema: jsonSchemas.browser_select_option,
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page and return it as base64.",
    inputSchema: jsonSchemas.browser_screenshot,
  },
  {
    name: "browser_wait_for",
    description: "Wait for a page load state (load, domcontentloaded, networkidle).",
    inputSchema: jsonSchemas.browser_wait_for,
  },
  {
    name: "browser_evaluate",
    description: "Evaluate a JavaScript expression in the page context and return the result.",
    inputSchema: jsonSchemas.browser_evaluate,
  },
  {
    name: "browser_go_back",
    description: "Navigate to the previous page in history.",
    inputSchema: jsonSchemas.browser_go_back,
  },
  {
    name: "browser_go_forward",
    description: "Navigate to the next page in history.",
    inputSchema: jsonSchemas.browser_go_forward,
  },
  {
    name: "browser_scroll",
    description: "Scroll the page by the specified pixel amounts.",
    inputSchema: jsonSchemas.browser_scroll,
  },
  {
    name: "browser_close_session",
    description: "Close a running browser session (profile data is preserved on disk).",
    inputSchema: jsonSchemas.browser_close_session,
  },
  {
    name: "browser_close_all",
    description: "Close all running browser sessions.",
    inputSchema: jsonSchemas.browser_close_all,
  },
  {
    name: "browser_list_sessions",
    description: `List all configured sessions with their profiles and live status. Max ${getMaxSessions()} sessions, ${getMaxProfiles()} profiles.`,
    inputSchema: jsonSchemas.browser_list_sessions,
  },
  {
    name: "browser_create_session",
    description:
      "Create a new browser session bound to a profile. Use browser_list_sessions to see available profiles first.",
    inputSchema: jsonSchemas.browser_create_session,
  },
  {
    name: "browser_delete_session",
    description:
      "Delete a browser session from config (closes it if running, profile data preserved).",
    inputSchema: jsonSchemas.browser_delete_session,
  },
];

export const BROWSER_TOOL_NAMES = BROWSER_TOOLS.map((t) => t.name);

export function isBrowserTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BROWSER_TOOL_SCHEMAS, name);
}

// ============ Execution ============

/**
 * Dispatch one browser tool. Every call — success or failure — writes a
 * browser_tool_audit row (args redacted; fill/type values withheld — see
 * audit.ts). Session resolution auto-launches headless (upstream behavior).
 */
export async function executeBrowserTool(
  toolName: string,
  params: Record<string, unknown>,
  opts: BrowserToolCallOptions = {},
): Promise<BrowserToolResult> {
  // Every return path of the body goes through the audit-health check (read AFTER the call,
  // so a write that failed during this very call is reported on it).
  const r = await executeBrowserToolInner(toolName, params, opts);
  return withAuditWarning(r, auditHealth());
}

async function executeBrowserToolInner(
  toolName: string,
  params: Record<string, unknown>,
  opts: BrowserToolCallOptions,
): Promise<BrowserToolResult> {
  const caller = opts.caller ?? "user";
  const sessionForAudit = typeof params?.session === "string" ? (params.session as string) : "*";

  const audit = (ok: boolean, error?: string) =>
    recordToolCall({ sessionName: sessionForAudit, tool: toolName, caller, args: params, ok, error });

  if (!isBrowserTool(toolName)) {
    // Unknown tool: audited too (E1.4 "every tool call recorded").
    audit(false, `unknown tool "${toolName}"`);
    return fail("TOOL_NOT_FOUND", `Unknown browser tool: ${toolName}`);
  }

  // E3.4: slot-disabled ⇒ CAPABILITY_DISABLED (mirrors upstream's
  // 404-not-just-strip: a disabled slot REFUSES, it doesn't pretend the tool
  // doesn't exist at dispatch while still executing it).
  if (!opts.skipCapabilityCheck && !isBrowserCapabilityEnabled()) {
    audit(false, "browser capability disabled");
    return fail(
      "CAPABILITY_DISABLED",
      "The browser capability is disabled. Enable it in Settings → Capabilities (settings.capability.browserEnabled).",
    );
  }

  const launchInfo: LaunchCallerInfo = {
    caller,
    taskId: opts.taskId ?? null,
    agentId: opts.agentId ?? null,
  };

  /** The principal behind this call. No agentId means the human is driving. */
  const principal = callerRef(opts.agentId ?? null);

  /**
   * Credential containment. Checked on the SESSION's profile, so it catches an
   * agent using a session it did not create just as much as one it did.
   *
   * A session with no config is left to the existing not-configured path rather
   * than denied here, so the error the caller sees names the real problem.
   */
  const guardProfile = (sessionName: string): BrowserToolResult | null => {
    const cfg = getSessionCfgForOwner(sessionName);
    if (!cfg) return null;
    const decision = checkProfileAccess(cfg.profile, principal);
    if (decision.allowed) return null;
    audit(false, decision.reason);
    return fail("PROFILE_ACCESS_DENIED", decision.reason ?? "profile access denied");
  };

  const resolve = async (
    sessionName: string,
    headed = false,
  ): Promise<{ page?: Page; error?: BrowserToolResult }> => {
    // Before anything launches: every page-driving tool funnels through here,
    // so this is the one place the boundary has to hold.
    const denied = guardProfile(sessionName);
    if (denied) return { error: denied };
    const { session, error } = await getOrLaunchSession(sessionName, headed, launchInfo);
    if (error || !session) {
      const code: BrowserToolErrorCode = /not configured/i.test(error ?? "")
        ? "SESSION_NOT_CONFIGURED"
        : "TOOL_ERROR";
      return { error: fail(code, error ?? "session unavailable") };
    }
    touchSession(sessionName);
    return { page: session.page };
  };

  try {
    switch (toolName) {
      case "browser_navigate": {
        const p = NavigateSchema.parse(params);

        // E3.3 allowlist guard (primary; the context.route document guard in
        // manager.ts is the defense-in-depth layer).
        const cfg = getSessionConfig(p.session);
        if (cfg?.allowedDomains?.length) {
          let host = "";
          try {
            host = new URL(p.url.includes("://") ? p.url : `https://${p.url}`).hostname;
          } catch {
            audit(false, `unparseable URL "${p.url}"`);
            return fail("TOOL_ERROR", `Could not parse URL "${p.url}"`);
          }
          if (!isHostAllowed(host, cfg.allowedDomains)) {
            const msg = `${host} is not on this session's allowlist (${cfg.allowedDomains.join(", ")}). Edit in Browser settings.`;
            audit(false, `DOMAIN_BLOCKED: ${host}`);
            return fail("DOMAIN_BLOCKED", msg);
          }
        }

        const { page, error } = await resolve(p.session, p.headed);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        const response = await page.goto(p.url);
        audit(true);
        return {
          ok: true,
          result: {
            url: p.url,
            session: p.session,
            status: response?.status(),
            title: await page.title(),
          },
        };
      }

      case "browser_snapshot": {
        const p = SnapshotSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        const snapshot = await page.locator("body").ariaSnapshot();
        audit(true);
        return { ok: true, result: { snapshot } };
      }

      case "browser_click": {
        const p = ClickSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await resolveLocator(page, p.element, p.ref).click();
        audit(true);
        return { ok: true, result: { message: `Clicked "${p.ref ?? p.element}"` } };
      }

      case "browser_fill": {
        const p = FillSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await resolveLocator(page, p.element, p.ref).fill(p.value);
        audit(true);
        return { ok: true, result: { message: `Filled "${p.ref ?? p.element}"` } };
      }

      case "browser_type": {
        const p = TypeSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await resolveLocator(page, p.element, p.ref).pressSequentially(p.text);
        audit(true);
        return { ok: true, result: { message: `Typed into "${p.ref ?? p.element}"` } };
      }

      case "browser_press_key": {
        const p = PressKeySchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await page.keyboard.press(p.key);
        audit(true);
        return { ok: true, result: { message: `Pressed key "${p.key}"` } };
      }

      case "browser_select_option": {
        const p = SelectOptionSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await resolveLocator(page, p.element, p.ref).selectOption(p.value);
        audit(true);
        return { ok: true, result: { message: `Selected "${p.value}" in "${p.ref ?? p.element}"` } };
      }

      case "browser_screenshot": {
        const p = ScreenshotSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        // Viewport-only (upstream behavior — §8 risk 12); audit stores no image bytes.
        const buffer = await page.screenshot();
        audit(true);
        return { ok: true, result: { screenshot: buffer.toString("base64"), mimeType: "image/png" } };
      }

      case "browser_wait_for": {
        const p = WaitForSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await page.waitForLoadState(p.state);
        audit(true);
        return { ok: true, result: { message: `Waited for "${p.state}"` } };
      }

      case "browser_evaluate": {
        // Audited like everything else; the args_preview carries the (capped)
        // script text — Fd3's audit-everything rule for evaluate (E3.4).
        //
        // CONVENTIONS §9.5 (F3.2 wire-in): browser_evaluate from an ASK-mode
        // agent requires human approval — parked on the agent's active run's
        // approval queue; no active run = denied (fail closed). Lazy import
        // keeps the SDK-heavy agentsRuntime out of this module's static graph.
        if (opts.agentId) {
          const gate = await approveEvaluateForAgent(opts.agentId, params);
          if (!gate.allowed) {
            audit(false, `browser_evaluate approval: ${gate.reason}`);
            return fail("TOOL_ERROR", `browser_evaluate requires approval for ask-mode agents (CONVENTIONS §9.5): ${gate.reason}`);
          }
        }
        const p = EvaluateSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        // eslint-disable-next-line no-new-func
        const value = await page.evaluate(new Function(`return (${p.script})`) as () => unknown);
        audit(true);
        return { ok: true, result: { value } };
      }

      case "browser_go_back": {
        const p = GoBackSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await page.goBack();
        audit(true);
        return { ok: true, result: { url: page.url() } };
      }

      case "browser_go_forward": {
        const p = GoForwardSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await page.goForward();
        audit(true);
        return { ok: true, result: { url: page.url() } };
      }

      case "browser_scroll": {
        const p = ScrollSchema.parse(params);
        const { page, error } = await resolve(p.session);
        if (error || !page) {
          audit(false, error && !error.ok ? error.error.message : "no page");
          return error ?? fail("TOOL_ERROR", "no page");
        }
        await page.mouse.wheel(p.deltaX, p.deltaY);
        audit(true);
        return { ok: true, result: { message: `Scrolled (${p.deltaX}, ${p.deltaY})` } };
      }

      case "browser_close_session": {
        const p = CloseSessionSchema.parse(params);
        // Closing someone else's live session is a denial of service against
        // them, not a read - it needs the same ownership check as driving it.
        const closeDenied = guardProfile(p.session);
        if (closeDenied) return closeDenied;
        const r = await closeSession(p.session);
        if (!r.success) {
          audit(false, r.error);
          return fail("TOOL_ERROR", r.error ?? "close failed");
        }
        audit(true);
        return { ok: true, result: { message: `Closed session "${p.session}"` } };
      }

      case "browser_close_all": {
        CloseAllSchema.parse(params);
        // "All" means all of MINE. The unscoped version let any agent shut down
        // every live session on the box, including the human's, with one call
        // and no denial to notice.
        const mine = getConfiguredSessions().filter(
          (sc) => checkProfileAccess(sc.profile, principal).allowed,
        );
        const closed: string[] = [];
        for (const sc of mine) {
          const r = await closeSession(sc.name).catch(() => ({ success: false }));
          if (r && r.success) closed.push(sc.name);
        }
        audit(true);
        return {
          ok: true,
          result: {
            message: closed.length
              ? `Closed ${closed.length} session(s): ${closed.join(", ")}`
              : "No sessions of yours were open",
            closed,
          },
        };
      }

      case "browser_list_sessions": {
        ListSessionsSchema.parse(params);
        // Enumeration is disclosure: an unfiltered list told every agent the
        // names of the human's profiles and sessions, which is the map you
        // would need to go looking for them.
        const configured = getConfiguredSessions().filter(
          (sc) => checkProfileAccess(sc.profile, principal).allowed,
        );
        const visibleProfiles = getConfiguredProfiles().filter(
          (name) => checkProfileAccess(name, principal).allowed,
        );
        const live = getLiveSessions();
        audit(true);
        return {
          ok: true,
          result: {
            profiles: visibleProfiles,
            sessions: configured.map((s) => ({ ...s, live: live.includes(s.name) })),
            maxProfiles: getMaxProfiles(),
            maxSessions: getMaxSessions(),
          },
        };
      }

      case "browser_create_session": {
        const p = CreateSessionSchema.parse(params);
        // The other half of the boundary: creating the binding is how an agent
        // would otherwise hand itself a session on someone else's profile.
        const access = checkProfileAccess(p.profile, principal);
        if (!access.allowed) {
          audit(false, access.reason);
          return fail("PROFILE_ACCESS_DENIED", access.reason ?? "profile access denied");
        }
        const r = createSessionConfig(p.session, p.profile);
        if (!r.success) {
          audit(false, r.error);
          return fail("TOOL_ERROR", r.error ?? "create failed");
        }
        // Upstream-webapp behavior collapsed in-process: a history row on
        // create (idempotency = one row per create call; rows are history,
        // the SingletonLock stays the real exclusivity).
        recordSessionRow({
          sessionName: p.session,
          profileName: p.profile,
          createdBy: caller,
          taskId: opts.taskId ?? null,
          agentId: opts.agentId ?? null,
        });
        audit(true);
        return { ok: true, result: { message: `Session "${p.session}" created (profile: ${p.profile})` } };
      }

      case "browser_delete_session": {
        const p = DeleteSessionSchema.parse(params);
        // Strictly worse than close: this removes the CONFIG, so an unguarded
        // agent could unbind the human's sessions permanently.
        const delDenied = guardProfile(p.session);
        if (delDenied) return delDenied;
        await closeSession(p.session).catch(() => {});
        const r = deleteSessionConfig(p.session);
        if (!r.success) {
          audit(false, r.error);
          return fail("TOOL_ERROR", r.error ?? "delete failed");
        }
        audit(true);
        return { ok: true, result: { message: `Session "${p.session}" deleted` } };
      }

      default:
        audit(false, `unhandled tool "${toolName}"`);
        return fail("TOOL_NOT_FOUND", `Unknown browser tool: ${toolName}`);
    }
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? `Invalid parameters: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    audit(false, message);
    return fail("TOOL_ERROR", message);
  }
}
