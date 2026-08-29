import { z } from "zod";
import { getDb } from "../db";
import { now } from "../ids";
import { emit } from "../events";
import { enqueueTask } from "../scheduler";
import { readSettings } from "../../settings";
import { modelCall, modelCallText } from "../memory/llm";
import { searchV2 } from "../memory/search";
import { formatRecallAsMarkdown } from "../memory/search/formatter";
import { ingestFromModule } from "../memory/queue";
import { execSlot, codingSlot, filesSlot } from "../capability/slots";
import { withSkills } from "../skills/store";
import type { AttentionFlagPayload } from "../eventTypes";
import type { ChatMessage } from "../memory/types";
import type { RecallResult } from "../memory/types";
import {
  getTask,
  updateTask,
  changeTaskStatus,
  appendTaskEvent,
  appendMessage,
  listMessages,
  getOrCreateTaskConversation,
  createRunConversation,
  listTaskConversations,
} from "./store";
import type { Task, Message, Conversation } from "./types";
import {
  PlanSchema,
  PlanStepSchema,
  StepResultSchema,
  PLAN_SYSTEM_PROMPT,
  STEP_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildPlanUserPrompt,
  buildStepUserPrompt,
  buildWriteContentPrompt,
  buildSummaryPrompt,
  wrapRecalledMemory,
  type Plan,
  type PlanStep,
  type StepResult,
} from "./prompts/plan";

/**
 * SPEC-B B2 — task execution engine: claim → gather context → PLAN (approval-
 * gated) → EXECUTE (bounded step walker) → deliver + ingest.
 *
 * Design decisions (recorded for the report):
 *  - runMode: 'steps' | 'sdk'. SPEC-B open question #1 is unresolved in
 *    CONVENTIONS/PROGRESS, so per the B2 brief the bounded step-walker ships
 *    now and 'sdk' throws NOT_IMPLEMENTED (chunk 3+ seam).
 *  - The plan lives in v2_tasks.plan_md (user-facing markdown) + the walkable
 *    steps in metadata.planSteps (PlanStepSchema[]) — B1 stored plans in
 *    columns, not page zones (zones land with B5's pages).
 *  - plan_status enum is B1's: none | drafted | approved | rejected
 *    ('drafted' == the brief's 'proposed').
 *  - All LLM traffic routes through memory/llm.ts modelCall/modelCallText
 *    (rule 11, provider-routed). AGENTOS_MOCK_LLM=1 swaps a deterministic
 *    in-engine mock via the EngineLlm injectable below — llm.ts is untouched.
 *  - Capability-slot calls use the NON-STRICT gate (in-app caller semantics).
 *  - task "category" for auto-approve = metadata.category (v2_tasks has no
 *    category column in migration 020; additive, no migration needed).
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_RUN_TIMEOUT_MIN = 30;

interface TasksEngineSettings {
  planApproval: "always" | "auto";
  autoApproveCategories: string[];
  autoApproveMaxSteps: number;
  maxStepsPerRun: number;
  runTimeoutMin: number;
  runMode: "steps" | "sdk";
}

function engineSettings(): TasksEngineSettings {
  const t = readSettings().tasks ?? {};
  const maxStepsPerRun =
    typeof t.maxStepsPerRun === "number" && t.maxStepsPerRun > 0
      ? t.maxStepsPerRun
      : DEFAULT_MAX_STEPS;
  return {
    planApproval: t.planApproval === "auto" ? "auto" : "always",
    autoApproveCategories: Array.isArray(t.autoApprove?.categories)
      ? t.autoApprove.categories.filter((c): c is string => typeof c === "string")
      : [],
    autoApproveMaxSteps:
      typeof t.autoApprove?.maxSteps === "number" && t.autoApprove.maxSteps > 0
        ? t.autoApprove.maxSteps
        : maxStepsPerRun,
    maxStepsPerRun,
    runTimeoutMin:
      typeof t.runTimeoutMin === "number" && t.runTimeoutMin > 0
        ? t.runTimeoutMin
        : DEFAULT_RUN_TIMEOUT_MIN,
    runMode: t.runMode === "sdk" ? "sdk" : "steps",
  };
}

// ---------------------------------------------------------------------------
// EngineLlm injectable (AGENTOS_MOCK_LLM hook — llm.ts stays untouched)
// ---------------------------------------------------------------------------

export interface EngineLlm {
  plan(messages: ChatMessage[]): Promise<Plan>;
  step(messages: ChatMessage[]): Promise<StepResult>;
  text(messages: ChatMessage[]): Promise<string>;
  /** Formatted recall markdown for the query, or null when nothing recalled. */
  recall(query: string): Promise<string | null>;
}

