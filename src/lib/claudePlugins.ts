// S15: Claude Code plugins as the Control Room shows them. Source of truth is the
// owner's Claude Code user settings (`enabledPlugins` in ~/.claude/settings.json;
// CLAUDE_SETTINGS_PATH redirects it for smokes). Plugins are global to Claude Code:
// there is no per-module plugin switch, and the UI says so.
//
// A toggle copies the current file into ~/.claude/.exile/<timestamp>/settings.json
// first (the owner's rule: nothing overwritten without a copy), changes exactly one
// key, writes atomically, and reads it back.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeSettingsPath(): string {
  return process.env.CLAUDE_SETTINGS_PATH || path.join(os.homedir(), ".claude", "settings.json");
}

export interface ClaudePlugin { id: string; name: string; marketplace: string; enabled: boolean }

export class PluginError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function readJson(): Record<string, unknown> {
  const p = claudeSettingsPath();
  if (!existsSync(p)) throw new PluginError(`Claude Code settings not found at ${p}`, 404);
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; }
  catch (e) { throw new PluginError(`Claude Code settings are not valid JSON (${(e as Error).message}); not touching them`, 500); }
}

export function listClaudePlugins(): ClaudePlugin[] {
  const ep = (readJson().enabledPlugins ?? {}) as Record<string, unknown>;
  return Object.entries(ep)
    .map(([id, v]) => {
      const [name, marketplace = ""] = id.split("@");
      return { id, name, marketplace, enabled: v === true || (Array.isArray(v) && v.length > 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setClaudePlugin(id: string, enabled: boolean): { plugin: ClaudePlugin; backup: string } {
  if (typeof id !== "string" || !/^[\w.-]+@[\w.-]+$/.test(id)) throw new PluginError("plugin id must look like name@marketplace");
  if (typeof enabled !== "boolean") throw new PluginError("enabled must be true or false");
  const p = claudeSettingsPath();
  const json = readJson();
  const ep = (json.enabledPlugins ?? {}) as Record<string, unknown>;
  if (!(id in ep)) throw new PluginError(`${id} is not in Claude Code's plugin list`, 404);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const exileDir = path.join(path.dirname(p), ".exile", stamp);
  mkdirSync(exileDir, { recursive: true });
  const backup = path.join(exileDir, "settings.json");
  copyFileSync(p, backup);
  ep[id] = enabled;
  json.enabledPlugins = ep;
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(json, null, 2) + "\n", "utf8");
  renameSync(tmp, p);
  const after = listClaudePlugins().find((x) => x.id === id);
  if (!after || after.enabled !== enabled) throw new PluginError("the change did not land; the backup is at " + backup, 500);
  return { plugin: after, backup };
}
