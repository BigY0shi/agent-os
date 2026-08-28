import { getDb } from "../db";
import { uuid, now } from "../ids";
import { on, emit } from "../events";
import type { V2Event } from "../eventTypes";
import { readSettings } from "../../settings";
import { getActivity, getAccount, type AccountRow } from "../integrations/store";
import { getTools, callTool } from "../integrations/runtime";
import { listConnectors } from "../integrations/registry";
import { upsertByDedupeKey } from "../attention/store";
import { createTask } from "../tasks/store";
import {
  CONDITION_OPS,
  ACTION_KINDS,
  type ActionResultDetail,
  type AutomationAction,
  type AutomationRule,
  type AutomationRunRow,
  type AutomationRunStatus,
  type ConditionResult,
  type RuleCondition,
  type RunToolAction,
  type TriggerOption,
} from "./types";

/**
 * SPEC-D G5.1/G5.4 — the automations engine.
 *
 * Trigger model: the engine subscribes to '*' on the v2 bus. For
 * 'activity.created' events the trigger key is the ACTIVITY's eventType
 * (GMAIL_MESSAGE_RECEIVED, ...); for every other bus event the trigger key is
 * the event type itself (sync.failed, task.created, any string). A rule's
 * trigger_slug scopes it to a connector; '', '*' and 'system' match anything
 * (documented: trigger events are already connector-scoped keys).
 *
 * Determinism (§8 risk 11, BINDING): conditions are whitelisted string ops,
 * templates are {{path}} string substitution — NO eval, NO Function
 * constructor, NO LLM anywhere in this module. Regex conditions pass a
 * complexity guard (length cap + nested-quantifier rejection) so a
 * pathological pattern is REFUSED at save and evaluates to a fast false if
 * forced into the DB — it can never hang the engine.
 *
 * Loop guard: events emitted with source 'automation' (the notify action) do
 * not trigger rules — rule chains cannot recurse.
 *
 * run_tool destructive gate (G5.4): validateRuleInput 422s a run_tool action
 * on a destructive-annotated tool without confirmDestructive:true, and
 * executeAction RE-CHECKS the annotation at fire time (rows forced into the DB
 * refuse with action_failed). With confirm, execution goes straight through
 * runtime.callTool (source 'automation:<ruleId>') — automations are
 * pre-authorized by the confirm checkbox, NEVER routed through the Human-Gate
 * (a pending approval on a background rule would just rot).
 *
 * automation_runs discipline: condition_miss rows are recorded ONLY when the
 * trigger matched but conditions failed; a non-matching trigger writes nothing.
 */

export class AutomationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AutomationError";
    this.status = status;
  }
}

// ─── Rule store ──────────────────────────────────────────────────────────────

interface RuleDbRow {
  id: string;
  name: string;
  trigger_slug: string;
  trigger_event: string;
  conditions_json: string;
  actions_json: string;
  is_active: number;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
}

