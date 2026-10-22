import { getDb } from "../db";
import { uuid, now } from "../ids";
import { readSettings } from "../../settings";
import { cliComplete, LOOP_CLI_AGENTS } from "../../loopEngine";
import {
  SLUG_RE,
  TOOL_NAME_RE,
  WebmcpError,
  createPackage,
  addTool,
  setPackageSpec,
  getPackage,
  type HandlerKind,
} from "./store";
import { WebmcpSpecSchema, type WebmcpSpec } from "./types";

/**
 * S7 — the WebMCP wizard (owner spec, 2026-09: "the builder should be a wizard,
 * not an input page").
 *
 *   describe  → the user writes what the server should do (vague or granular)
 *   clarify   → the model digests it in a scratchpad WITHOUT writing code and
 *               returns clarifying questions + a proposed tool list
 *               (name, one-job purpose, inputs, persona)
 *   approved  → the user edits/approves the list; nothing is emitted before this
 *   emitted   → only now the model emits the JSON spec (package + spec + tools,
 *               the exporter's shapes), gated by validateWizardSpec()
 *   apply     → the validated spec becomes a draft package in the builder
 *
 * Escape hatch ("own" mode): paste your own JSON; the agent only proofreads.
 * The verdict is "looks good" ONLY when the deterministic schema check passes
 * and the model found nothing either.
 *
 * Model seam: the WebMCP gear picks the agent (settings.webmcp.wizardAgent,
 * default claude) and the owner-chosen fallback (wizardFallback, default
 * codex, "none" = fail). Every reply labels who really answered
 * (provider / fellBackFrom / fallbackReason) — rule 20, never a silent swap.
 * `cli` is the test seam so the smoke never launches a billed agent.
 *
 * Drafts persist in webmcp_wizard_drafts (migration 044) so a refresh does
 * not lose the conversation. Discard archives (archived_at), never deletes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const WIZARD_MODES = ["wizard", "own"] as const;
export type WizardMode = (typeof WIZARD_MODES)[number];

export const WIZARD_STEPS = ["describe", "clarify", "approved", "emitted"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const INPUT_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export interface ProposedInput {
  name: string;
  type: InputType;
  description: string;
  required: boolean;
}

export interface ProposedTool {
  name: string;
  /** One job, one sentence. */
  purpose: string;
  inputs: ProposedInput[];
  /** Who uses it / which category it belongs to — the split key. */
  persona: string;
  requiresApproval: boolean;
}

export interface WizardProposal {
  serverName: string;
  slug: string;
  summary: string;
  /** The model's reasoning, kept for the user to read. Never code. */
  scratchpad: string;
  tools: ProposedTool[];
}

export interface WizardQuestion {
  id: string;
  question: string;
  answer: string;
}

/** The emitted tool shape: the store's ToolInput plus the persona split key. */
export interface WizardSpecTool {
  name: string;
  description: string;
  persona: string;
  inputSchema: Record<string, unknown>;
  handlerKind: Exclude<HandlerKind, "js">;
  handlerConfig: Record<string, unknown>;
  requiresApproval: boolean;
}

/** What the wizard emits: the exporter's package row + spec_json + draft tool set. */
export interface WizardSpec {
  package: { slug: string; name: string; description: string; icon?: string };
  spec: WebmcpSpec;
  tools: WizardSpecTool[];
}

export interface ModelRun {
  /** Who really answered ("claude", "codex", ...). */
  provider: string;
  fellBackFrom?: string;
  fallbackReason?: string;
  at: string;
}

export interface ProofreadResult {
  verdict: "looks good" | "problems";
  /** Concrete, actionable problems (schema first, then the model's). */
  problems: string[];
  /** Advisory notes from the model that are not blockers. */
  notes: string[];
  model: ModelRun | null;
}