const realLlm: EngineLlm = {
  plan: (messages) => modelCall(messages, "medium", { schema: PlanSchema }),
  step: (messages) => modelCall(messages, "low", { schema: StepResultSchema }),
  text: (messages) => modelCallText(messages, "low"),
  async recall(query) {
    const result = (await searchV2(query, { structured: true })) as RecallResult;
    if (!result || (result.episodes.length === 0 && !(result.statements?.length || result.voiceAspects?.length))) {
      return null;
    }
    const md = formatRecallAsMarkdown(result);
    return md?.trim() ? md : null;
  },
};

/** Deterministic mock: canned plan + canned step outputs, keyed off markers in
 *  the prompt text (MOCK_BLOCKER / MOCK_MANY_STEPS / MOCK_EXEC). */
const mockLlm: EngineLlm = {
  async plan(messages) {
    const text = messages.map((m) => m.content).join("\n");
    const reason = (title: string, instruction: string): PlanStep => ({
      title,
      kind: "reason",
      instruction,
      command: null,
      cwd: null,
      path: null,
      filesOp: null,
      pattern: null,
    });
    let steps: PlanStep[];
    if (text.includes("MOCK_MANY_STEPS")) {
      steps = Array.from({ length: 20 }, (_, i) => reason(`Mock step ${i + 1}`, `mock instruction ${i + 1}`));
    } else if (text.includes("MOCK_BLOCKER")) {
      steps = [reason("Analyze the task", "mock analysis"), reason("Blocked step", "MOCK_BLOCKER hit this step")];
    } else if (text.includes("MOCK_EXEC")) {
      steps = [
        reason("Analyze the task", "mock analysis"),
        {
          title: "Echo marker",
          kind: "exec",
          instruction: "echo the mock marker",
          command: "echo mock-exec-ok",
          cwd: null,
          path: null,
          filesOp: null,
          pattern: null,
        },
      ];
    } else {
      steps = [reason("Analyze the task", "mock analysis"), reason("Produce the result", "mock production")];
    }
    return {
      planMd: `1. ${steps.map((s) => s.title).join("\n1. ")}`,
      steps,
    };
  },
  async step(messages) {
    const text = messages.map((m) => m.content).join("\n");
    if (text.includes("MOCK_BLOCKER")) {
      return { status: "blocked", output: "", question: "Mock blocker: which option should I take, A or B?" };
    }
    const m = /CURRENT STEP (\d+)\/(\d+): ([^\n]+)/.exec(text);
    return {
      status: "ok",
      output: `mock output for step ${m ? m[1] : "?"} (${m ? m[3] : "unknown"})`,
      question: null,
    };
  },
  async text(messages) {
    const text = messages.map((m) => m.content).join("\n");
    if (text.includes("Produce ONLY the complete file content")) return "mock file content\n";
    return "Mock summary: all planned steps completed deterministically (AGENTOS_MOCK_LLM).";
  },
  async recall() {
    return null; // no recall in mock mode — never touches the network
  },
};

let overrideLlm: EngineLlm | null = null;

/** Test seam: inject a custom EngineLlm (null restores default resolution). */
export function setEngineLlmForTests(impl: EngineLlm | null): void {
  overrideLlm = impl;
}

function llm(): EngineLlm {
  if (overrideLlm) return overrideLlm;
  return process.env.AGENTOS_MOCK_LLM ? mockLlm : realLlm;
}