function ruleFromDb(r: RuleDbRow): AutomationRule {
  return {
    id: r.id,
    name: r.name,
    triggerSlug: r.trigger_slug,
    triggerEvent: r.trigger_event,
    conditions: safeParseArr(r.conditions_json) as RuleCondition[],
    actions: safeParseArr(r.actions_json) as AutomationAction[],
    isActive: r.is_active === 1,
    lastFiredAt: r.last_fired_at,
    fireCount: r.fire_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface RuleInput {
  name: string;
  triggerSlug?: string;
  triggerEvent: string;
  conditions?: RuleCondition[];
  actions: AutomationAction[];
  isActive?: boolean;
}

/** Dumb insert — routes go through validateRuleInput first. */
export function createRule(input: RuleInput): AutomationRule {
  const id = uuid();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO automation_rules
         (id, name, trigger_slug, trigger_event, conditions_json, actions_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.triggerSlug ?? "system",
      input.triggerEvent,
      JSON.stringify(input.conditions ?? []),
      JSON.stringify(input.actions),
      input.isActive === false ? 0 : 1,
      ts,
      ts,
    );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<RuleInput>): AutomationRule {
  const current = getRule(id);
  if (!current) throw new AutomationError(`rule ${id} not found`, 404);
  getDb()
    .prepare(
      `UPDATE automation_rules
       SET name = ?, trigger_slug = ?, trigger_event = ?, conditions_json = ?, actions_json = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? current.name,
      patch.triggerSlug ?? current.triggerSlug,
      patch.triggerEvent ?? current.triggerEvent,
      JSON.stringify(patch.conditions ?? current.conditions),
      JSON.stringify(patch.actions ?? current.actions),
      (patch.isActive ?? current.isActive) ? 1 : 0,
      now(),
      id,
    );
  return getRule(id)!;
}

/** DELETE = deactivate (house rule: rows retained, never destroyed). */
export function deactivateRule(id: string): AutomationRule {
  return updateRule(id, { isActive: false });
}

export function getRule(id: string): AutomationRule | null {
  const r = getDb().prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) as
    | RuleDbRow
    | undefined;
  return r ? ruleFromDb(r) : null;
}

export function listRules(opts: { activeOnly?: boolean } = {}): AutomationRule[] {
  const rows = (
    opts.activeOnly
      ? getDb().prepare("SELECT * FROM automation_rules WHERE is_active = 1 ORDER BY created_at").all()
      : getDb().prepare("SELECT * FROM automation_rules ORDER BY created_at").all()
  ) as RuleDbRow[];
  return rows.map(ruleFromDb);
}

// ─── Runs ────────────────────────────────────────────────────────────────────

interface RunDbRow {
  id: string;
  rule_id: string;
  activity_id: string | null;
  event_id: number | null;
  trigger_json: string;
  status: string;
  detail_json: string | null;
  error: string | null;
  created_at: string;
}

function runFromDb(r: RunDbRow): AutomationRunRow {
  let detail: AutomationRunRow["detail"] = null;
  if (r.detail_json) {
    try {
      detail = JSON.parse(r.detail_json) as AutomationRunRow["detail"];
    } catch {
      /* tolerated */
    }
  }
  return {
    id: r.id,
    ruleId: r.rule_id,
    activityId: r.activity_id,
    eventId: r.event_id ?? null,
    trigger: safeParseObj(r.trigger_json),
    status: r.status as AutomationRunStatus,
    detail,
    error: r.error,
    createdAt: r.created_at,
  };
}

const DETAIL_CAP = 8192;

function insertRun(input: {
  ruleId: string;
  activityId?: string | null;
  eventId?: number | null;
  trigger: Record<string, unknown>;
  status: AutomationRunStatus;
  detail?: AutomationRunRow["detail"];
  error?: string;
}): string {
  const id = uuid();
  let triggerJson = JSON.stringify(input.trigger ?? {});
  if (triggerJson.length > DETAIL_CAP) triggerJson = JSON.stringify({ truncated: true });
  let detailJson = input.detail ? JSON.stringify(input.detail) : null;
  if (detailJson && detailJson.length > DETAIL_CAP) detailJson = JSON.stringify({ truncated: true });
  // OR IGNORE: UNIQUE(rule_id, event_id) is the replay backstop (item 12) —
  // a concurrent/replayed insert for the same (rule, event) is a no-op.
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO automation_runs (id, rule_id, activity_id, event_id, trigger_json, status, detail_json, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.ruleId, input.activityId ?? null, input.eventId ?? null, triggerJson, input.status, detailJson, input.error ?? null, now());
  return id;
}

/** True when this (rule, event) pair already produced a run (item 12). */
function hasRunForEvent(ruleId: string, eventId: number): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM automation_runs WHERE rule_id = ? AND event_id = ? LIMIT 1")
    .get(ruleId, eventId);
}

export function listRuns(opts: { ruleId?: string; limit?: number } = {}): AutomationRunRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = (
    opts.ruleId
      ? getDb()
          .prepare("SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(opts.ruleId, limit)
      : getDb().prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?").all(limit)
  ) as RunDbRow[];
  return rows.map(runFromDb);
}

// ─── Regex complexity guard (NO timeouts possible in-thread — refuse instead) ─

const REGEX_MAX_PATTERN = 200;
const REGEX_MAX_INPUT = 5000;

/**
 * Rejects patterns that can backtrack catastrophically: length-capped, and any
 * quantified group whose body itself contains a quantifier or an alternation
 * (the (a+)+ / (a|aa)* families). Conservative by design — a rejected safe
 * pattern is an inconvenience; an accepted pathological one hangs the process.
 * Throws AutomationError(422).
 */
export function guardRegexPattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new AutomationError("regex condition needs a non-empty pattern", 422);
  }
  if (pattern.length > REGEX_MAX_PATTERN) {
    throw new AutomationError(`regex pattern too long (max ${REGEX_MAX_PATTERN} chars)`, 422);
  }
  // Find every group and check: group body has quantifier/alternation AND the
  // group itself is followed by a quantifier → nested quantification → reject.
  const stack: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") stack.push(i);
    else if (ch === ")") {
      const open = stack.pop();
      if (open === undefined) continue; // syntax error — RegExp ctor will throw below
      // Strip the group-type marker ((?:…), lookarounds, named groups) so the
      // marker's own '?'/'<'/'=' never counts as a quantifier.
      const body = pattern
        .slice(open + 1, i)
        .replace(/^\?(?::|=|!|<=|<!|<[a-zA-Z_][a-zA-Z0-9_]*>)/, "");
      const next = pattern[i + 1];
      const quantified = next === "*" || next === "+" || next === "?" || next === "{";
      if (quantified && /[*+{|?]/.test(body.replace(/\\./g, ""))) {
        throw new AutomationError(
          "regex pattern rejected: quantified group containing a quantifier/alternation can backtrack catastrophically",
          422,
        );
      }
    }
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, "i");
  } catch (err) {
    throw new AutomationError(`invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`, 422);
  }
}

// ─── {{path}} template substitution — STRING ops only, no eval ───────────────

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g;

/** Missing paths substitute the EMPTY STRING (documented missing-path behavior). */
export function substituteTemplates(template: string, ctx: Record<string, unknown>): string {
  return template.replace(TEMPLATE_RE, (_m, path: string) => toStr(resolvePath(ctx, path)));
}

/**
 * Deep-substitute an args template. A string that is EXACTLY one placeholder
 * resolves to the RAW value (arrays/numbers pass through for tools that expect
 * them, e.g. gmail 'to'); any other string gets interpolation; non-strings
 * recurse. Still pure data transformation — no eval.
 */
export function substituteArgsTemplate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}$/);
    if (exact) {
      const resolved = resolvePath(ctx, exact[1]);
      return resolved === undefined ? "" : resolved;
    }
    return substituteTemplates(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => substituteArgsTemplate(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteArgsTemplate(v, ctx);
    }
    return out;
  }
  return value;
}

// ─── Condition evaluation ────────────────────────────────────────────────────

export function evalCondition(cond: RuleCondition, ctx: Record<string, unknown>): ConditionResult {
  const actualRaw = resolvePath(ctx, cond.field);
  const actual = toStr(actualRaw);
  const value = cond.value ?? "";
  const base = { field: cond.field, op: cond.op, value, actual: actual.slice(0, 300) };
  switch (cond.op) {
    case "eq":
      return { ...base, pass: actual === value };
    case "neq":
      return { ...base, pass: actual !== value };
    case "contains":
      return { ...base, pass: actual.toLowerCase().includes(value.toLowerCase()) };
    case "not_contains":
      return { ...base, pass: !actual.toLowerCase().includes(value.toLowerCase()) };
    case "starts_with":
      return { ...base, pass: actual.toLowerCase().startsWith(value.toLowerCase()) };
    case "regex": {
      try {
        guardRegexPattern(value); // fire-time re-guard: forced-in rows fail fast, never hang
        const re = new RegExp(value, "i");
        return { ...base, pass: re.test(actual.slice(0, REGEX_MAX_INPUT)) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[v2/automations] regex condition rejected at evaluation time ('${value.slice(0, 80)}'): ${msg}`);
        return { ...base, pass: false, error: msg };
      }
    }
    case "gt":
    case "lt": {
      const a = Number(actual);
      const b = Number(value);
      const numeric = Number.isFinite(a) && Number.isFinite(b);
      const pass = numeric
        ? cond.op === "gt"
          ? a > b
          : a < b
        : cond.op === "gt"
          ? actual > value
          : actual < value; // lexical fallback (ISO timestamps order correctly)
      return { ...base, pass };
    }
    default:
      return { ...base, pass: false, error: `op '${String(cond.op)}' not in whitelist` };
  }
}

