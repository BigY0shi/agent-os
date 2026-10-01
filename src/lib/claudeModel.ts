// The Claude chat model, as a setting (S30 settings sweep; owner 2026-09-30: "every
// parameter needs to be in the settings for every module").
//
// Until v2.55 this was `CLAUDE_MODEL` in lib/config.ts: read once at server start from
// AGENTIC_OS_CLAUDE_MODEL, else `claudeModel` in ~/.agentic-os/config.json, else
// claude-opus-4-8, and imported by 25 files. Now it is settings.claude.model, picked on the
// Claude page's gear and read PER REQUEST, so a change applies to the next call with no
// rebuild and no restart. The two older overrides still win when present (back-compat for an
// install that set them); the gear says so. The default is unchanged.
//
// Server-only (reads settings). The client-safe list of pickable models is CLAUDE_MODELS in
// lib/ultracodeModels.ts (the same four as Ultracode, plus whatever custom id the owner types).

import { CLAUDE_MODEL_OVERRIDE, CLAUDE_MODEL_OVERRIDE_SOURCE } from "./config";
import { readSettings } from "./settings";
import { isUltracodeModel } from "./ultracodeModels";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";

/** The model every non-Ultracode `claude -p --model` call uses right now. */
export function claudeModel(): string {
  if (CLAUDE_MODEL_OVERRIDE) return CLAUDE_MODEL_OVERRIDE;
  const m = readSettings().claude?.model;
  return typeof m === "string" && m.trim() ? m.trim() : DEFAULT_CLAUDE_MODEL;
}

/** Where the current value comes from, for the gear's note. */
export function claudeModelSource(): "env" | "config.json" | "settings" | "default" {
  if (CLAUDE_MODEL_OVERRIDE_SOURCE) return CLAUDE_MODEL_OVERRIDE_SOURCE;
  const m = readSettings().claude?.model;
  return typeof m === "string" && m.trim() ? "settings" : "default";
}

/** A model id or alias the claude CLI could accept; rejects anything that could smuggle a flag. */
export const isClaudeModelId = isUltracodeModel;
