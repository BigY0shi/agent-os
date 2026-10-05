// A pipeline run: the CLI agent driving the OpenMontage checkout as a module
// run (lib/moduleRuns.ts), its output streamed into the runs tray, the rendered
// files listed when it ends.
//
// Why an agent and not `python something`: AGENT_GUIDE.md Rule Zero and
// docs/ARCHITECTURE.md both say the coding agent IS the orchestrator; the
// Python side is tools and checkpoints only. So the honest "run this pipeline
// with this brief" is `claude -p` (or the owner's chosen CLI) started inside
// the checkout with a prompt that names the manifest, the project id and the
// brief, exactly as the owner would type it into Claude Code there.
//
// Fallback (AGENTS.md rule 20): used only when the owner picked one in the gear
// AND only when the primary CLI cannot START (not installed / spawn error).
// A CLI that started and failed is a failed run; a second agent re-driving a
// half-written project would be a mess, not a fallback. The result labels who
// actually ran (`agent`, `fellBackFrom`, `fallbackReason`).
import fs from "node:fs";
import path from "node:path";
import { claudeModel } from "@/lib/claudeModel";
import { startModuleRun, type ModuleRunContext } from "@/lib/moduleRuns";
import { OpenMontageError, type OpenMontageConfig } from "./config";
import { findPipeline, type PipelineDef } from "./pipelines";

export const MODULE = "openmontage" as const;
export const HREF = "/openmontage";

/** What a spawned child must look like; runner.spawnStream returns one. */
export interface ChildLike {
  stdout: { on(ev: "data", cb: (b: Buffer | string) => void): unknown } | null;
  stderr: { on(ev: "data", cb: (b: Buffer | string) => void): unknown } | null;
  on(ev: "close", cb: (code: number | null) => void): unknown;
  on(ev: "error", cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  pid?: number;
}
export type SpawnAgentFn = (agent: string, args: string[], opts: { cwd: string; input: string }) => ChildLike;

export interface RunInput { pipelineId: string; brief: string; projectId?: string }

export interface OutputFile { path: string; rel: string; bytes: number; mtime: number }
export interface RunOutcome {
  projectId: string;
  projectDir: string;
  pipeline: string;
  agent: string;
  fellBackFrom?: string;
  fallbackReason?: string;
  exitCode: number | null;
  stages: string[];
  outputs: OutputFile[];
}

export const RENDER_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".gif", ".mp3", ".wav", ".m4a", ".png", ".jpg", ".jpeg", ".srt", ".vtt"]);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** A project id from the brief plus the date, e.g. "neural-networks-explainer-20261001". */
export function defaultProjectId(brief: string, now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  const base = slugify(brief).split("-").filter(Boolean).slice(0, 4).join("-") || "project";
  return `${base}-${d}`;
}

export function validProjectId(id: string): boolean { return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(id); }

/** The prompt, written the way the owner would type it into Claude Code inside the checkout. */
export function buildPrompt(p: PipelineDef, brief: string, projectId: string, cfg: OpenMontageConfig): string {
  const projectDir = path.join(cfg.outputDir, projectId);
  const outside = path.resolve(cfg.outputDir) !== path.resolve(path.join(cfg.repoPath, "projects"));
  return [
    `You are working inside the OpenMontage checkout at ${cfg.repoPath}. Read AGENT_GUIDE.md first and follow Rule Zero: all production goes through the pipeline system.`,
    ``,
    `Pipeline: ${p.name} (pipeline_defs/${path.basename(p.file)}). Read that manifest, then each stage's director skill before working the stage.`,
    `Project id: ${projectId}`,
    `Project workspace: ${projectDir}  (write every artifact, checkpoint and render under this folder${outside ? "; it is outside the checkout's projects/ dir, so the Backlot board will not see it" : ""})`,
    ``,
    `Brief from the owner:`,
    brief.trim(),
    ``,
    `This run is unattended (started from Agent OS, nobody is watching the chat):`,
    `- Do not ask questions. Where the manifest wants human approval, pick the option that best fits the brief, append it to the decision_log, and continue.`,
    `- Prefer free and local tools. Do not use a paid provider unless its key is already in the checkout's .env, and stay under the manifest's budget_default_usd${p.budgetUsd != null ? ` ($${p.budgetUsd})` : ""}.`,
    `- Do not run "python -m backlot open" (there is no browser here).`,
    `- Do not install anything with pip or npm. If a dependency is missing, stop and print the exact install command on its own line, prefixed "MISSING: ".`,
    `- Finish by printing one line "FINAL: <path of the rendered video>" or "FINAL: none (<reason>)".`,
  ].join("\n");
}

