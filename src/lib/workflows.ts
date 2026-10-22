// Workflows (S14, _design/jarvis-v3-plan.md): saved, runnable recipes, one click
// from any module. A workflow is plain data: a name, a prompt template, an optional
// input the user supplies at run time, and the agent that runs it. Which workflows
// are switched on where lives beside them (global + per module), so a module's
// Skills & Workflows pop-up shows the ones on for it.
//
// Storage: ~/.agentic-os/workflows/workflows.json (AGENTIC_OS_WORKFLOWS_DIR for
// smokes), written atomically (tmp + rename). Nothing is ever deleted: retiring a
// workflow moves it to `retired` with a timestamp, and it can be brought back.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Prompt template. `{{input}}` is replaced by the run-time input. */
  prompt: string;
  /** When set, the run asks for this input and refuses to run without it. */
  inputLabel?: string;
  /** CLI agent id that runs it (claude, codex, cursor, pi, hermes). */
  agent: string;
  createdAt: string;
  updatedAt: string;
}

interface Store {
  version: 1;
  workflows: Workflow[];
  retired: Array<Workflow & { retiredAt: string }>;
  active: { global: string[]; modules: Record<string, string[]> };
}

export function workflowsDir(): string {
  return process.env.AGENTIC_OS_WORKFLOWS_DIR || path.join(os.homedir(), ".agentic-os", "workflows");
}
const file = () => path.join(workflowsDir(), "workflows.json");

const nowIso = () => new Date().toISOString();

/** Three generic starters that use ONLY what the user hands them, so none of them
 *  pretends to read an inbox or a calendar it cannot see. Editable like any other. */
function seed(): Store {
  const t = nowIso();
  const mk = (id: string, name: string, description: string, prompt: string, inputLabel?: string): Workflow =>
    ({ id, name, description, prompt, inputLabel, agent: "claude", createdAt: t, updatedAt: t });
  return {
    version: 1,
    workflows: [
      mk("summarize", "Summarize", "Condense text you paste into the key points and any decisions or asks.",
        "Summarize the following for a busy operator. Lead with the one-line gist, then the key points, then any decisions, deadlines or asks it contains. Say plainly if something is unclear.\n\n{{input}}",
        "Text to summarize"),
      mk("draft-reply", "Draft a reply", "Write a reply to a message you paste, in a plain, direct voice.",
        "Draft a reply to the message below. Plain, direct, warm; no filler, no em dashes. If the message asks something you cannot know, leave a clear [placeholder] instead of guessing.\n\n{{input}}",
        "The message to reply to"),
      mk("research-brief", "Research brief", "A sourced brief on a topic, with what is known, what is contested, and what to do next.",
        "Write a research brief on: {{input}}\n\nUse current sources and cite them. Separate what is well established from what is contested or unknown. End with three concrete next steps. Never invent a source, number or quote; if you cannot verify something, say so.",
        "Topic"),
    ],
    retired: [],
    active: { global: [], modules: {} },
  };
}

function load(): Store {
  if (!existsSync(file())) return seed();
  try {
    const s = JSON.parse(readFileSync(file(), "utf8")) as Partial<Store>;
    return {
      version: 1,
      workflows: Array.isArray(s.workflows) ? s.workflows : [],
      retired: Array.isArray(s.retired) ? s.retired : [],
      active: {
        global: Array.isArray(s.active?.global) ? s.active!.global : [],
        modules: s.active?.modules && typeof s.active.modules === "object" ? s.active.modules : {},
      },
    };
  } catch (e) {
    // A corrupt file is an error to see, not a reason to hand back an empty store
    // and overwrite the owner's workflows on the next save.
    throw new Error(`workflows.json is unreadable (${(e as Error).message}); fix or move ${file()}`);
  }
}

