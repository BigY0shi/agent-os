// OpenMontage module (S9, Artist's Corner): the resolved, non-secret config.
//
// OpenMontage (calesthio/OpenMontage, AGPLv3) is an agent-orchestrated video
// production system. Its docs/ARCHITECTURE.md is explicit: "There is no runtime
// Python orchestrator; the agent IS the control plane." So a "pipeline run" here
// is the owner's CLI agent (claude by default) driving the checkout, and Python
// is only for the preflight (tool registry) and the dependency check.
//
// Nothing in this module is a secret: paths, a binary name, an agent id. The
// owner's OpenMontage .env (ElevenLabs, fal.ai, ...) stays in the checkout and
// is never read here.
import os from "node:os";
import path from "node:path";
import { readSettings } from "@/lib/settings";

export interface OpenMontageConfig {
  repoPath: string;
  pythonBin: string;
  outputDir: string;
  agent: string;
  fallbackAgent: "codex" | "none";
  timeoutMin: number;
  /** Which values came from the defaults rather than the gear (shown in the UI). */
  defaulted: { repoPath: boolean; outputDir: boolean };
}

export const DEFAULT_REPO_PATH = path.join(os.homedir(), "Documents", "OpenMontage");
export const DEFAULT_PYTHON_BIN = "python";
export const DEFAULT_TIMEOUT_MIN = 90;

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }

/** Resolve the gear's values into absolute paths. Pure: no filesystem access. */
export function resolveOpenMontageConfig(raw?: Record<string, unknown> | null): OpenMontageConfig {
  const s = raw ?? (readSettings().openmontage as Record<string, unknown> | undefined) ?? {};
  const repoPath = path.resolve(str(s.repoPath) || DEFAULT_REPO_PATH);
  const outputRaw = str(s.outputDir);
  const outputDir = outputRaw ? path.resolve(outputRaw) : path.join(repoPath, "projects");
  const agent = str(s.agent) || "claude";
  const fallbackAgent = s.fallbackAgent === "none" ? "none" : "codex";
  const t = Number(s.timeoutMin);
  const timeoutMin = Number.isFinite(t) && t > 0 ? Math.min(t, 24 * 60) : DEFAULT_TIMEOUT_MIN;
  return {
    repoPath,
    pythonBin: str(s.pythonBin) || DEFAULT_PYTHON_BIN,
    outputDir,
    agent,
    fallbackAgent,
    timeoutMin,
    defaulted: { repoPath: !str(s.repoPath), outputDir: !outputRaw },
  };
}

/** The one error shape this module throws: a message AND the fix the owner runs. */
export class OpenMontageError extends Error {
  fix?: string;
  status: number;
  constructor(message: string, opts: { fix?: string; status?: number } = {}) {
    super(message);
    this.name = "OpenMontageError";
    this.fix = opts.fix;
    this.status = opts.status ?? 503;
  }
}
