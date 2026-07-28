import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Business Audit Engine bridge. The engine is STANDALONE at AUDIT_ENGINE_DIR — Agent OS
// starts it and watches it, but never owns audit state (feat-004 contract). Everything
// here shells out to `node cli.mjs ...`, which already emits JSON; no engine file is ever
// written from this side. Job bookkeeping lives on globalThis (memory), not on disk.
export const ENGINE_DIR =
  process.env.AUDIT_ENGINE_DIR || "C:\\Users\\Yoshi\\Documents\\BusinessAuditEngine";
export const ENGINE_CLI = path.join(ENGINE_DIR, "cli.mjs");

export const engineAvailable = () => existsSync(ENGINE_CLI);

/** Last JSON object in a CLI's stdout (progress lines go to stderr, but be forgiving). */
function lastJson(stdout: string): unknown {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

/** Quick, synchronous-ish engine queries (list/status finish in well under a second). */
export function engineQuery(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [ENGINE_CLI, ...args], { cwd: ENGINE_DIR, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const parsed = lastJson(String(stdout));
        // The CLI exits 1 with valid JSON for e.g. an invalid brief — that is an answer, not a failure.
        if (parsed) resolve(parsed);
        else reject(err ?? new Error("engine returned no JSON"));
      });
  });
}

/**
 * Engine query that feeds the CLI on stdin — used by `intake <slug> --set`, which is the
 * surface that lets this side edit a brief WITHOUT ever writing engine files itself.
 */
export function engineQueryStdin(args: string[], input: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENGINE_CLI, ...args], { cwd: ENGINE_DIR });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => reject(e));
    child.on("close", () => {
      const parsed = lastJson(stdout);
      if (parsed) resolve(parsed);
      else reject(new Error(stderr.trim() || "engine returned no JSON"));
    });
    child.stdin.on("error", () => {});
    child.stdin.write(input);
    child.stdin.end();
  });
}

export type AuditAction = "run" | "distill" | "warroom";
type JobStage = "idle" | "running" | "done" | "failed";

export interface AuditJob {
  stage: JobStage;
  action: AuditAction | null;
  slug: string | null;
  passes: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  result: unknown;      // the CLI's final JSON
  tail: string[];       // last progress lines so the UI can show a heartbeat
}

// Survives the stateless route handlers and dev hot-reload, same as the scrape job.
const g = globalThis as unknown as { __agentosAudit?: AuditJob };
export const auditJob: AuditJob = (g.__agentosAudit ??= {
  stage: "idle", action: null, slug: null, passes: null,
  startedAt: 0, finishedAt: null, error: null, result: null, tail: [],
});

function note(line: string) {
  const t = line.trim();
  if (!t) return;
  auditJob.tail.push(t);
  if (auditJob.tail.length > 16) auditJob.tail.shift();
}

/**
 * Start a long engine command in the background. POST returns immediately; the client
 * polls. An audit stage runs for minutes (a multi-pass run for tens of minutes) — holding
 * the request open would trip every timeout between the browser and the CLI.
 */
export function startAuditJob(action: AuditAction, slug: string, passes: number | null): { ok: boolean; error?: string } {
  if (auditJob.stage === "running") {
    return { ok: false, error: `A job is already running (${auditJob.action} ${auditJob.slug}).` };
  }
  if (!engineAvailable()) return { ok: false, error: `Audit engine not found at ${ENGINE_CLI}` };

  const args = [ENGINE_CLI, action, slug];
  if (action === "run" && passes) args.push("--passes", String(passes));

  auditJob.stage = "running";
  auditJob.action = action;
  auditJob.slug = slug;
  auditJob.passes = action === "run" ? passes : null;
  auditJob.startedAt = Date.now();
  auditJob.finishedAt = null;
  auditJob.error = null;
  auditJob.result = null;
  auditJob.tail = [];

  const child = spawn(process.execPath, args, { cwd: ENGINE_DIR, env: process.env });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += String(d); });
  // The engine narrates progress on stderr ([pass 2][M1.S1] 1B start) — information, not failure.
  child.stderr.on("data", (d) => String(d).split("\n").forEach(note));
  child.on("error", (e) => {
    auditJob.stage = "failed";
    auditJob.error = `could not start: ${e}`;
    auditJob.finishedAt = Date.now();
  });
  child.on("close", (code) => {
    auditJob.result = lastJson(stdout);
    if (code === 0) auditJob.stage = "done";
    else {
      auditJob.stage = "failed";
      // Never let a CLI failure look like an empty response (standing rule).
      auditJob.error = auditJob.error ?? `engine exited with code ${code}: ${auditJob.tail.slice(-3).join(" | ") || "no output"}`;
    }
    auditJob.finishedAt = Date.now();
  });

  return { ok: true };
}