// ---------------------------------------------------------------------------
// In-flight run registry (globalThis — Next instantiates modules per bundle)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __agentosV2TaskRuns: Set<string> | undefined;
}

function inFlight(): Set<string> {
  if (!globalThis.__agentosV2TaskRuns) globalThis.__agentosV2TaskRuns = new Set();
  return globalThis.__agentosV2TaskRuns;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskRoute(task: Task): string {
  return `/tasks?focus=${task.displayId}`;
}

function emitAttention(payload: AttentionFlagPayload): void {
  emit("attention.flag", payload as unknown as Record<string, unknown>, "tasks");
}

/** Recurring tasks get a fresh conversation per fire; one-shot tasks share one.
 *  An immediate resume (approve / reply) reuses the latest existing thread so
 *  the approval round-trip stays in one conversation. */
function resolveConversation(task: Task, opts: { immediate: boolean }): Conversation {
  const isRecurring = !!task.schedule;
  if (!isRecurring) return getOrCreateTaskConversation(task.id, task.agentId ?? undefined);
  const existing = listTaskConversations(task.id);
  if (opts.immediate && existing.length > 0) return existing[existing.length - 1];
  return createRunConversation(task.id, task.occurrenceCount + 1, task.agentId ?? undefined);
}

function taskQueryText(task: Task): string {
  return [task.title, task.specMd ?? "", task.descriptionMd ?? ""].filter(Boolean).join("\n").slice(0, 1500);
}

async function gatherRecall(task: Task): Promise<string | null> {
  try {
    const raw = await llm().recall(taskQueryText(task));
    return raw?.trim() ? wrapRecalledMemory(raw) : null;
  } catch (err) {
    console.warn(
      `[v2/tasks] recall failed for ${task.displayId} (continuing without memory):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function readPlanSteps(task: Task): PlanStep[] {
  const parsed = z.array(PlanStepSchema).safeParse(task.metadata.planSteps);
  if (parsed.success && parsed.data.length > 0) return parsed.data;
  // Approved plan without stored steps (hand-written plan_md): walk it as one
  // reason step so execution still has something bounded to do.
  return [
    {
      title: "Execute the approved plan",
      kind: "reason",
      instruction: `Carry out the approved plan exactly as written:\n${task.planMd ?? task.title}`,
      command: null,
      cwd: null,
      path: null,
      filesOp: null,
      pattern: null,
    },
  ];
}

function sys(content: string): ChatMessage {
  return { role: "system", content };
}
/** B7 (CONVENTIONS §11): execution-stage system prompts (PLAN + STEP incl.
 *  write-content drafting) carry the active v2_skills policy block via
 *  withSkills() — model-agnostic data injection, same block Jarvis C4 renders.
 *  The SUMMARY prompt is post-hoc reporting and stays bare on purpose.
 *  withSkills is defensive ("" on store failure), so mock-LLM runs and pure
 *  smoke DBs pass through unchanged when no skills exist. */
function sysWithSkills(content: string): ChatMessage {
  return { role: "system", content: withSkills(content) };
}
function user(content: string): ChatMessage {
  return { role: "user", content };
}

// ---------------------------------------------------------------------------
// PLAN stage
// ---------------------------------------------------------------------------

async function draftPlan(task: Task, conv: Conversation, recallBlock: string | null): Promise<"approved" | "waiting"> {
  const s = engineSettings();
  const messages = listMessages(conv.id, { includeEphemeral: false });
  const plan = await llm().plan([
    sysWithSkills(PLAN_SYSTEM_PROMPT),
    user(buildPlanUserPrompt({ task, recallBlock, messages })),
  ]);

  updateTask(
    task.id,
    {
      planMd: plan.planMd,
      planStatus: "drafted",
      metadata: { ...task.metadata, planSteps: plan.steps },
    },
    "agent",
  );
  appendTaskEvent(task.id, "plan_drafted", "agent", { steps: plan.steps.length });

  // Auto-approve: global 'auto' gate, or the task's category is opted in AND
  // the plan is small enough (autoApprove.maxSteps, default = maxStepsPerRun).
  const category = typeof task.metadata.category === "string" ? task.metadata.category : null;
  const autoApproved =
    s.planApproval === "auto" ||
    (category !== null &&
      s.autoApproveCategories.includes(category) &&
      plan.steps.length <= s.autoApproveMaxSteps);

  if (autoApproved) {
    updateTask(task.id, { planStatus: "approved" }, "user");
    appendTaskEvent(task.id, "plan_approved", "system", {
      auto: true,
      reason: s.planApproval === "auto" ? "planApproval=auto" : `category '${category}' auto-approved`,
    });
    appendMessage(conv.id, {
      role: "assistant",
      content: `Plan (auto-approved):\n\n${plan.planMd}`,
      userType: "system",
    });
    return "approved";
  }

  appendMessage(conv.id, {
    role: "assistant",
    content:
      `Plan drafted for ${task.displayId}:\n\n${plan.planMd}\n\n` +
      `Approve this plan to start, or reject it with feedback.`,
    userType: "system",
  });
  changeTaskStatus(task.id, "Waiting", "agent");
  emitAttention({
    kind: "task.plan-approval",
    severity: "warn",
    title: `Plan ready: ${task.title || task.displayId}`,
    route: taskRoute(task),
    dedupeKey: `task-plan-${task.id}`,
    taskId: task.id,
    displayId: task.displayId,
  });
  return "waiting";
}

// ---------------------------------------------------------------------------
// EXECUTE stage — bounded sequential step walker
// ---------------------------------------------------------------------------

interface StepOutcome {
  ok: boolean;
  output: string;
  question: string | null;
}

async function runStep(
  task: Task,
  planMd: string,
  step: PlanStep,
  index: number,
  count: number,
  priorOutputs: Array<{ title: string; output: string }>,
  recallBlock: string | null,
): Promise<StepOutcome> {
  switch (step.kind) {
    case "reason": {
      const result = await llm().step([
        sysWithSkills(STEP_SYSTEM_PROMPT),
        user(
          buildStepUserPrompt({
            task,
            planMd,
            step,
            stepIndex: index,
            stepCount: count,
            priorOutputs,
            recallBlock,
          }),
        ),
      ]);
      if (result.status === "blocked") {
        return { ok: false, output: result.output, question: result.question || "The agent is blocked — how should it proceed?" };
      }
      return { ok: true, output: result.output, question: null };
    }
    case "exec": {
      if (!step.command?.trim()) {
        return { ok: false, output: "", question: `Step "${step.title}" is an exec step with no command — how should I run it?` };
      }
      const res = await execSlot({ command: step.command, cwd: step.cwd ?? undefined });
      if (!res.ok) {
        return {
          ok: false,
          output: res.output,
          question: `Step "${step.title}" failed (${(res.error ?? "unknown error").slice(0, 300)}). How should I proceed?`,
        };
      }
      return { ok: true, output: res.output || "(no output)", question: null };
    }
    case "coding": {
      const agent = readSettings().defaultAgent || "claude";
      const cwd = step.cwd ?? process.cwd();
      const res = await codingSlot({ agent, prompt: step.instruction, cwd });
      if (!res.ok) {
        return {
          ok: false,
          output: res.output,
          question: `Coding step "${step.title}" failed (${(res.error ?? "unknown error").slice(0, 300)}). How should I proceed?`,
        };
      }
      return { ok: true, output: res.output || "(no output)", question: null };
    }
    case "files": {
      const op = step.filesOp;
      const p = step.path?.trim();
      if (!op || !p) {
        return { ok: false, output: "", question: `Files step "${step.title}" is missing its op/path — what exactly should I touch?` };
      }
      let res;
      if (op === "read") {
        res = await filesSlot({ op: "read", path: p });
      } else if (op === "write") {
        const content = await llm().text([
          sysWithSkills(STEP_SYSTEM_PROMPT),
          user(buildWriteContentPrompt({ task, step, priorOutputs })),
        ]);
        res = await filesSlot({ op: "write", path: p, content });
      } else if (op === "glob") {
        res = await filesSlot({ op: "glob", dir: p, pattern: step.pattern ?? "*" });
      } else {
        res = await filesSlot({ op: "grep", dir: p, query: step.pattern ?? step.instruction });
      }
      if (!res?.ok) {
        return {
          ok: false,
          output: res?.output ?? "",
          question: `Files step "${step.title}" failed (${(res?.error ?? "unknown error").slice(0, 300)}). How should I proceed?`,
        };
      }
      return { ok: true, output: res.output || "(done)", question: null };
    }
  }
}

async function executePlan(task: Task, conv: Conversation, recallBlock: string | null): Promise<void> {
  const s = engineSettings();
  if (s.runMode === "sdk") {
    throw new Error("NOT_IMPLEMENTED: runMode 'sdk' lands with a later chunk (SPEC-B open question #1 seam).");
  }
  const planMd = task.planMd ?? task.title;
  let steps = readPlanSteps(task);

  if (steps.length > s.maxStepsPerRun) {
    appendTaskEvent(task.id, "step_cap_enforced", "system", {
      planned: steps.length,
      cap: s.maxStepsPerRun,
    });
    appendMessage(conv.id, {
      role: "assistant",
      content: `Plan has ${steps.length} steps; running the first ${s.maxStepsPerRun} (settings.tasks.maxStepsPerRun).`,
      userType: "system",
    });
    steps = steps.slice(0, s.maxStepsPerRun);
  }

  const deadline = Date.now() + s.runTimeoutMin * 60_000;
  const outputs: Array<{ title: string; output: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (Date.now() > deadline) {
      throw new Error(`run exceeded ${s.runTimeoutMin} min timeout at step ${i + 1}/${steps.length}`);
    }
    appendTaskEvent(task.id, "step_started", "agent", { index: i + 1, of: steps.length, title: step.title, kind: step.kind });
    const outcome = await runStep(task, planMd, step, i, steps.length, outputs, recallBlock);

    if (!outcome.ok) {
      appendTaskEvent(task.id, "step_fail", "agent", {
        index: i + 1,
        title: step.title,
        question: outcome.question,
      });
      appendMessage(conv.id, {
        role: "assistant",
        content: `Blocked at step ${i + 1}/${steps.length} (${step.title}):\n${outcome.question}`,
        userType: "system",
      });
      changeTaskStatus(task.id, "Waiting", "agent");
      emitAttention({
        kind: "task.blocked",
        severity: "warn",
        title: `Blocked: ${task.title || task.displayId}`,
        route: taskRoute(task),
        dedupeKey: `task-blocked-${task.id}`,
        taskId: task.id,
        displayId: task.displayId,
        question: outcome.question,
      });
      appendTaskEvent(task.id, "run_blocked", "agent", { step: i + 1, question: outcome.question });
      return;
    }

    outputs.push({ title: step.title, output: outcome.output });
    appendTaskEvent(task.id, "step_ok", "agent", {
      index: i + 1,
      of: steps.length,
      title: step.title,
      kind: step.kind,
      outputChars: outcome.output.length,
    });
    appendMessage(conv.id, {
      role: "assistant",
      content: `Step ${i + 1}/${steps.length} — ${step.title} [${step.kind}]\n${outcome.output.slice(0, 2000)}`,
      userType: "system",
    });
  }

  // Success → Review (agent-legal terminal) + result + summary message + ingest.
  let summary: string;
  try {
    summary = (
      await llm().text([sys(SUMMARY_SYSTEM_PROMPT), user(buildSummaryPrompt({ task, planMd, outputs }))])
    ).trim();
  } catch (err) {
    console.warn(`[v2/tasks] summary call failed for ${task.displayId}, using step tail:`, err);
    summary = outputs.map((o) => `${o.title}: ${o.output.slice(0, 300)}`).join("\n");
  }

  updateTask(task.id, { result: summary, error: null }, "agent");
  changeTaskStatus(task.id, "Review", "agent");
  appendMessage(conv.id, {
    role: "assistant",
    content: `Run complete — ready for review.\n\n${summary}`,
    userType: "system",
  });
  appendTaskEvent(task.id, "run_ok", "agent", { steps: outputs.length });
  emit("task.run", { taskId: task.id, displayId: task.displayId, status: "ok", steps: outputs.length }, "tasks");

  try {
    await ingestFromModule({
      episodeBody: `Task ${task.displayId} (${task.title || "untitled"}) run summary:\n${summary}`,
      source: "task",
      labelNames: ["task", task.displayId],
      sessionId: `task-${task.id}`,
      metadata: { taskId: task.id, displayId: task.displayId },
    });
  } catch (err) {
    console.warn(`[v2/tasks] memory ingest failed for ${task.displayId} (run still completed):`, err);
  }
}

// ---------------------------------------------------------------------------
// runTask — the claim → plan → execute pipeline
// ---------------------------------------------------------------------------

export interface RunTaskOptions {
  /** Stale-claim guard: skip when the task changed since this run was queued. */
  expectedUpdatedAt?: string;
  /** True for enqueueTask resumes (approve / chat-unblock / manual run-now). */
  immediate?: boolean;
}

export async function runTask(taskId: string, opts: RunTaskOptions = {}): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    console.warn(`[v2/tasks] runTask for unknown task '${taskId}' — skipping`);
    return;
  }
  if (!task.isActive || task.status === "Done") {
    appendTaskEvent(taskId, "run_skipped", "system", { reason: `status=${task.status} isActive=${task.isActive}` });
    return;
  }
  if (opts.expectedUpdatedAt && task.updatedAt !== opts.expectedUpdatedAt) {
    console.warn(
      `[v2/tasks] stale claim for ${task.displayId}: task changed since scheduling (expected ${opts.expectedUpdatedAt}, now ${task.updatedAt}) — skipping`,
    );
    appendTaskEvent(taskId, "run_skipped", "system", {
      reason: "stale claim: task changed since scheduling",
      expectedUpdatedAt: opts.expectedUpdatedAt,
      updatedAt: task.updatedAt,
    });
    return;
  }
  if (inFlight().has(taskId)) {
    console.warn(`[v2/tasks] ${task.displayId} already has a run in flight — skipping duplicate`);
    return;
  }

  inFlight().add(taskId);
  try {
    // If a plan is already drafted and unapproved, the task belongs in Waiting —
    // re-park + re-flag (dedupeKey keeps the Homepage item single) and stop.
    if (task.planStatus === "drafted") {
      if (task.status !== "Waiting") changeTaskStatus(taskId, "Waiting", "system");
      emitAttention({
        kind: "task.plan-approval",
        severity: "warn",
        title: `Plan ready: ${task.title || task.displayId}`,
        route: taskRoute(task),
        dedupeKey: `task-plan-${task.id}`,
        taskId: task.id,
        displayId: task.displayId,
      });
      appendTaskEvent(taskId, "run_skipped", "system", { reason: "plan awaiting approval" });
      return;
    }

    // Claim.
    changeTaskStatus(taskId, "Working", "system");
    emit("task.run", { taskId, displayId: task.displayId, status: "started" }, "tasks");

    const conv = resolveConversation(task, { immediate: !!opts.immediate });
    // Ephemeral trigger turn (REF skipUserMessage semantics: persisted for
    // audit with ephemeral=1, hidden in UI).
    appendMessage(conv.id, {
      role: "user",
      content: `Work on the task ${task.displayId}.`,
      userType: "system",
      ephemeral: true,
    });

    const recallBlock = await gatherRecall(task);

    try {
      const fresh = getTask(taskId)!;
      if (fresh.planStatus === "none" || fresh.planStatus === "rejected") {
        const verdict = await draftPlan(fresh, conv, recallBlock);
        if (verdict === "waiting") return; // human approves via approvePlan()
        await executePlan(getTask(taskId)!, conv, recallBlock);
      } else if (fresh.planStatus === "approved") {
        await executePlan(fresh, conv, recallBlock);
      }
    } catch (err) {
      // Crash/timeout path (REF markTaskFailed): Waiting + error + flag.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[v2/tasks] run failed for ${task.displayId}:`, msg);
      updateTask(taskId, { error: msg }, "agent");
      try {
        changeTaskStatus(taskId, "Waiting", "system");
      } catch {
        /* task may have been deleted mid-run */
      }
      appendMessage(conv.id, {
        role: "assistant",
        content: `[Error] ${now()}: ${msg}`,
        userType: "system",
      });
      appendTaskEvent(taskId, "run_fail", "system", { error: msg.slice(0, 1000) });
      emitAttention({
        kind: "task.blocked",
        severity: "warn",
        title: `Run failed: ${task.title || task.displayId}`,
        route: taskRoute(task),
        dedupeKey: `task-blocked-${task.id}`,
        taskId: task.id,
        displayId: task.displayId,
        question: `The run failed: ${msg.slice(0, 300)} — retry, or adjust the task?`,
      });
      emit("task.run", { taskId, displayId: task.displayId, status: "failed", error: msg.slice(0, 300) }, "tasks");
    }
  } finally {
    inFlight().delete(taskId);
  }
}