export interface WizardDraft {
  id: string;
  mode: WizardMode;
  step: WizardStep;
  title: string;
  description: string;
  questions: WizardQuestion[];
  proposal: WizardProposal | null;
  spec: WizardSpec | null;
  /** Problems from the last emit attempt that failed validation (kept for the UI). */
  emitProblems: string[];
  /** "own" mode: the pasted JSON and its last proofread. */
  ownSpecText: string;
  proofread: ProofreadResult | null;
  lastModel: ModelRun | null;
  appliedSlug: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

// ---------------------------------------------------------------------------
// Model seam (rule 20: chosen fallback, labelled reply)
// ---------------------------------------------------------------------------

export type WizardCli = (agent: string, prompt: string, opts: { timeoutMs: number; module: string }) => Promise<string>;

/** Agents that answer one-shot through cliComplete (antigravity prints nothing to a pipe). */
export const WIZARD_AGENTS = LOOP_CLI_AGENTS.filter((a) => a !== "antigravity") as readonly string[];

export interface WizardAgents {
  agent: string;
  fallback: string;
}

/** The gear's choice, with the owner's stated defaults (claude, fallback codex). */
export function wizardAgents(s: { wizardAgent?: string; wizardFallback?: string } | undefined): WizardAgents {
  const pick = (v: string | undefined, d: string) => (v || "").trim().toLowerCase() || d;
  return { agent: pick(s?.wizardAgent, "claude"), fallback: pick(s?.wizardFallback, "codex") };
}

export interface RunOpts {
  cli?: WizardCli;
  agents?: WizardAgents;
  timeoutMs?: number;
}

function agentsFor(o: RunOpts): WizardAgents {
  return o.agents ?? wizardAgents(readSettings().webmcp as { wizardAgent?: string; wizardFallback?: string } | undefined);
}

async function runOne(agent: string, prompt: string, o: RunOpts): Promise<string> {
  if (!WIZARD_AGENTS.includes(agent)) {
    throw new WebmcpError(`"${agent}" is not a wizard agent (use one of: ${WIZARD_AGENTS.join(", ")})`, 400);
  }
  const run = o.cli ?? ((a, p, x) => cliComplete(a, p, x));
  return run(agent, prompt, { timeoutMs: o.timeoutMs ?? 240_000, module: "webmcp" });
}

/**
 * Run the prompt on the chosen agent; if it fails or answers nothing and the owner set
 * a different fallback, run that and SAY SO. Throws with every reason when nothing
 * answers — the caller surfaces the error, never a faked proposal.
 */
export async function runWizardModel(prompt: string, o: RunOpts = {}): Promise<{ text: string; model: ModelRun }> {
  const { agent, fallback } = agentsFor(o);
  let reason: string;
  try {
    const text = await runOne(agent, prompt, o);
    if (text.trim()) return { text, model: { provider: agent, at: now() } };
    reason = "returned nothing";
  } catch (e) {
    reason = String((e as Error)?.message || e).slice(0, 200);
  }
  if (!fallback || fallback === "none" || fallback === agent) {
    throw new WebmcpError(`${agent} failed: ${reason}${fallback === "none" ? " (no fallback set in the WebMCP gear)" : ""}`, 502);
  }
  let text: string;
  try {
    text = await runOne(fallback, prompt, o);
  } catch (e) {
    throw new WebmcpError(
      `${agent} failed: ${reason}; fallback ${fallback} failed too: ${String((e as Error)?.message || e).slice(0, 200)}`,
      502,
    );
  }
  if (!text.trim()) throw new WebmcpError(`${agent} failed: ${reason}; fallback ${fallback} returned nothing`, 502);
  return { text, model: { provider: fallback, fellBackFrom: agent, fallbackReason: reason, at: now() } };
}

/** Pull the first JSON object out of a CLI reply (fences and preamble tolerated). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new WebmcpError("the model reply carried no JSON object", 502);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new WebmcpError(`the model reply is not valid JSON: ${String((e as Error)?.message || e).slice(0, 120)}`, 502);
  }
}

// ---------------------------------------------------------------------------
// Validators (deterministic — the gate the model cannot talk its way past)
// ---------------------------------------------------------------------------

export const MIN_TOOLS = 5;
export const MAX_TOOLS = 10;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "one tool, one job": names that chain jobs and descriptions that list a second one. */
export function multiJobProblems(name: string, description: string): string[] {
  const out: string[] = [];
  if (/(^|[_.-])(and|or|then|plus)([_.-]|$)/i.test(name)) {
    out.push(`tool '${name}': the name chains two jobs — split it into one tool per job`);
  }
  if (/\b(and then|and also|as well as|in addition to|; then)\b/i.test(description)) {
    out.push(`tool '${name}': the description lists a second job ("${description.match(/\b(and then|and also|as well as|in addition to|; then)\b/i)![0]}") — one tool, one job`);
  }
  return out;
}

export interface ProposalCheck {
  ok: boolean;
  problems: string[];
  proposal?: WizardProposal;
}

/** Normalise + check a proposal (from the model or edited by the user). */
export function validateProposal(raw: unknown): ProposalCheck {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["proposal must be a JSON object"] };
  const serverName = str(raw.serverName) || str(raw.name);
  let slug = str(raw.slug).toLowerCase();
  if (!slug && serverName) slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!serverName) problems.push("proposal needs a serverName");
  if (!SLUG_RE.test(slug)) problems.push(`proposal slug '${slug}' is not kebab-case (${SLUG_RE.source})`);
  const toolsRaw = Array.isArray(raw.tools) ? raw.tools : null;
  if (!toolsRaw) problems.push("proposal needs a tools array");
  const tools: ProposedTool[] = [];
  const seen = new Set<string>();
  for (const [i, t] of (toolsRaw ?? []).entries()) {
    if (!isObj(t)) {
      problems.push(`tool #${i + 1} is not an object`);
      continue;
    }
    const name = str(t.name);
    const purpose = str(t.purpose) || str(t.description);
    const persona = str(t.persona) || str(t.category);
    if (!TOOL_NAME_RE.test(name)) problems.push(`tool #${i + 1}: name '${name}' is invalid (${TOOL_NAME_RE.source})`);
    if (seen.has(name.toLowerCase())) problems.push(`tool '${name}' is listed twice`);
    seen.add(name.toLowerCase());
    if (!purpose) problems.push(`tool '${name}': needs a one-sentence purpose`);
    if (!persona) problems.push(`tool '${name}': needs a persona/category (the split key)`);
    problems.push(...multiJobProblems(name, purpose));
    const inputs: ProposedInput[] = [];
    for (const [j, inp] of (Array.isArray(t.inputs) ? t.inputs : []).entries()) {
      if (!isObj(inp)) {
        problems.push(`tool '${name}': input #${j + 1} is not an object`);
        continue;
      }
      const iname = str(inp.name);
      const itype = str(inp.type).toLowerCase() as InputType;
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(iname)) problems.push(`tool '${name}': input name '${iname}' is invalid`);
      if (!INPUT_TYPES.includes(itype)) problems.push(`tool '${name}': input '${iname}' has unknown type '${String(inp.type)}'`);
      inputs.push({ name: iname, type: itype, description: str(inp.description), required: inp.required === true });
    }
    tools.push({ name, purpose, inputs, persona, requiresApproval: t.requiresApproval === true });
  }
  if (toolsRaw && (tools.length < 1 || tools.length > MAX_TOOLS)) {
    problems.push(`${tools.length} tools proposed: a server carries ${MIN_TOOLS}-${MAX_TOOLS}`);
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    problems: [],
    proposal: { serverName, slug, summary: str(raw.summary), scratchpad: str(raw.scratchpad), tools },
  };
}