export function evalConditions(
  conditions: RuleCondition[],
  ctx: Record<string, unknown>,
): { pass: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evalCondition(c, ctx));
  return { pass: results.every((r) => r.pass), results };
}

// ─── Validation (routes call this; 422 on any whitelist violation) ───────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Destructive-annotation lookup — the SAME lookup metaTools uses (G5.4). */
export function isDestructiveTool(accountId: string, toolName: string): boolean {
  const account = getAccount(accountId);
  if (!account) throw new AutomationError(`integration account '${accountId}' not found`, 422);
  const tool = getTools(account.definitionSlug).find((t) => t.name === toolName);
  if (!tool) {
    throw new AutomationError(
      `tool '${toolName}' is not advertised by the '${account.definitionSlug}' connector`,
      422,
    );
  }
  return tool.annotations?.destructiveHint === true;
}

export interface ValidateOpts {
  /** /test dry-runs never execute — skip the destructive-confirm gate there. */
  skipDestructiveGate?: boolean;
}

/** Normalize + whitelist-validate a rule payload. Throws AutomationError(422). */
export function validateRuleInput(body: Record<string, unknown>, opts: ValidateOpts = {}): RuleInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new AutomationError("rule 'name' is required", 422);
  const triggerEvent = typeof body.triggerEvent === "string" ? body.triggerEvent.trim() : "";
  if (!triggerEvent) throw new AutomationError("'triggerEvent' is required (the trigger field IS the event type)", 422);
  const triggerSlug =
    typeof body.triggerSlug === "string" && body.triggerSlug.trim() ? body.triggerSlug.trim() : "system";

  const conditionsRaw = body.conditions ?? [];
  if (!Array.isArray(conditionsRaw)) throw new AutomationError("'conditions' must be an array", 422);
  const conditions: RuleCondition[] = conditionsRaw.map((c, i) => {
    if (!isPlainObject(c)) throw new AutomationError(`condition #${i + 1} must be an object`, 422);
    const field = typeof c.field === "string" ? c.field.trim() : "";
    const op = typeof c.op === "string" ? c.op : "";
    const value = typeof c.value === "string" ? c.value : c.value === undefined ? "" : String(c.value);
    if (!field) throw new AutomationError(`condition #${i + 1}: 'field' is required`, 422);
    if (!(CONDITION_OPS as readonly string[]).includes(op)) {
      throw new AutomationError(
        `condition #${i + 1}: op '${op}' not in whitelist (${CONDITION_OPS.join("|")})`,
        422,
      );
    }
    if (op === "regex") guardRegexPattern(value); // early feedback in the builder
    return { field, op: op as RuleCondition["op"], value };
  });

  const actionsRaw = body.actions ?? [];
  if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) {
    throw new AutomationError("'actions' must be a non-empty array", 422);
  }
  const actions: AutomationAction[] = actionsRaw.map((a, i) => {
    if (!isPlainObject(a)) throw new AutomationError(`action #${i + 1} must be an object`, 422);
    const kind = typeof a.kind === "string" ? a.kind : "";
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      throw new AutomationError(`action #${i + 1}: kind '${kind}' not in whitelist (${ACTION_KINDS.join("|")})`, 422);
    }
    switch (kind) {
      case "create_attention": {
        if (typeof a.titleTemplate !== "string" || !a.titleTemplate.trim()) {
          throw new AutomationError(`action #${i + 1} (create_attention): 'titleTemplate' is required`, 422);
        }
        return {
          kind,
          titleTemplate: a.titleTemplate,
          ...(typeof a.severity === "string" && ["info", "warn", "urgent"].includes(a.severity)
            ? { severity: a.severity as "info" | "warn" | "urgent" }
            : {}),
          ...(typeof a.bodyTemplate === "string" ? { bodyTemplate: a.bodyTemplate } : {}),
          ...(typeof a.route === "string" ? { route: a.route } : {}),
          ...(typeof a.dedupeKeyTemplate === "string" ? { dedupeKeyTemplate: a.dedupeKeyTemplate } : {}),
        };
      }
      case "create_task": {
        if (typeof a.titleTemplate !== "string" || !a.titleTemplate.trim()) {
          throw new AutomationError(`action #${i + 1} (create_task): 'titleTemplate' is required`, 422);
        }
        return {
          kind,
          titleTemplate: a.titleTemplate,
          ...(typeof a.descriptionTemplate === "string" ? { descriptionTemplate: a.descriptionTemplate } : {}),
        };
      }
      case "notify":
        return {
          kind,
          ...(typeof a.eventType === "string" && a.eventType.trim() ? { eventType: a.eventType.trim() } : {}),
          ...(typeof a.messageTemplate === "string" ? { messageTemplate: a.messageTemplate } : {}),
        };
      case "run_tool": {
        const accountId = typeof a.accountId === "string" ? a.accountId.trim() : "";
        const tool = typeof a.tool === "string" ? a.tool.trim() : "";
        if (!accountId) throw new AutomationError(`action #${i + 1} (run_tool): 'accountId' is required`, 422);
        if (!tool) throw new AutomationError(`action #${i + 1} (run_tool): 'tool' is required`, 422);
        const argsTemplate = isPlainObject(a.argsTemplate) ? a.argsTemplate : {};
        const confirmDestructive = a.confirmDestructive === true;
        if (!opts.skipDestructiveGate) {
          const destructive = isDestructiveTool(accountId, tool); // 422s unknown account/tool too
          if (destructive && !confirmDestructive) {
            throw new AutomationError(
              `action #${i + 1} (run_tool): '${tool}' is destructive-annotated — the rule cannot be saved without confirmDestructive:true`,
              422,
            );
          }
        }
        return { kind, accountId, tool, argsTemplate, ...(confirmDestructive ? { confirmDestructive } : {}) };
      }
      default:
        throw new AutomationError(`action #${i + 1}: unhandled kind`, 422);
    }
  });

  return {
    name,
    triggerSlug,
    triggerEvent,
    conditions,
    actions,
    ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
  };
}