// ---------------------------------------------------------------------------
// Approval loop (user-side)
// ---------------------------------------------------------------------------

export interface ApprovePlanInput {
  /** Optional user-edited replacement for plan_md (steps keep the drafted set). */
  edits?: string;
  /** Optional note appended to the task conversation as a user turn. */
  note?: string;
}

export function approvePlan(taskId: string, input: ApprovePlanInput = {}): Task {
  const task = getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.planStatus !== "drafted") {
    throw new Error(`plan for ${task.displayId} is '${task.planStatus}', not 'drafted' — nothing to approve`);
  }

  if (input.edits !== undefined) updateTask(taskId, { planMd: input.edits }, "user");
  updateTask(taskId, { planStatus: "approved" }, "user");
  appendTaskEvent(taskId, "plan_approved", "user", { edited: input.edits !== undefined });

  if (input.note?.trim()) {
    const conv = getOrCreateTaskConversation(taskId, task.agentId ?? undefined);
    appendMessage(conv.id, { role: "user", content: input.note.trim(), userType: "human" });
  }

  // Status untouched (REF /approve semantics): the worker flips Working.
  const fresh = getTask(taskId)!;
  enqueueTask(taskId, { immediate: true, expectedUpdatedAt: fresh.updatedAt });
  return fresh;
}

