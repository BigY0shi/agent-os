import type { SlotManifestEntry } from "./types";
import { readSettings } from "../../settings";

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
      description: "Playwright browser sessions (workstream E — not yet implemented).",
      actions: [],
    },
  ];
}