export interface SpecCheck {
  ok: boolean;
  problems: string[];
  spec?: WizardSpec;
}

/**
 * The emitted-spec gate: exporter shapes (package row, strict spec_json, draft tool
 * set), 5-10 tools, one job per tool, a persona on every tool, no code (the wizard
 * never writes handlers — js is authored by hand in the Tools tab).
 */
export function validateWizardSpec(raw: unknown): SpecCheck {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["spec must be a JSON object with { package, spec, tools }"] };

  const pkgRaw = raw.package;
  let pkg: WizardSpec["package"] | null = null;
  if (!isObj(pkgRaw)) {
    problems.push("missing 'package' object ({ slug, name, description })");
  } else {
    const slug = str(pkgRaw.slug).toLowerCase();
    const name = str(pkgRaw.name);
    if (!SLUG_RE.test(slug)) problems.push(`package.slug '${slug}' is not kebab-case (${SLUG_RE.source})`);
    if (!name) problems.push("package.name is required");
    if (!str(pkgRaw.description)) problems.push("package.description is required (agents read it)");
    pkg = { slug, name, description: str(pkgRaw.description), ...(str(pkgRaw.icon) ? { icon: str(pkgRaw.icon) } : {}) };
  }

  let spec: WebmcpSpec = {};
  if (raw.spec !== undefined) {
    const parsed = WebmcpSpecSchema.safeParse(raw.spec);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 6)) {
        const keys = (issue as { keys?: unknown[] }).keys;
        const at = [...issue.path, ...(Array.isArray(keys) ? keys : [])].map(String).join(".");
        problems.push(`spec.${at || "(root)"}: ${issue.message}`);
      }
    } else {
      spec = parsed.data as WebmcpSpec;
    }
  }

  const toolsRaw = Array.isArray(raw.tools) ? raw.tools : null;
  const tools: WizardSpecTool[] = [];
  if (!toolsRaw) {
    problems.push("missing 'tools' array");
  } else {
    if (toolsRaw.length < MIN_TOOLS || toolsRaw.length > MAX_TOOLS) {
      problems.push(`${toolsRaw.length} tools: a server carries ${MIN_TOOLS}-${MAX_TOOLS} (${toolsRaw.length < MIN_TOOLS ? "add the missing jobs or fold this into another server" : "cut unused tools or split by persona into two servers"})`);
    }
    const seen = new Set<string>();
    for (const [i, t] of toolsRaw.entries()) {
      const label = `tool #${i + 1}`;
      if (!isObj(t)) {
        problems.push(`${label} is not an object`);
        continue;
      }
      const name = str(t.name);
      const description = str(t.description);
      const persona = str(t.persona) || str(t.category);
      if (!TOOL_NAME_RE.test(name)) problems.push(`${label}: name '${name}' is invalid (${TOOL_NAME_RE.source})`);
      if (seen.has(name.toLowerCase())) problems.push(`tool '${name}' appears twice`);
      seen.add(name.toLowerCase());
      if (!description) problems.push(`tool '${name || label}': description is required`);
      else if (description.length > 400) problems.push(`tool '${name}': description is ${description.length} chars — keep it under 400`);
      if (!persona) problems.push(`tool '${name || label}': persona is required (tools are split by persona/category)`);
      problems.push(...multiJobProblems(name, description));

      const schema = t.inputSchema;
      if (!isObj(schema)) problems.push(`tool '${name || label}': inputSchema must be a JSON Schema object`);
      else {
        if ((schema.type ?? "object") !== "object") problems.push(`tool '${name}': inputSchema.type must be "object"`);
        if (schema.properties !== undefined && !isObj(schema.properties)) problems.push(`tool '${name}': inputSchema.properties must be an object`);
        if (schema.required !== undefined && !Array.isArray(schema.required)) problems.push(`tool '${name}': inputSchema.required must be an array`);
        const props = isObj(schema.properties) ? schema.properties : {};
        for (const r of Array.isArray(schema.required) ? schema.required : []) {
          if (typeof r !== "string" || !(r in props)) problems.push(`tool '${name}': required field '${String(r)}' is not in properties`);
        }
      }

      const kind = str(t.handlerKind) || "internal";
      if (kind === "js") problems.push(`tool '${name}': handlerKind 'js' carries code — the wizard emits none; use 'http' or 'internal' and write js by hand in the Tools tab`);
      else if (kind !== "internal" && kind !== "http") problems.push(`tool '${name}': handlerKind '${kind}' is unknown (internal | http)`);
      const config = t.handlerConfig === undefined ? {} : t.handlerConfig;
      if (!isObj(config)) problems.push(`tool '${name}': handlerConfig must be an object`);
      else if (kind === "http" && !str(config.url)) problems.push(`tool '${name}': http handler needs a url`);

      tools.push({
        name,
        description,
        persona,
        inputSchema: isObj(schema) ? schema : { type: "object", properties: {} },
        handlerKind: kind === "http" ? "http" : "internal",
        handlerConfig: isObj(config) ? config : {},
        requiresApproval: t.requiresApproval === true,
      });
    }
  }

  if (problems.length || !pkg) return { ok: false, problems };
  return { ok: true, problems: [], spec: { package: pkg, spec, tools } };
}