export function agentArgs(agent: string): string[] {
  switch (agent) {
    // stream-json gives live progress (text and tool_use per turn); text mode
    // prints nothing until the end, which would leave the tray silent for an hour.
    case "claude": return ["-p", "--model", claudeModel(), "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    case "codex": return ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", "-"];
    case "cursor": return ["-p", "--output-format", "text", "--force", "--trust"];
    case "hermes": return ["-z", "-", "--yolo", "--accept-hooks"];
    default: throw new OpenMontageError(`${agent} is not wired for OpenMontage runs; pick claude, codex, cursor or hermes in the gear`, { status: 400 });
  }
}

/** One claude stream-json line to a tray-sized log line, or null to skip it. */
export function summarizeStreamLine(line: string): string | null {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { return line.trim() || null; }
  const type = e.type;
  if (type === "assistant") {
    const msg = e.message as { content?: Array<Record<string, unknown>> } | undefined;
    const parts: string[] = [];
    for (const c of msg?.content ?? []) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) parts.push(c.text.trim().replace(/\s+/g, " "));
      if (c.type === "tool_use") {
        const input = c.input as Record<string, unknown> | undefined;
        const hint = typeof input?.command === "string" ? input.command : typeof input?.file_path === "string" ? input.file_path : typeof input?.path === "string" ? input.path : "";
        parts.push(`> ${String(c.name)}${hint ? ` ${hint}` : ""}`);
      }
    }
    return parts.length ? parts.join(" | ") : null;
  }
  if (type === "result") {
    const r = e as { subtype?: string; is_error?: boolean; num_turns?: number; total_cost_usd?: number; result?: string };
    const tail = typeof r.result === "string" ? r.result.trim().split("\n").pop() : "";
    return `result: ${r.subtype ?? (r.is_error ? "error" : "done")}${r.num_turns != null ? `, ${r.num_turns} turns` : ""}${r.total_cost_usd != null ? `, $${r.total_cost_usd.toFixed(2)}` : ""}${tail ? ` :: ${tail}` : ""}`;
  }
  if (type === "system" && (e as { subtype?: string }).subtype === "init") return `claude session started (${String((e as { model?: string }).model ?? "")})`;
  return null; // user/tool_result echoes and partial stream events are noise in a 40-line tray
}

/** Rendered files under the project folder (renders/ first, then anything media-like). */
export function listOutputs(projectDir: string): OutputFile[] {
  if (!fs.existsSync(projectDir)) return [];
  const out: OutputFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "history" && !e.name.startsWith(".")) walk(full, depth + 1); continue; }
      if (!RENDER_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = fs.statSync(full);
        out.push({ path: full, rel: path.relative(projectDir, full).split(path.sep).join("/"), bytes: st.size, mtime: st.mtimeMs });
      } catch { /* vanished between readdir and stat */ }
    }
  };
  walk(projectDir, 0);
  const rank = (f: OutputFile) => (f.rel.startsWith("renders/") ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.mtime - a.mtime);
}

/** Stage names with a checkpoint file, from projects/<id>/checkpoint_<stage>.json. */
export function completedStages(projectDir: string): string[] {
  try {
    return fs.readdirSync(projectDir)
      .map((f) => /^checkpoint_([a-z0-9_-]+)\.json$/i.exec(f)?.[1] ?? "")
      .filter(Boolean);
  } catch { return []; }
}

function pipeLines(stream: ChildLike["stdout"], onLine: (line: string) => void): void {
  let buf = "";
  stream?.on("data", (b) => {
    buf += b.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    if (buf.length > 20_000) { onLine(buf); buf = ""; }
  });
}

/** Spawn one agent and stream it into ctx.log. Resolves with the exit code, or rejects
 *  with { notStarted: true } when the CLI could not be launched at all. */
function driveAgent(agent: string, prompt: string, cfg: OpenMontageConfig, ctx: ModuleRunContext, spawnAgent: SpawnAgentFn): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let child: ChildLike;
    try { child = spawnAgent(agent, agentArgs(agent), { cwd: cfg.repoPath, input: prompt }); }
    catch (e) { reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { notStarted: true })); return; }
    let started = false;
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); ctx.signal.removeEventListener("abort", onAbort); fn(); };
    const kill = () => { try { child.kill(); } catch { /* already gone */ } };
    const onAbort = () => { kill(); };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { ctx.log(`timed out after ${cfg.timeoutMin} min; killing ${agent}`); kill(); }, cfg.timeoutMin * 60_000);
    (timer as { unref?: () => void }).unref?.();
    const log = (line: string) => {
      started = true;
      const t = agent === "claude" ? summarizeStreamLine(line) : line.trim();
      if (t) ctx.log(t);
    };
    pipeLines(child.stdout, log);
    pipeLines(child.stderr, (l) => { if (l.trim()) { started = true; ctx.log(`stderr: ${l.trim()}`); } });
    child.on("error", (e) => finish(() => {
      if (started) resolve(null);
      else reject(Object.assign(new Error(`${agent} could not start: ${e.message}`), { notStarted: true }));
    }));
    child.on("close", (code) => finish(() => resolve(code)));
  });
}