// ─── Trigger options for the builder ─────────────────────────────────────────

export function listTriggerOptions(): TriggerOption[] {
  const out: TriggerOption[] = [];
  for (const connector of listConnectors()) {
    for (const t of connector.spec.triggers ?? []) {
      out.push({ slug: connector.spec.slug, event: t.key, label: `${connector.spec.name} · ${t.label}` });
    }
  }
  out.push({ slug: "system", event: "sync.failed", label: "System · Integration sync failed" });
  out.push({ slug: "system", event: "task.created", label: "System · Task created" });
  return out;
}

// ─── Action execution ────────────────────────────────────────────────────────

async function executeRunTool(
  action: RunToolAction,
  ctx: Record<string, unknown>,
  rule: AutomationRule,
): Promise<ActionResultDetail> {
  // G5.4 fire-time re-check: the annotation is consulted AGAIN here so a rule
  // forced into the DB without confirmDestructive still refuses. If the
  // account/tool vanished, isDestructiveTool throws and the action fails loud.
  let destructive: boolean;
  try {
    destructive = isDestructiveTool(action.accountId, action.tool);
  } catch (err) {
    return { kind: "run_tool", ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (destructive && action.confirmDestructive !== true) {
    return {
      kind: "run_tool",
      ok: false,
      error: `'${action.tool}' is destructive-annotated and this rule lacks confirmDestructive — refused at fire time`,
    };
  }
  const args = substituteArgsTemplate(action.argsTemplate ?? {}, ctx) as Record<string, unknown>;
  try {
    const result = await callTool(action.accountId, action.tool, args, {
      source: `automation:${rule.id}`,
    });
    return result.isError
      ? { kind: "run_tool", ok: false, error: result.text }
      : { kind: "run_tool", ok: true, detail: result.text.slice(0, 1000) };
  } catch (err) {
    // LOUD runtime errors (ConnectorConfigError / IntegrationError) surface as
    // action failures — the attempt is already call-logged by the runtime.
    return { kind: "run_tool", ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeAction(
  action: AutomationAction,
  ctx: Record<string, unknown>,
  rule: AutomationRule,
): Promise<ActionResultDetail> {
  try {
    switch (action.kind) {
      case "create_attention": {
        const dedupeKey = action.dedupeKeyTemplate
          ? substituteTemplates(action.dedupeKeyTemplate, ctx) || `automation:${rule.id}`
          : `automation:${rule.id}`;
        const item = upsertByDedupeKey({
          dedupeKey,
          kind: "automation",
          severity: action.severity ?? "info",
          title: substituteTemplates(action.titleTemplate, ctx) || rule.name,
          body: action.bodyTemplate ? substituteTemplates(action.bodyTemplate, ctx) : null,
          route: action.route ?? "/automations",
          payload: { ruleId: rule.id, ruleName: rule.name, event: ctx.event },
          source: "automations",
        });
        return { kind: "create_attention", ok: true, detail: item.id };
      }
      case "create_task": {
        const task = createTask({
          title: substituteTemplates(action.titleTemplate, ctx).slice(0, 200) || rule.name,
          descriptionMd: action.descriptionTemplate
            ? substituteTemplates(action.descriptionTemplate, ctx)
            : undefined,
          status: "Ready",
          source: "automation",
          metadata: { automationRuleId: rule.id, triggerEvent: rule.triggerEvent },
        });
        return { kind: "create_task", ok: true, detail: task.displayId };
      }
      case "notify": {
        const type = action.eventType ?? "automation.notify";
        emit(
          type,
          {
            ruleId: rule.id,
            ruleName: rule.name,
            message: action.messageTemplate ? substituteTemplates(action.messageTemplate, ctx) : "",
            event: ctx.event,
          },
          "automation", // loop guard: automation-sourced events never re-trigger rules
        );
        return { kind: "notify", ok: true, detail: type };
      }
      case "run_tool":
        return executeRunTool(action, ctx, rule);
      default:
        return { kind: (action as AutomationAction).kind, ok: false, error: "unhandled action kind" };
    }
  } catch (err) {
    return { kind: action.kind, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Fire pipeline ───────────────────────────────────────────────────────────

interface TriggerContext {
  ctx: Record<string, unknown>;
  triggerKey: string;
  slug: string | null; // connector slug for trigger_slug scoping (null = system)
  activityId: string | null;
}

function buildTriggerContext(event: V2Event): TriggerContext | null {
  if (event.type === "activity.created") {
    const activityId = typeof event.payload.activityId === "string" ? event.payload.activityId : null;
    const activity = activityId ? getActivity(activityId) : null;
    if (!activity || !activity.eventType) return null; // no trigger key → nothing to match
    let account: AccountRow | null = null;
    try {
      account = getAccount(activity.accountId);
    } catch {
      /* tolerated */
    }
    return {
      triggerKey: activity.eventType,
      slug: account?.definitionSlug ?? (typeof event.payload.slug === "string" ? event.payload.slug : null),
      activityId: activity.id,
      ctx: {
        event: activity.eventType,
        text: activity.text,
        payload: activity.payload ?? {},
        activity: {
          id: activity.id,
          text: activity.text,
          sourceUrl: activity.sourceUrl,
          eventType: activity.eventType,
          createdAt: activity.createdAt,
        },
        account: account
          ? {
              id: account.id,
              slug: account.definitionSlug,
              accountId: account.accountId,
              displayName: account.displayName,
            }
          : {},
      },
    };
  }
  // Any other bus event: the event type IS the trigger key.
  return {
    triggerKey: event.type,
    slug: typeof event.payload.slug === "string" ? event.payload.slug : null,
    activityId: null,
    ctx: {
      event: event.type,
      text: typeof event.payload.text === "string" ? event.payload.text : "",
      payload: event.payload,
    },
  };
}

function slugMatches(ruleSlug: string, eventSlug: string | null): boolean {
  if (!ruleSlug || ruleSlug === "*" || ruleSlug === "system") return true;
  return ruleSlug === eventSlug;
}

async function fireRule(rule: AutomationRule, trig: TriggerContext, eventId: number | null): Promise<void> {
  // Item 12 replay guard: boot replay (and any redelivered event) must never
  // re-execute actions for a (rule, event) pair that already ran.
  if (eventId !== null && hasRunForEvent(rule.id, eventId)) return;

  const { pass, results } = evalConditions(rule.conditions, trig.ctx);
  if (!pass) {
    // condition_miss ONLY here — the trigger matched, conditions failed.
    insertRun({
      ruleId: rule.id,
      activityId: trig.activityId,
      eventId,
      trigger: trig.ctx.payload as Record<string, unknown>,
      status: "condition_miss",
      detail: { conditions: results },
    });
    return;
  }

  const actionResults: ActionResultDetail[] = [];
  let failed: ActionResultDetail | null = null;
  for (const action of rule.actions) {
    const r = await executeAction(action, trig.ctx, rule);
    actionResults.push(r);
    if (!r.ok && !failed) failed = r;
  }

  const status: AutomationRunStatus = failed ? "action_failed" : "ok";
  insertRun({
    ruleId: rule.id,
    activityId: trig.activityId,
    eventId,
    trigger: trig.ctx.payload as Record<string, unknown>,
    status,
    detail: { conditions: results, actions: actionResults },
    error: failed?.error,
  });
  getDb()
    .prepare("UPDATE automation_rules SET last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?")
    .run(now(), rule.id);

  if (failed) {
    // Action failures surface on the attention hero (§5.7).
    try {
      upsertByDedupeKey({
        dedupeKey: `automation-failed:${rule.id}`,
        kind: "automation",
        severity: "warn",
        title: `Automation failed: ${rule.name}`,
        body: failed.error ?? null,
        route: "/automations",
        payload: { ruleId: rule.id, actionKind: failed.kind },
        source: "automations",
      });
    } catch (err) {
      console.error("[v2/automations] failed to flag action failure:", err);
    }
  }
}

async function handleEvent(event: V2Event): Promise<void> {
  try {
    if (event.type === "attention.flag") return; // aggregator territory — never a rule trigger
    if (event.source === "automation") return; // loop guard (documented above)
    if (readSettings().automations?.enabled === false) return; // kill switch

    const trig = buildTriggerContext(event);
    if (!trig) return;
    const rules = listRules({ activeOnly: true }).filter(
      (r) => r.triggerEvent === trig.triggerKey && slugMatches(r.triggerSlug, trig.slug),
    );
    for (const rule of rules) {
      try {
        await fireRule(rule, trig, event.id ?? null);
      } catch (err) {
        console.error(`[v2/automations] rule '${rule.name}' (${rule.id}) fire failed:`, err);
      }
    }
  } finally {
    // Item 12 durable cursor: EVERY processed event advances it (skipped
    // events too — otherwise the replay window never shrinks). Monotonic.
    if (typeof event.id === "number") advanceEventCursor(event.id);
  }
}

// ─── Durable event cursor (HARDENING-2026-08-27 item 12) ─────────────────────

const CURSOR_META_KEY = "automations_event_cursor";
const REPLAY_CAP = 1000;

function readEventCursor(): number | null {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(CURSOR_META_KEY) as { value: string } | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

function advanceEventCursor(eventId: number): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value
         WHERE CAST(excluded.value AS INTEGER) > CAST(meta.value AS INTEGER)`,
      )
      .run(CURSOR_META_KEY, String(eventId));
  } catch (err) {
    console.error("[v2/automations] cursor advance failed:", err);
  }
}

/**
 * Boot replay: dispatch is otherwise in-memory only — events persisted while
 * the engine was down (or after its subscription died) never fired rules.
 * Replays events newer than the cursor through the normal pipeline; the
 * UNIQUE(rule_id, event_id) run guard makes overlap with live delivery
 * harmless. First boot (no cursor) initializes to MAX(events.id) — history
 * from before this feature must not spuriously fire rules.
 */
async function replayMissedEvents(): Promise<number> {
  const db = getDb();
  const cursor = readEventCursor();
  if (cursor === null) {
    const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number };
    advanceEventCursor(row.m);
    return 0;
  }
  const rows = db
    .prepare("SELECT id, type, source, payload, created_at AS createdAt FROM events WHERE id > ? ORDER BY id ASC LIMIT ?")
    .all(cursor, REPLAY_CAP) as Array<Omit<V2Event, "payload"> & { payload: string }>;
  for (const r of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      /* tolerated */
    }
    await handleEvent({ id: r.id, type: r.type, source: r.source, payload, createdAt: r.createdAt });
  }
  if (rows.length > 0) {
    console.log(`[v2/automations] replayed ${rows.length} missed event(s) through the rules engine`);
  }
  return rows.length;
}

// ─── Boot wiring ─────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __agentosAutomations:
    | { unsubscribe: (() => void) | null; pending: Promise<void> }
    | undefined;
}

function engineState() {
  if (!globalThis.__agentosAutomations) {
    globalThis.__agentosAutomations = { unsubscribe: null, pending: Promise.resolve() };
  }
  return globalThis.__agentosAutomations;
}

/** Boot-wired singleton (boot.ts ensureV2): subscribes '*' on the v2 bus.
 *  Events are processed on a serial promise chain so ordering is deterministic
 *  and smokes can await automationsIdle(). */
export function ensureAutomations(): void {
  const s = engineState();
  if (s.unsubscribe) return;
  s.unsubscribe = on("*", (event) => {
    s.pending = s.pending
      .then(() => handleEvent(event))
      .catch((err) => console.error("[v2/automations] event handling failed:", err));
  });
  // Item 12: replay events persisted while no engine was subscribed. Chained
  // onto the serial pipeline so live events queue behind the replay; the
  // (rule_id, event_id) run guard neutralizes any overlap.
  s.pending = s.pending
    .then(() => replayMissedEvents())
    .then(() => undefined)
    .catch((err) => console.error("[v2/automations] boot replay failed:", err));
}

/** Await all in-flight rule processing (smokes). */
export function automationsIdle(): Promise<void> {
  return engineState().pending;
}

/** Smoke teardown: drop the bus subscription. */
export function stopAutomationsForTests(): void {
  const s = engineState();
  s.unsubscribe?.();
  globalThis.__agentosAutomations = undefined;
}

// ─── util ────────────────────────────────────────────────────────────────────

function safeParseArr(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeParseObj(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
