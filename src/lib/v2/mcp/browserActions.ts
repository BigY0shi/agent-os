import { registerAction, unregisterAction, getAction } from "./registry";
import {
  BROWSER_TOOLS,
  BROWSER_TOOL_SCHEMAS,
  executeBrowserTool,
  isBrowserCapabilityEnabled,
} from "../browser/tools";

/**
 * E3.4 — the 18 browser tools on the F4 action registry (discoverable via
 * get_actions, executable via execute_action on /api/mcp with ?source=
 * tagging — the mcp.execute audit emit in server.ts covers them like every
 * other action, and executeBrowserTool ADDITIONALLY writes the
 * browser_tool_audit row).
 *
 * Registration is SYNCED to settings.capability.browserEnabled on every call
 * (settings change at request time): disabled ⇒ the actions are ABSENT from
 * the registry/manifest, and the handler double-checks so a stale
 * registration still refuses with CAPABILITY_DISABLED.
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosBrowserActionsRegistered: boolean | undefined;
}

export function ensureBrowserActions(): void {
  const enabled = isBrowserCapabilityEnabled();
  const registered = globalThis.__agentosBrowserActionsRegistered ?? false;

  if (enabled && !registered) {
    for (const tool of BROWSER_TOOLS) {
      registerAction({
        key: tool.name,
        module: "browser",
        description: tool.description,
        inputSchema: BROWSER_TOOL_SCHEMAS[tool.name],
        handler: async (args, ctx) => {
          // Defense in depth: settings may have flipped since registration.
          if (!isBrowserCapabilityEnabled()) {
            return {
              ok: false,
              output: "",
              error:
                "CAPABILITY_DISABLED: the browser capability is off. Enable it in Settings → Capabilities.",
            };
          }
          const caller = ctx.source === "internal" ? "user" : `mcp:${ctx.source}`;
          const res = await executeBrowserTool(tool.name, args, {
            caller,
            skipCapabilityCheck: true,
          });
          if (res.ok) {
            return { ok: true, output: JSON.stringify(res.result), meta: { tool: tool.name } };
          }
          return {
            ok: false,
            output: "",
            error: `${res.error.code}: ${res.error.message}`,
            meta: { code: res.error.code },
          };
        },
      });
    }
    globalThis.__agentosBrowserActionsRegistered = true;
  } else if (!enabled && registered) {
    for (const tool of BROWSER_TOOLS) {
      if (getAction(tool.name)?.module === "browser") unregisterAction(tool.name);
    }
    globalThis.__agentosBrowserActionsRegistered = false;
  }
}
