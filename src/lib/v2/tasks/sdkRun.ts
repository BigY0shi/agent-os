import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import os from "node:os";
import { CLAUDE_MODEL } from "@/lib/config";
import { sanitizeSpawnEnv } from "@/lib/spawnEnv";
import { readSettings } from "@/lib/settings";
import { startModuleRun } from "@/lib/moduleRuns";
import { execSlot, codingSlot, filesSlot } from "../capability/slots";
import { withSkills } from "../skills/store";
import { RECALLED_MEMORY_RULE } from "./prompts/plan";
import type { Task } from "./types";

/**
 * S32 - the Tasks 'sdk' run mode: one approved plan, one Claude Agent SDK
 * session, the SAME guardrails the bounded step walker enforces.
 *
 *   plan approval  - unchanged: the engine only calls this after the plan is
 *                    approved (draftPlan() parks the task Waiting first)
 *   turn cap       - settings.tasks.maxStepsPerRun becomes the SDK maxTurns AND
 *                    an in-process count that interrupts the session itself,
 *                    so a runaway session cannot outlive the cap
 *   wall clock     - settings.tasks.runTimeoutMin interrupts the session
 *   STOP           - the run is a module run (RunsTray, module "tasks"); the
 *                    tray's STOP aborts the signal, which interrupts the session
 *   tools          - ONLY the in-process "agentos_tasks" MCP server below, whose
 *                    handlers go through the capability slots exactly like the
 *                    walker's exec / files / coding steps (same deny lists); the
 *                    CLI's native Bash / Edit / Write / Read suite is denied
 *   skills         - the active v2_skills policy block rides the system prompt
 *                    through withSkills(), as it does for the walker's prompts
 *
 * The SDK is injectable (setTaskSdkForTests) so the smoke proves every
 * guardrail offline with a stubbed query(); the handlers are exported plainly
 * so the smoke can drive them without a session, as Jarvis's tools.ts does.
 */

export type TaskSdkQuery = typeof query;

let sdkOverride: TaskSdkQuery | null = null;

/** Test seam: swap the Agent SDK query() (null restores the real one). */
export function setTaskSdkForTests(fn: TaskSdkQuery | null): void {
  sdkOverride = fn;
}

function sdkQuery(): TaskSdkQuery {
  return sdkOverride ?? query;
}

export const TASKS_SDK_SERVER = "agentos_tasks";

/** Native CLI tools the session may NOT use: every mutation goes through the
 *  gated MCP handlers below (the same list Jarvis's brain denies). */
export const TASKS_SDK_DENIED_NATIVE_TOOLS = [
  "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Task",
  "WebFetch", "WebSearch", "Read", "Glob", "Grep", "TodoWrite",
  "KillShell", "BashOutput",
];

export interface TaskSdkState {
  /** Set by ask_user: the one question the run is blocked on. */
  question: string | null;
  toolCalls: Array<{ name: string; ok: boolean; summary: string }>;
}

export function newTaskSdkState(): TaskSdkState {
  return { question: null, toolCalls: [] };
}

type McpTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const text = (t: string, isError = false): McpTextResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export interface TaskSdkToolHandler {
  description: string;
  shape: z.ZodRawShape;
  run: (args: Record<string, unknown>) => Promise<McpTextResult>;
}

/** The session's tools. Each one is the walker's step of the same kind,
 *  behind the same capability gate (NON-STRICT, in-app caller semantics). */