export function rejectPlan(taskId: string, reason: string): Task {
  const task = getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.planStatus !== "drafted") {
    throw new Error(`plan for ${task.displayId} is '${task.planStatus}', not 'drafted' — nothing to reject`);
  }

  const metadata = { ...task.metadata };
  delete metadata.planSteps;
  updateTask(taskId, { planMd: null, planStatus: "none", metadata }, "user");
  appendTaskEvent(taskId, "plan_rejected", "user", { reason });

  const conv = getOrCreateTaskConversation(taskId, task.agentId ?? undefined);
  appendMessage(conv.id, {
    role: "user",
    content: `Plan rejected: ${reason}`,
    userType: "human",
  });
  return getTask(taskId)!;
}

/**
 * Chat-reply auto-unblock (REF checkWaitingTaskReply, verbatim-adapt): any
 * Waiting task whose conversation received a user reply flips to Ready
 * (actor user) — the Ready buffer then re-runs it. Called by B4's chat route.
 */
export function checkWaitingTaskReply(conversationId: string): number {
  const rows = getDb()
    .prepare(
      `SELECT t.id FROM v2_tasks t
       JOIN v2_conversations c ON c.task_id = t.id
       WHERE c.id = ? AND t.status = 'Waiting'`,
    )
    .all(conversationId) as { id: string }[];
  for (const r of rows) {
    changeTaskStatus(r.id, "Ready", "user");
    appendTaskEvent(r.id, "unblocked", "user", { via: "conversation reply", conversationId });
  }
  return rows.length;
}
