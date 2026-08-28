import type { SlotManifestEntry } from "./types";
import { readSettings } from "../../settings";
import { BROWSER_TOOL_NAMES } from "../browser/tools";

export function getManifest(): SlotManifestEntry[] {
  const browserEnabled = readSettings().capability?.browserEnabled ?? false;
  return [
    {
      key: "exec",
      enabled: true,
      description:
        "Run shell commands on the host, validated against built-in + user deny lists and Bash(<glob>) allow patterns.",
      actions: ["exec_command"],
    },
    {
      key: "coding",
      enabled: true,
      description:
        "One-shot coding-agent completions (cliComplete) rooted in a scoped folder. Streaming sessions arrive with workstream B/E.",
      actions: ["coding_ask"],
    },
    {
      key: "files",
      enabled: true,
      description:
        "Read/write/glob/grep scoped to registered folders. Writes exile the previous copy first — never destructive.",
      actions: ["read_file", "write_file", "list_files", "grep_files"],
    },
    {
      key: "browser",
      enabled: browserEnabled,
      description:
        "Playwright-driven browser sessions on isolated profiles (~/.agentic-os/browser-profiles — never Opera). 18 browser_* tools with per-session domain allowlists; every call audited.",
      // E3.4: slot-disabled ⇒ tools ABSENT from the manifest (and dispatch
      // returns CAPABILITY_DISABLED — mirror upstream 404-not-just-strip).
      actions: browserEnabled ? [...BROWSER_TOOL_NAMES] : [],
    },
  ];
}