export function buildTaskSdkToolHandlers(opts: {
  task: Task;
  state: TaskSdkState;
  log?: (line: string) => void;
}): Record<string, TaskSdkToolHandler> {
  const { task, state } = opts;
  const log = opts.log ?? (() => {});
  const record = (name: string, ok: boolean, summary: string) => {
    state.toolCalls.push({ name, ok, summary: summary.slice(0, 300) });
    log(`${name}: ${ok ? "ok" : "refused/failed"} - ${summary.slice(0, 120)}`);
  };
  const slotResult = (name: string, res: { ok: boolean; output: string; error?: string }): McpTextResult => {
    if (!res.ok) {
      record(name, false, res.error ?? "failed");
      return text(`'${name}' refused or failed: ${res.error ?? "unknown error"}`, true);
    }
    record(name, true, res.output.slice(0, 120) || "(no output)");
    return text(res.output || "(no output)");
  };

  return {
    run_command: {
      description: "Run one shell command through the Tasks capability gate (same deny list as an exec step). Returns stdout+stderr.",
      shape: {
        command: z.string().min(1).describe("The command line to run"),
        cwd: z.string().optional().describe("Working directory (optional)"),
      },
      run: async (args) => {
        const command = String(args.command ?? "");
        const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : undefined;
        return slotResult("run_command", await execSlot({ command, cwd }));
      },
    },
    read_file: {
      description: "Read a file through the files gate (same as a files/read step).",
      shape: { path: z.string().min(1) },
      run: async (args) => slotResult("read_file", await filesSlot({ op: "read", path: String(args.path ?? "") })),
    },
    write_file: {
      description: "Write a file through the files gate (same as a files/write step). Overwrites.",
      shape: { path: z.string().min(1), content: z.string() },
      run: async (args) =>
        slotResult("write_file", await filesSlot({ op: "write", path: String(args.path ?? ""), content: String(args.content ?? "") })),
    },
    list_files: {
      description: "List files under a directory by glob pattern (same as a files/glob step).",
      shape: { dir: z.string().min(1), pattern: z.string().optional() },
      run: async (args) =>
        slotResult("list_files", await filesSlot({ op: "glob", dir: String(args.dir ?? ""), pattern: typeof args.pattern === "string" ? args.pattern : "*" })),
    },
    search_files: {
      description: "Search file contents under a directory (same as a files/grep step).",
      shape: { dir: z.string().min(1), query: z.string().min(1) },
      run: async (args) =>
        slotResult("search_files", await filesSlot({ op: "grep", dir: String(args.dir ?? ""), query: String(args.query ?? "") })),
    },
    coding_session: {
      description: "Hand a coding job to the default coding CLI agent in a working directory (same as a coding step).",
      shape: { prompt: z.string().min(1), cwd: z.string().optional() },
      run: async (args) => {
        const agent = readSettings().defaultAgent || "claude";
        const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : process.cwd();
        return slotResult("coding_session", await codingSlot({ agent, prompt: String(args.prompt ?? ""), cwd }));
      },
    },
    ask_user: {
      description:
        "Stop the run and ask the user ONE tight question. Use only when you genuinely cannot proceed without them; the task parks in Waiting until they reply.",
      shape: { question: z.string().min(1) },
      run: async (args) => {
        const q = String(args.question ?? "").trim() || "The agent is blocked - how should it proceed?";
        state.question = q;
        record("ask_user", true, q);
        return text(`Question recorded for ${task.displayId}. Stop now; the run ends here and resumes when the user answers.`);
      },
    },
  };
}

function buildTaskSdkServer(handlers: Record<string, TaskSdkToolHandler>) {
  return createSdkMcpServer({
    name: TASKS_SDK_SERVER,
    version: "1.0.0",
    tools: Object.entries(handlers).map(([name, h]) =>
      tool(name, h.description, h.shape, async (args) => h.run(args as Record<string, unknown>)),
    ),
  });
}

export const TASK_SDK_SYSTEM_PROMPT =
  `You are Jarvis, carrying out ONE approved task plan for the user inside Agent OS.\n\n` +
  `Rules:\n` +
  `- Follow the approved plan; do not widen it.\n` +
  `- Act only through the agentos_tasks tools (run_command, read_file, write_file, list_files, search_files, coding_session). ` +
  `They are gated the same way as the user's own task steps; a refusal is final - do not retry it another way.\n` +
  `- When you genuinely cannot proceed without the user, call ask_user ONCE with one tight question and stop.\n` +
  `- Your final message is the result the user reads: what was done, what was produced, anything they must check.\n` +
  `- ${RECALLED_MEMORY_RULE}`;