/** Deterministic proposal → spec scaffold: the shape the model must fill in. */
export function proposalToSpecSkeleton(p: WizardProposal): WizardSpec {
  return {
    package: { slug: p.slug, name: p.serverName, description: p.summary },
    spec: { authKind: "none", mcpType: "stdio" },
    tools: p.tools.map((t) => ({
      name: t.name,
      description: t.purpose,
      persona: t.persona,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(t.inputs.map((i) => [i.name, { type: i.type, description: i.description }])),
        required: t.inputs.filter((i) => i.required).map((i) => i.name),
      },
      handlerKind: "internal",
      handlerConfig: {},
      requiresApproval: t.requiresApproval,
    })),
  };
}

// ---------------------------------------------------------------------------
// Prompts (no code is ever requested)
// ---------------------------------------------------------------------------

const RULES = `Best practices for a WebMCP server:
- 5 to 10 tools per server; one tool does ONE job; cut tools nobody would call.
- Tools are split by persona or category (who uses them); a server that serves two
  personas with many tools becomes two servers.
- Tool names: lowercase snake_case, verb_noun (e.g. list_invoices), no "and"/"or".
- Inputs: the smallest set that lets the tool do its job; mark required ones.
- Never write handler code. Describe WHAT the tool does, not HOW.`;