function save(s: Store): void {
  mkdirSync(workflowsDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  renameSync(tmp, file());
}

export class WorkflowError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workflow";
const AGENT_RE = /^[a-z0-9-]{2,24}$/;

function validate(input: { name?: unknown; description?: unknown; prompt?: unknown; inputLabel?: unknown; agent?: unknown }, partial = false) {
  const out: Partial<Workflow> = {};
  if (input.name !== undefined || !partial) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 60) throw new WorkflowError("name is required, 1 to 60 characters");
    out.name = input.name.trim();
  }
  if (input.prompt !== undefined || !partial) {
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 20_000) throw new WorkflowError("prompt is required, up to 20000 characters");
    out.prompt = input.prompt;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 300) throw new WorkflowError("description must be text up to 300 characters");
    out.description = input.description.trim();
  }
  if (input.inputLabel !== undefined) {
    if (input.inputLabel !== null && (typeof input.inputLabel !== "string" || input.inputLabel.length > 80)) throw new WorkflowError("inputLabel must be text up to 80 characters");
    out.inputLabel = typeof input.inputLabel === "string" && input.inputLabel.trim() ? input.inputLabel.trim() : undefined;
  }
  if (input.agent !== undefined || !partial) {
    const agent = input.agent === undefined ? "claude" : input.agent;
    if (typeof agent !== "string" || !AGENT_RE.test(agent)) throw new WorkflowError("agent must be a CLI agent id such as claude, codex, cursor, pi or hermes");
    out.agent = agent;
  }
  return out;
}

export function listWorkflows(): Workflow[] { return load().workflows; }
export function listRetiredWorkflows(): Array<Workflow & { retiredAt: string }> { return load().retired; }
export function getWorkflow(id: string): Workflow | null { return load().workflows.find((w) => w.id === id) ?? null; }

export function createWorkflow(input: Record<string, unknown>): Workflow {
  const v = validate(input);
  const s = load();
  let id = slug(v.name!);
  for (let n = 2; s.workflows.some((w) => w.id === id) || s.retired.some((w) => w.id === id); n++) id = `${slug(v.name!)}-${n}`;
  const t = nowIso();
  const wf: Workflow = { id, name: v.name!, description: v.description ?? "", prompt: v.prompt!, inputLabel: v.inputLabel, agent: v.agent!, createdAt: t, updatedAt: t };
  s.workflows.push(wf);
  save(s);
  return wf;
}

export function updateWorkflow(id: string, patch: Record<string, unknown>): Workflow {
  const s = load();
  const i = s.workflows.findIndex((w) => w.id === id);
  if (i < 0) throw new WorkflowError("workflow not found", 404);
  const v = validate(patch, true);
  s.workflows[i] = { ...s.workflows[i], ...v, updatedAt: nowIso() };
  save(s);
  return s.workflows[i];
}

/** Retire, never delete: the record moves to `retired` and its activations are cleared. */
export function retireWorkflow(id: string): void {
  const s = load();
  const i = s.workflows.findIndex((w) => w.id === id);
  if (i < 0) throw new WorkflowError("workflow not found", 404);
  const [wf] = s.workflows.splice(i, 1);
  s.retired.push({ ...wf, retiredAt: nowIso() });
  s.active.global = s.active.global.filter((x) => x !== id);
  for (const m of Object.keys(s.active.modules)) {
    s.active.modules[m] = s.active.modules[m].filter((x) => x !== id);
    if (s.active.modules[m].length === 0) delete s.active.modules[m]; // same shape as switching off
  }
  save(s);
}

export function restoreWorkflow(id: string): Workflow {
  const s = load();
  const i = s.retired.findIndex((w) => w.id === id);
  if (i < 0) throw new WorkflowError("no retired workflow with that id", 404);
  const [r] = s.retired.splice(i, 1);
  const { retiredAt: _drop, ...wf } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  s.workflows.push({ ...wf, updatedAt: nowIso() });
  save(s);
  return wf;
}

/** scope "*" = every module. */
export function setWorkflowActive(id: string, scope: string, active: boolean): void {
  const s = load();
  if (!s.workflows.some((w) => w.id === id)) throw new WorkflowError("workflow not found", 404);
  const list = scope === "*" ? s.active.global : (s.active.modules[scope] ??= []);
  const has = list.includes(id);
  if (active && !has) list.push(id);
  if (!active && has) list.splice(list.indexOf(id), 1);
  if (scope !== "*" && s.active.modules[scope].length === 0) delete s.active.modules[scope];
  save(s);
}

export function workflowActivation(): Store["active"] { return load().active; }

export function activeWorkflowIds(module: string): { here: string[]; global: string[] } {
  const a = load().active;
  return { here: a.modules[module] ?? [], global: a.global };
}

/** The prompt that actually runs. Refuses when the workflow needs input and got none. */
export function fillPrompt(wf: Workflow, input: string | undefined): string {
  const text = (input ?? "").trim();
  if (wf.inputLabel && !text) throw new WorkflowError(`"${wf.name}" needs: ${wf.inputLabel}`);
  if (wf.prompt.includes("{{input}}")) return wf.prompt.split("{{input}}").join(text);
  return text ? `${wf.prompt}\n\nInput:\n${text}` : wf.prompt;
}