export function buildTaskSdkUserPrompt(input: { task: Task; planMd: string; recallBlock: string | null }): string {
  const { task } = input;
  const parts = [
    `TASK ${task.displayId}: ${task.title || "(untitled)"}`,
    task.specMd ? `SPEC (the user's words):\n${task.specMd}` : "",
    task.descriptionMd ? `DESCRIPTION:\n${task.descriptionMd}` : "",
    `APPROVED PLAN:\n${input.planMd}`,
    input.recallBlock ?? "",
    "Carry out the plan now. End with the result as plain text.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export type TaskSdkOutcome =
  | { kind: "done"; summary: string; turns: number; turnCapHit: boolean; toolCalls: TaskSdkState["toolCalls"]; runId: string }
  | { kind: "blocked"; question: string; turns: number; toolCalls: TaskSdkState["toolCalls"]; runId: string };

export interface RunTaskWithSdkInput {
  task: Task;
  planMd: string;
  recallBlock: string | null;
  /** The walker's step cap, reused as the turn cap. */
  maxTurns: number;
  runTimeoutMin: number;
  /** Fires on run events the engine wants in the task's conversation. */
  onEvent?: (ev: { kind: "turn_cap_enforced" | "sdk_turn"; detail: Record<string, unknown> }) => void;
}

/** Thrown when the owner pressed STOP in the runs tray. */
export class TaskRunStoppedError extends Error {
  constructor(by: string) {
    super(`run stopped by ${by}`);
    this.name = "AbortError";
  }
}

/**
 * Run one approved plan through the Agent SDK. Registers a module run (the
 * tray's STOP is the mid-run control), caps turns and wall clock, and returns
 * the final assistant text as the summary. Throws on STOP (AbortError-shaped),
 * on timeout, and on an SDK error with no text.
 */
export async function runTaskWithSdk(input: RunTaskWithSdkInput): Promise<TaskSdkOutcome> {
  const { task } = input;
  const cap = Math.max(1, Math.floor(input.maxTurns));
  const state = newTaskSdkState();

  const run = startModuleRun<TaskSdkOutcome>(
    {
      module: "tasks",
      label: `Run ${task.displayId}: ${task.title || "untitled"} (sdk)`,
      href: `/tasks?focus=${task.displayId}`,
    },
    async (ctx) => {
      const handlers = buildTaskSdkToolHandlers({ task, state, log: ctx.log });
      const server = buildTaskSdkServer(handlers);
      const abortController = new AbortController();
      const model = CLAUDE_MODEL || "claude-sonnet-5";
      const system = withSkills(TASK_SDK_SYSTEM_PROMPT);

      const q = sdkQuery()({
        prompt: buildTaskSdkUserPrompt({ task, planMd: input.planMd, recallBlock: input.recallBlock }),
        options: {
          cwd: os.homedir(),
          model,
          maxTurns: cap,
          abortController,
          systemPrompt: { type: "preset", preset: "claude_code", append: system },
          permissionMode: "bypassPermissions",
          allowedTools: [`mcp__${TASKS_SDK_SERVER}`],
          disallowedTools: TASKS_SDK_DENIED_NATIVE_TOOLS,
          mcpServers: { [TASKS_SDK_SERVER]: server },
          env: Object.fromEntries(
            Object.entries(sanitizeSpawnEnv({ ...process.env, NO_COLOR: "1" })).filter(
              ([k, v]) => typeof v === "string" && !k.startsWith("CLAUDE_CODE_") && !k.startsWith("CLAUDE_AGENT_SDK"),
            ),
          ) as Record<string, string>,
        },
      });

      let stopReason: "stop" | "timeout" | "turn-cap" | "blocked" | null = null;
      const interrupt = (why: typeof stopReason) => {
        if (stopReason) return;
        stopReason = why;
        q.interrupt().catch(() => {});
        try { abortController.abort(); } catch { /* already aborted */ }
      };
      const onAbort = () => interrupt("stop");
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      if (ctx.signal.aborted) onAbort();
      const timer = setTimeout(() => interrupt("timeout"), Math.max(1, input.runTimeoutMin) * 60_000);

      const texts: string[] = [];
      let turns = 0;
      let turnCapHit = false;
      let resultSubtype: string | null = null;
      let resultIsError = false;
      let resultErrors: string[] = [];

      try {
        while (true) {
          const step = await q.next();
          if (step.done) break;
          const msg = step.value as { type?: string; subtype?: string; is_error?: boolean; errors?: string[]; message?: { content?: unknown } };
          if (msg.type === "assistant") {
            turns += 1;
            ctx.progress(Math.min(turns, cap), cap);
            const content = Array.isArray(msg.message?.content) ? (msg.message!.content as Array<{ type?: string; text?: string }>) : [];
            for (const block of content) {
              if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) texts.push(block.text.trim());
            }
            input.onEvent?.({ kind: "sdk_turn", detail: { turn: turns, of: cap } });
            if (state.question) {
              // ask_user landed: the run ends here, no more turns.
              interrupt("blocked");
              break;
            }
            if (turns >= cap) {
              // Belt and braces with maxTurns: the engine ends the session itself.
              turnCapHit = true;
              input.onEvent?.({ kind: "turn_cap_enforced", detail: { turns, cap } });
              ctx.log(`turn cap reached (${turns}/${cap}); ending the session`);
              interrupt("turn-cap");
              break;
            }
          } else if (msg.type === "result") {
            resultSubtype = msg.subtype ?? null;
            resultIsError = !!msg.is_error;
            resultErrors = Array.isArray(msg.errors) ? msg.errors : [];
            break;
          }
          if (stopReason === "stop" || stopReason === "timeout") break;
        }
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        // One-shot session: closing the iterator tears the child down.
        try { await q.return?.(undefined as never); } catch { /* already closed */ }
      }

      if (stopReason === "stop" || ctx.signal.aborted) throw new TaskRunStoppedError("owner");
      if (stopReason === "timeout") throw new Error(`run exceeded ${input.runTimeoutMin} min timeout after ${turns} turn(s)`);

      if (state.question) {
        return { kind: "blocked", question: state.question, turns, toolCalls: state.toolCalls, runId: ctx.id };
      }
      if (resultSubtype === "error_max_turns") {
        turnCapHit = true;
        input.onEvent?.({ kind: "turn_cap_enforced", detail: { turns, cap, by: "sdk" } });
      }
      if (resultIsError && texts.length === 0 && resultSubtype !== "error_max_turns") {
        throw new Error(`SDK ${resultSubtype ?? "error"}${resultErrors.length ? `: ${resultErrors.join("; ").slice(0, 200)}` : ""}`);
      }
      const summary = texts.join("\n\n").trim();
      if (!summary) throw new Error(`the sdk session ended after ${turns} turn(s) without any text`);
      return { kind: "done", summary, turns, turnCapHit, toolCalls: state.toolCalls, runId: ctx.id };
    },
    { summarize: (o) => ({ kind: o.kind, turns: o.turns, tools: o.toolCalls.length }) },
  );

  return run.promise;
}