export function digestPrompt(d: WizardDraft): string {
  const answered = d.questions.filter((q) => q.answer.trim());
  const prior = d.proposal ? `\n\nYour previous proposal (revise it with the answers):\n${JSON.stringify(d.proposal, null, 2)}` : "";
  return `You are designing a WebMCP tool server. Reason in a scratchpad first, in prose, and write NO code.

The user's description:
"""
${d.description.trim()}
"""
${answered.length ? `\nThe user answered your earlier questions:\n${answered.map((q) => `Q: ${q.question}\nA: ${q.answer.trim()}`).join("\n")}` : ""}${prior}

${RULES}

Reply with ONE JSON object and nothing else:
{
  "scratchpad": "your reasoning: who the personas are, which jobs matter, what you cut and why",
  "questions": ["up to 6 short clarifying questions the user must answer before the list is final (empty if none)"],
  "serverName": "Display name",
  "slug": "kebab-case-slug",
  "summary": "one paragraph: what the server is for",
  "tools": [
    {
      "name": "verb_noun",
      "purpose": "one sentence, one job",
      "persona": "who uses it / category",
      "requiresApproval": false,
      "inputs": [{ "name": "field", "type": "string|number|integer|boolean|array|object", "description": "...", "required": true }]
    }
  ]
}`;
}

export function emitPrompt(p: WizardProposal): string {
  return `The user APPROVED this tool list for a WebMCP server. Emit the JSON spec for it now.

Approved proposal:
${JSON.stringify(p, null, 2)}

Target shape (fill it in, keep every approved tool, add none, write NO code):
${JSON.stringify(proposalToSpecSkeleton(p), null, 2)}

Rules:
- "package": { slug (kebab-case), name, description (what agents read), icon? }.
- "spec": only these keys: authKind ("none" | "api_key" | "oauth2" | "mcp"), mcpType ("stdio" | "http"),
  schedule { frequency }, configManifest [{ name, description, required }] — nothing else.
- "tools": ${MIN_TOOLS}-${MAX_TOOLS} entries, each { name, description, persona, inputSchema, handlerKind, handlerConfig, requiresApproval }.
  inputSchema is JSON Schema with type "object", properties and required.
  handlerKind is "internal" (handlerConfig: { action: "<registry action key>" }) or "http"
  (handlerConfig: { method, url, headers?, bodyTemplate? } using {{arg:NAME}} and {{secret:NAME}} placeholders).
  Never "js". Keep descriptions to one job each.

Reply with the JSON object only.`;
}

export function proofreadPrompt(specText: string): string {
  return `Proofread this WebMCP server spec. Do not rewrite it and write no code; report problems only.

${RULES}

The spec:
${specText.trim().slice(0, 60_000)}

Reply with ONE JSON object and nothing else:
{ "problems": ["concrete, actionable problems that should block publishing"], "notes": ["optional advisory remarks"] }
If there is nothing wrong, "problems" is an empty array.`;
}

// ---------------------------------------------------------------------------
// Persistence (webmcp_wizard_drafts, migration 044)
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string;
  mode: string;
  step: string;
  title: string;
  state_json: string;
  applied_slug: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

type DraftState = Pick<
  WizardDraft,
  "description" | "questions" | "proposal" | "spec" | "emitProblems" | "ownSpecText" | "proofread" | "lastModel"
>;