/**
 * Start the pipeline as a module run. Returns at once with the run id; the
 * route hands that to the page, which polls /api/runs/:id for the live log.
 */
export function startPipelineRun(
  input: RunInput,
  cfg: OpenMontageConfig,
  deps: { spawnAgent: SpawnAgentFn; agentInstalled: (agent: string) => boolean; preflight?: () => Promise<void> },
): { id: string; projectId: string; pipeline: PipelineDef; promise: Promise<RunOutcome> } {
  const brief = (input.brief ?? "").trim();
  if (!brief) throw new OpenMontageError("brief required", { status: 400 });
  const pipeline = findPipeline(cfg.repoPath, input.pipelineId);
  const projectId = (input.projectId ?? "").trim() || defaultProjectId(brief);
  if (!validProjectId(projectId)) throw new OpenMontageError(`bad project id "${projectId}" (lowercase letters, digits, - and _)`, { status: 400 });
  const projectDir = path.join(cfg.outputDir, projectId);
  const prompt = buildPrompt(pipeline, brief, projectId, cfg);

  const run = startModuleRun<RunOutcome>(
    { module: MODULE, label: `${pipeline.name}: ${brief.slice(0, 90)}`, href: HREF },
    async (ctx) => {
      if (deps.preflight) await deps.preflight();
      fs.mkdirSync(projectDir, { recursive: true });
      ctx.log(`pipeline ${pipeline.id} (${pipeline.stages.length} stages), project ${projectId}`);

      let agent = cfg.agent;
      let fellBackFrom: string | undefined;
      let fallbackReason: string | undefined;
      if (!deps.agentInstalled(agent)) {
        if (cfg.fallbackAgent !== "none" && cfg.fallbackAgent !== agent && deps.agentInstalled(cfg.fallbackAgent)) {
          fellBackFrom = agent; fallbackReason = `${agent} CLI is not installed`; agent = cfg.fallbackAgent;
          ctx.log(`fallback: ${fellBackFrom} is not installed, running ${agent} instead (gear: Fallback agent)`);
        } else {
          throw new OpenMontageError(`${agent} CLI is not installed`, { fix: `Install the ${agent} CLI, or pick another agent in the gear` });
        }
      }
      ctx.log(`${agent} started in ${cfg.repoPath}`);

      let code: number | null;
      try {
        code = await driveAgent(agent, prompt, cfg, ctx, deps.spawnAgent);
      } catch (e) {
        const err = e as Error & { notStarted?: boolean };
        if (err.notStarted && !fellBackFrom && cfg.fallbackAgent !== "none" && cfg.fallbackAgent !== agent && deps.agentInstalled(cfg.fallbackAgent)) {
          fellBackFrom = agent; fallbackReason = err.message; agent = cfg.fallbackAgent;
          ctx.log(`fallback: ${err.message}; running ${agent} instead (gear: Fallback agent)`);
          code = await driveAgent(agent, prompt, cfg, ctx, deps.spawnAgent);
        } else {
          throw err;
        }
      }
      if (ctx.signal.aborted) throw new Error("stopped");

      const outputs = listOutputs(projectDir);
      const stages = completedStages(projectDir);
      ctx.log(`${agent} exited ${code ?? "?"}; ${outputs.length} rendered file(s), ${stages.length} checkpoint(s)`);
      if (code !== 0) throw new Error(`${agent} exited with code ${code ?? "null"} (${outputs.length} rendered file(s) in ${projectDir})`);
      return { projectId, projectDir, pipeline: pipeline.id, agent, fellBackFrom, fallbackReason, exitCode: code, stages, outputs };
    },
    { summarize: (r) => ({ projectId: r.projectId, projectDir: r.projectDir, pipeline: r.pipeline, agent: r.agent, fellBackFrom: r.fellBackFrom ?? null, fallbackReason: r.fallbackReason ?? null, outputs: r.outputs.slice(0, 12), stages: r.stages }) },
  );
  return { id: run.id, projectId, pipeline, promise: run.promise };
}

/** Existing project folders under the output dir, newest first, with their renders. */
export function listProjects(outputDir: string, limit = 30): Array<{ id: string; dir: string; mtime: number; stages: string[]; outputs: OutputFile[] }> {
  if (!fs.existsSync(outputDir)) return [];
  const rows: Array<{ id: string; dir: string; mtime: number; stages: string[]; outputs: OutputFile[] }> = [];
  for (const e of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(outputDir, e.name);
    let mtime = 0;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { continue; }
    rows.push({ id: e.name, dir, mtime, stages: completedStages(dir), outputs: listOutputs(dir).slice(0, 8) });
  }
  return rows.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