function rowToDraft(r: DraftRow): WizardDraft {
  let state: Partial<DraftState> = {};
  try {
    const v = JSON.parse(r.state_json);
    if (isObj(v)) state = v as Partial<DraftState>;
  } catch {
    /* an unreadable state row shows as empty, never throws the list */
  }
  return {
    id: r.id,
    mode: (WIZARD_MODES as readonly string[]).includes(r.mode) ? (r.mode as WizardMode) : "wizard",
    step: (WIZARD_STEPS as readonly string[]).includes(r.step) ? (r.step as WizardStep) : "describe",
    title: r.title,
    description: typeof state.description === "string" ? state.description : "",
    questions: Array.isArray(state.questions) ? state.questions : [],
    proposal: isObj(state.proposal) ? (state.proposal as unknown as WizardProposal) : null,
    spec: isObj(state.spec) ? (state.spec as unknown as WizardSpec) : null,
    emitProblems: Array.isArray(state.emitProblems) ? state.emitProblems : [],
    ownSpecText: typeof state.ownSpecText === "string" ? state.ownSpecText : "",
    proofread: isObj(state.proofread) ? (state.proofread as unknown as ProofreadResult) : null,
    lastModel: isObj(state.lastModel) ? (state.lastModel as unknown as ModelRun) : null,
    appliedSlug: r.applied_slug,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

function getRow(id: string): DraftRow | undefined {
  return getDb().prepare("SELECT * FROM webmcp_wizard_drafts WHERE id = ?").get(id) as DraftRow | undefined;
}

export function getDraft(id: string): WizardDraft | undefined {
  const r = getRow(id);
  return r ? rowToDraft(r) : undefined;
}

export function requireDraft(id: string): WizardDraft {
  const d = getDraft(id);
  if (!d) throw new WebmcpError("wizard draft not found", 404);
  if (d.archivedAt) throw new WebmcpError("this wizard draft was discarded", 409);
  return d;
}

export function listDrafts(opts: { includeArchived?: boolean } = {}): WizardDraft[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM webmcp_wizard_drafts ${opts.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC LIMIT 200`,
    )
    .all() as DraftRow[];
  return rows.map(rowToDraft);
}

function titleFrom(description: string, mode: WizardMode): string {
  const first = description.trim().split(/\n/)[0]?.trim() ?? "";
  if (first) return first.length > 60 ? `${first.slice(0, 57)}...` : first;
  return mode === "own" ? "Write my own JSON" : "Untitled wizard";
}

export function createDraft(input: { mode?: WizardMode; description?: string }): WizardDraft {
  const mode: WizardMode = input.mode === "own" ? "own" : "wizard";
  const description = typeof input.description === "string" ? input.description : "";
  const id = uuid();
  const ts = now();
  const state: DraftState = {
    description,
    questions: [],
    proposal: null,
    spec: null,
    emitProblems: [],
    ownSpecText: "",
    proofread: null,
    lastModel: null,
  };
  getDb()
    .prepare(
      `INSERT INTO webmcp_wizard_drafts(id, mode, step, title, state_json, applied_slug, created_at, updated_at, archived_at)
       VALUES (?, ?, 'describe', ?, ?, NULL, ?, ?, NULL)`,
    )
    .run(id, mode, titleFrom(description, mode), JSON.stringify(state), ts, ts);
  return getDraft(id)!;
}

function saveDraft(d: WizardDraft): WizardDraft {
  const state: DraftState = {
    description: d.description,
    questions: d.questions,
    proposal: d.proposal,
    spec: d.spec,
    emitProblems: d.emitProblems,
    ownSpecText: d.ownSpecText,
    proofread: d.proofread,
    lastModel: d.lastModel,
  };
  const ts = now();
  getDb()
    .prepare(
      `UPDATE webmcp_wizard_drafts SET step = ?, title = ?, state_json = ?, applied_slug = ?, updated_at = ? WHERE id = ?`,
    )
    .run(d.step, titleFrom(d.description, d.mode), JSON.stringify(state), d.appliedSlug, ts, d.id);
  return getDraft(d.id)!;
}

/** Discard = archive. Rows are kept (rule: never delete). */
export function discardDraft(id: string): WizardDraft {
  requireDraft(id);
  getDb().prepare("UPDATE webmcp_wizard_drafts SET archived_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  return getDraft(id)!;
}

export interface DraftPatch {
  description?: string;
  /** question id → answer */
  answers?: Record<string, string>;
  proposal?: unknown;
  ownSpecText?: string;
}

/**
 * User edits between model calls. Editing the description or the list after approval
 * reopens the draft at 'clarify' (the emitted spec is dropped: it no longer matches).
 */
export function updateDraft(id: string, patch: DraftPatch): WizardDraft {
  const d = requireDraft(id);
  let reopened = false;
  if (typeof patch.description === "string" && patch.description !== d.description) {
    d.description = patch.description;
    if (d.step === "approved" || d.step === "emitted") reopened = true;
  }
  if (patch.answers && isObj(patch.answers)) {
    for (const q of d.questions) {
      if (typeof patch.answers[q.id] === "string") q.answer = patch.answers[q.id];
    }
  }
  if (patch.proposal !== undefined) {
    const check = validateProposal(patch.proposal);
    if (!check.ok) throw new WebmcpError(`proposal: ${check.problems.join("; ")}`, 400);
    d.proposal = check.proposal!;
    if (d.step === "describe") d.step = "clarify";
    if (d.step === "approved" || d.step === "emitted") reopened = true;
  }
  if (typeof patch.ownSpecText === "string") {
    if (patch.ownSpecText !== d.ownSpecText) d.proofread = null;
    d.ownSpecText = patch.ownSpecText;
  }
  if (reopened) {
    d.step = "clarify";
    d.spec = null;
    d.emitProblems = [];
  }
  return saveDraft(d);
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** Step 2: digest the description (and any answers) → questions + proposal. No JSON spec yet. */
export async function digestDraft(id: string, o: RunOpts = {}): Promise<WizardDraft> {
  const d = requireDraft(id);
  if (d.mode !== "wizard") throw new WebmcpError("digest is a wizard-mode step; this draft is 'write my own'", 409);
  if (!d.description.trim()) throw new WebmcpError("describe what the server should do first", 400);
  const { text, model } = await runWizardModel(digestPrompt(d), o);
  const raw = extractJson(text);
  const check = validateProposal(raw);
  if (!check.ok) {
    throw new WebmcpError(`the model's proposal did not pass the checks: ${check.problems.slice(0, 5).join("; ")}`, 502);
  }
  const qs = isObj(raw) && Array.isArray(raw.questions) ? raw.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 8) : [];
  // Keep answers the user already typed for a question the model asked again.
  const prior = new Map(d.questions.map((q) => [q.question.trim().toLowerCase(), q]));
  d.questions = qs.map((q) => {
    const old = prior.get(q.trim().toLowerCase());
    return old ? { ...old, question: q.trim() } : { id: uuid(), question: q.trim(), answer: "" };
  });
  d.proposal = check.proposal!;
  d.lastModel = model;
  d.step = "clarify";
  d.spec = null;
  d.emitProblems = [];
  return saveDraft(d);
}

/** Step 3: the user approves (optionally with an edited list). Nothing is emitted here. */
export function approveDraft(id: string, proposal?: unknown): WizardDraft {
  const d = requireDraft(id);
  if (d.mode !== "wizard") throw new WebmcpError("approve is a wizard-mode step", 409);
  if (proposal !== undefined) {
    const check = validateProposal(proposal);
    if (!check.ok) throw new WebmcpError(`proposal: ${check.problems.join("; ")}`, 400);
    d.proposal = check.proposal!;
  }
  if (!d.proposal) throw new WebmcpError("nothing to approve yet — run the digest first", 409);
  if (d.proposal.tools.length < MIN_TOOLS) {
    throw new WebmcpError(`the list has ${d.proposal.tools.length} tool(s); a server carries ${MIN_TOOLS}-${MAX_TOOLS} — add the missing jobs before approving`, 400);
  }
  d.step = "approved";
  d.spec = null;
  d.emitProblems = [];
  return saveDraft(d);
}

/** Back to editing the list. */
export function reopenDraft(id: string): WizardDraft {
  const d = requireDraft(id);
  if (d.mode !== "wizard") throw new WebmcpError("reopen is a wizard-mode step", 409);
  if (!d.proposal) throw new WebmcpError("nothing to reopen", 409);
  d.step = "clarify";
  d.spec = null;
  d.emitProblems = [];
  return saveDraft(d);
}

/** Step 4: ONLY after approval the model emits the JSON spec; validateWizardSpec() gates it. */
export async function emitDraft(id: string, o: RunOpts = {}): Promise<WizardDraft> {
  const d = requireDraft(id);
  if (d.mode !== "wizard") throw new WebmcpError("emit is a wizard-mode step", 409);
  if (d.step !== "approved" && d.step !== "emitted") {
    throw new WebmcpError("approve the tool list before emitting JSON", 409);
  }
  if (!d.proposal) throw new WebmcpError("no approved proposal on this draft", 409);
  const { text, model } = await runWizardModel(emitPrompt(d.proposal), o);
  const raw = extractJson(text);
  const check = validateWizardSpec(raw);
  d.lastModel = model;
  if (!check.ok) {
    d.emitProblems = check.problems;
    d.spec = null;
    d.step = "approved";
    saveDraft(d);
    throw new WebmcpError(`the emitted spec failed validation: ${check.problems.slice(0, 4).join("; ")}${check.problems.length > 4 ? ` (+${check.problems.length - 4} more)` : ""}`, 422);
  }
  // Every approved tool must survive the emit (the model may add none, drop none).
  const approved = new Set(d.proposal.tools.map((t) => t.name.toLowerCase()));
  const emitted = new Set(check.spec!.tools.map((t) => t.name.toLowerCase()));
  const missing = [...approved].filter((n) => !emitted.has(n));
  const extra = [...emitted].filter((n) => !approved.has(n));
  if (missing.length || extra.length) {
    d.emitProblems = [
      ...missing.map((n) => `approved tool '${n}' is missing from the emitted spec`),
      ...extra.map((n) => `tool '${n}' was not in the approved list`),
    ];
    d.spec = null;
    d.step = "approved";
    saveDraft(d);
    throw new WebmcpError(`the emitted spec drifted from the approved list: ${d.emitProblems.join("; ")}`, 422);
  }
  d.spec = check.spec!;
  d.emitProblems = [];
  d.step = "emitted";
  return saveDraft(d);
}

/** Proofread (own mode, or any pasted JSON): schema problems first; the model only when the schema passes. */
export async function proofreadSpecText(text: string, o: RunOpts = {}): Promise<ProofreadResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      verdict: "problems",
      problems: [`not valid JSON: ${String((e as Error)?.message || e).slice(0, 160)}`],
      notes: [],
      model: null,
    };
  }
  const check = validateWizardSpec(raw);
  if (!check.ok) return { verdict: "problems", problems: check.problems, notes: [], model: null };
  const { text: reply, model } = await runWizardModel(proofreadPrompt(JSON.stringify(check.spec, null, 2)), o);
  const parsed = extractJson(reply);
  const problems = isObj(parsed) && Array.isArray(parsed.problems) ? parsed.problems.filter((p): p is string => typeof p === "string" && p.trim().length > 0) : [];
  const notes = isObj(parsed) && Array.isArray(parsed.notes) ? parsed.notes.filter((p): p is string => typeof p === "string" && p.trim().length > 0) : [];
  return { verdict: problems.length ? "problems" : "looks good", problems, notes, model };
}

/** Own-mode draft: store the pasted text and its proofread so a refresh keeps both. */
export async function proofreadDraft(id: string, text: string | undefined, o: RunOpts = {}): Promise<WizardDraft> {
  const d = requireDraft(id);
  if (typeof text === "string") d.ownSpecText = text;
  if (!d.ownSpecText.trim()) throw new WebmcpError("paste a spec to proofread first", 400);
  d.proofread = await proofreadSpecText(d.ownSpecText, o);
  d.lastModel = d.proofread.model ?? d.lastModel;
  return saveDraft(d);
}

/** Step 5: a validated spec becomes a draft package + tool set in the builder. */
export function applyDraft(id: string, opts: { slug?: string } = {}): { draft: WizardDraft; slug: string } {
  const d = requireDraft(id);
  let spec: WizardSpec | null = d.spec;
  if (d.mode === "own") {
    if (!d.ownSpecText.trim()) throw new WebmcpError("paste a spec first", 400);
    let raw: unknown;
    try {
      raw = JSON.parse(d.ownSpecText);
    } catch {
      throw new WebmcpError("the pasted spec is not valid JSON", 400);
    }
    const check = validateWizardSpec(raw);
    if (!check.ok) throw new WebmcpError(`the spec has problems: ${check.problems.slice(0, 4).join("; ")}`, 422);
    spec = check.spec!;
  }
  if (!spec) throw new WebmcpError("emit the JSON spec before creating the package", 409);
  const slug = (opts.slug ?? spec.package.slug).trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new WebmcpError(`invalid slug '${slug}'`, 400);
  if (getPackage(slug)) throw new WebmcpError(`slug '${slug}' is taken — pick another`, 409);
  createPackage({ slug, name: spec.package.name, description: spec.package.description, icon: spec.package.icon });
  setPackageSpec(slug, spec.spec);
  spec.tools.forEach((t, i) => {
    addTool(slug, {
      name: t.name,
      description: t.persona ? `${t.description} [${t.persona}]` : t.description,
      inputSchema: t.inputSchema,
      handlerKind: t.handlerKind,
      handlerConfig: t.handlerConfig,
      requiresApproval: t.requiresApproval,
      position: i,
    });
  });
  d.appliedSlug = slug;
  return { draft: saveDraft(d), slug };
}
