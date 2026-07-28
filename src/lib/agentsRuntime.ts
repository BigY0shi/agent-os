// Agents module — the Tier-2 runner + Tier-1 curator. Wraps the Claude Agent SDK:
// one query() per run, streaming events into an in-memory registry (mirrored to
// JSONL on disk).
//
// PERMISSIONS DESIGN — one gate, enforced twice:
// a PreToolUse hook fires on EVERY tool call (verified 2026-07-28: in default
// permission mode the CLI auto-allows e.g. Bash without ever consulting
// canUseTool — the smoke test's Bash ran with 0 canUseTool calls, so a
// callback-only design silently misses the constitution). The hook runs gate():
// "deny" blocks outright, "queue" returns permissionDecision "ask" which
// escalates into the permission flow where canUseTool parks the run on a human
// approval. The SDK's native bypassPermissions mode is never used — the dial
// (bypass/gated/ask) is implemented in gate() itself.
//
// CURATOR (Phase 2) — the "learns on the job" tier. After every successful task
// run (and on explicit user feedback), a bounded curator run reviews the
// transcript and may edit ONLY the agent's own instruction/memory files. Its
// gate is a hard allowlist: read anywhere inside the agent dir, write only to
// system.md / skills/*.md / memory/*.md. No shell, no MCP, no network. Any
// system.md change is diffed into the run events + memory/curator-log.md, so
// drift is always visible.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { CLAUDE_MODEL } from "./config";
import { makeHttpServer, HTTP_TOOL_NAME, SENSITIVE_HTTP_RE } from "./agentsHttpTool";
import type { AgentDef, AgentIntelligence, ApprovalReq, ApprovalReason, McpServerHealth, RunEvent, RunMeta } from "./agentsTypes";
import {
  appendRunEvent, loadRunMeta, readApprovals, readRunEvents, readSystemPrompt,
  saveRunMeta, workspaceDir, writeApprovals, agentDir, loadAgent,
} from "./agentsStore";

// Model ids verified live on the claude CLI 2026-07-28 ("Reply OK" probes).
const MODEL_FOR: Record<AgentIntelligence, string> = {
  fast: "claude-haiku-4-5",
  standard: "claude-sonnet-5",
  deep: CLAUDE_MODEL,
};

const RUN_TIMEOUT_MS = 30 * 60 * 1000;      // wall clock per task run
const CURATOR_TIMEOUT_MS = 8 * 60 * 1000;   // curator is bounded much tighter
const APPROVAL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // then the call is denied + run parks
const MAX_TURNS = 150;
const CURATOR_MAX_TURNS = 25;
const GLOBAL_CONCURRENCY = 2;

/** Trigger values that mean "this IS the curator" — they never re-trigger curation. */
const CURATOR_TRIGGERS = new Set(["curator", "feedback"]);

interface LiveRun {
  meta: RunMeta;
  events: RunEvent[];
  seq: number;
  abort: AbortController;
  /** approvalId → resolver for the parked canUseTool promise */
  pending: Map<string, (allow: boolean) => void>;
  mcpHealth: McpServerHealth[];
}

// HMR/route-isolation-safe singleton — same trick the other modules' in-memory
// state uses. Next.js can instantiate a module per route bundle; globalThis is
// the only reliable shared root in dev AND prod.
const g = globalThis as unknown as { __agentsRuns?: Map<string, LiveRun> };
const RUNS: Map<string, LiveRun> = (g.__agentsRuns ??= new Map());

function live(runId: string): LiveRun | undefined { return RUNS.get(runId); }

export function runningCount(): number {
  let n = 0;
  for (const r of RUNS.values()) if (r.meta.status === "running" || r.meta.status === "waiting") n++;
  return n;
}

export function agentHasActiveRun(agentId: string): boolean {
  for (const r of RUNS.values()) {
    if (r.meta.agentId === agentId && (r.meta.status === "running" || r.meta.status === "waiting")) return true;
  }
  return false;
}

function push(runId: string, ev: Omit<RunEvent, "seq" | "ts">): void {
  const r = live(runId);
  if (!r) return;
  const full: RunEvent = { ...ev, seq: r.seq++, ts: Date.now() };
  r.events.push(full);
  // Fire-and-forget disk mirror; the in-memory buffer is what the UI polls.
  void appendRunEvent(r.meta.agentId, runId, full);
}

function preview(v: unknown, max = 400): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch { return "[unserializable]"; }
}

// ---- constitution + mode gate --------------------------------------------

// Tool-NAME patterns that are constitution-gated in every mode. Conservative on
// purpose: a false positive costs one approval click, a false negative sends an
// email at 3am.
const CONST_TOOL = [
  { re: /send[_-]?(email|message|mail|dm|sms)|gmail.*send|send.*draft/i, why: "outbound send" },
  { re: /\bpublish\b|_publish|tweet|create[_-]?post|post[_-]?(status|update|content)/i, why: "public post" },
  { re: /payment|charge|transfer|payout|refund|purchase/i, why: "financial action" },
  { re: /delete|destroy|\btrash\b|remove[_-](file|label|item)/i, why: "deletion" },
  { re: /create[_-]?(api[_-]?key|token|credential)|grant/i, why: "credential grant" },
];

// Bash/PowerShell COMMAND patterns — same tiers, shell edition. Deletions get a
// deny-with-guidance instead of an approval card: house rule is exile, never rm.
const CONST_SHELL_DENY = [
  { re: /(^|[\s;&|])(rm|rmdir|del|erase|rd)\s/i, why: "shell deletion — use the exile pattern (move to .exile/) instead" },
  { re: /Remove-Item|Clear-Content/i, why: "shell deletion — use the exile pattern (move to .exile/) instead" },
  { re: /git\s+push\s+[^\n]*(--force|-f\b)/, why: "force push is blocked" },
  { re: /git\s+reset\s+--hard/, why: "hard reset is blocked" },
];
const CONST_SHELL_QUEUE = [
  { re: /\bgh\s+(pr|issue|release|gist)\s+create/, why: "public post (GitHub)" },
  { re: /\bnpm\s+publish\b/, why: "public publish (npm)" },
  { re: /\bgit\s+push\b/, why: "outbound push" },
];

const SHELL_TOOLS = /^(Bash|PowerShell|mcp__.*(powershell|shell|exec).*)$/i;
const WRITE_TOOLS = /^(Write|Edit|NotebookEdit)$/;
const MUTATING_HTTP = /^(POST|PUT|PATCH|DELETE)$/i;

type GateDecision =
  | { verdict: "allow" }
  | { verdict: "deny"; why: string }
  | { verdict: "queue"; reason: ApprovalReason; why: string };

export function gate(def: AgentDef, toolName: string, input: Record<string, unknown>): GateDecision {
  // Constitution first — applies in every mode, bypass included.
  if (SHELL_TOOLS.test(toolName)) {
    const cmd = String(input.command ?? input.script ?? "");
    for (const p of CONST_SHELL_DENY) if (p.re.test(cmd)) return { verdict: "deny", why: p.why };
    for (const p of CONST_SHELL_QUEUE) if (p.re.test(cmd)) return { verdict: "queue", reason: "constitution", why: p.why };
  }
  for (const p of CONST_TOOL) if (p.re.test(toolName)) return { verdict: "queue", reason: "constitution", why: p.why };

  // Direct-HTTP tier: a mutating call to a messaging/payment endpoint is an
  // outbound send in API clothing — constitution, every mode. Other mutating
  // calls are gated-mode approvals; GET/HEAD is plain research.
  if (toolName === HTTP_TOOL_NAME) {
    const method = String(input.method ?? "GET");
    const url = String(input.url ?? "");
    if (MUTATING_HTTP.test(method)) {
      if (SENSITIVE_HTTP_RE.test(url)) return { verdict: "queue", reason: "constitution", why: `outbound ${method} to a send/pay endpoint` };
      if (def.permissionMode === "gated") return { verdict: "queue", reason: "gated", why: `mutating HTTP ${method}` };
    }
  }

  if (def.permissionMode === "ask") return { verdict: "queue", reason: "ask", why: "ask mode — every call is reviewed" };

  if (def.permissionMode === "gated") {
    // Out-of-workspace writes queue; everything else (reads, research, Bash in
    // the workspace cwd, in-workspace files) runs free.
    if (WRITE_TOOLS.test(toolName)) {
      const target = String(input.file_path ?? input.notebook_path ?? "");
      const home = agentDir(def.id).replace(/\\/g, "/").toLowerCase();
      if (target && !target.replace(/\\/g, "/").toLowerCase().startsWith(home)) {
        return { verdict: "queue", reason: "gated", why: "write outside the agent's workspace" };
      }
    }
    return { verdict: "allow" };
  }

  // bypass — constitution already handled above; the rest runs free.
  return { verdict: "allow" };
}

// The curator's gate is not a dial — it's a hard allowlist. It exists so the
// "self-improving" tier can never become an unsupervised actor: no shell, no
// MCP, no network, writes only to the agent's own instruction/memory files.
const CURATOR_EDITABLE = /(^|[\\/])(system\.md|curator-log\.md|skills[\\/][^\\/]+\.md|memory[\\/][^\\/]+\.md)$/i;

function curatorGate(def: AgentDef, toolName: string, input: Record<string, unknown>): GateDecision {
  const home = agentDir(def.id).replace(/\\/g, "/").toLowerCase();
  const target = String(input.file_path ?? input.path ?? "").replace(/\\/g, "/").toLowerCase();
  if (/^(Read|Grep|Glob)$/.test(toolName)) {
    if (!target || target.startsWith(home)) return { verdict: "allow" };
    return { verdict: "deny", why: "curator reads stay inside the agent directory" };
  }
  if (/^(Write|Edit)$/.test(toolName)) {
    if (target.startsWith(home) && CURATOR_EDITABLE.test(target)) return { verdict: "allow" };
    return { verdict: "deny", why: "curator may only edit system.md, skills/*.md and memory/*.md" };
  }
  if (/^TodoWrite$/.test(toolName)) return { verdict: "allow" };
  return { verdict: "deny", why: `curator has no access to ${toolName}` };
}

// ---- approvals ------------------------------------------------------------

export async function pendingApprovals(): Promise<ApprovalReq[]> {
  // Registry is authoritative for liveness; the JSON file is just UI persistence.
  const list = await readApprovals();
  return list.filter((a) => live(a.runId)?.pending.has(a.id));
}

export async function resolveApproval(id: string, allow: boolean): Promise<boolean> {
  for (const r of RUNS.values()) {
    const resolver = r.pending.get(id);
    if (resolver) {
      resolver(allow);
      return true;
    }
  }
  // Stale card (server restarted, run died) — just clean the file.
  await writeApprovals((await readApprovals()).filter((a) => a.id !== id));
  return false;
}

async function queueApproval(def: AgentDef, runId: string, toolName: string, input: unknown, reason: ApprovalReason, why: string): Promise<boolean> {
  const r = live(runId);
  if (!r) return false;
  const req: ApprovalReq = {
    id: randomUUID(), runId, agentId: def.id, agentName: def.name,
    toolName, inputPreview: preview(input, 1200), reason, createdAt: Date.now(),
  };
  await writeApprovals([...(await readApprovals()), req]);
  push(runId, { kind: "approval", toolName, detail: `${why} — waiting for approval`, approvalId: req.id });
  r.meta.status = "waiting";
  await saveRunMeta(r.meta);

  const allowed = await new Promise<boolean>((resolve) => {
    r.pending.set(req.id, resolve);
    setTimeout(() => resolve(false), APPROVAL_TIMEOUT_MS);
  });

  r.pending.delete(req.id);
  await writeApprovals((await readApprovals()).filter((a) => a.id !== req.id));
  if (r.meta.status === "waiting") {
    r.meta.status = "running";
    await saveRunMeta(r.meta);
  }
  push(runId, { kind: "status", detail: `${toolName}: ${allowed ? "approved" : "denied"} by user` });
  return allowed;
}

// ---- shared stream consumer ----------------------------------------------

async function consume(runId: string, stream: AsyncIterable<{ type: string; subtype?: string; [k: string]: unknown }>): Promise<void> {
  const r = live(runId)!;
  for await (const msg of stream) {
    if (msg.type === "system" && msg.subtype === "init") {
      const servers = (msg as { mcp_servers?: { name: string; status: string }[] }).mcp_servers ?? [];
      r.mcpHealth = servers.map((s) => ({ name: s.name, status: s.status }));
      push(runId, { kind: "init", detail: `model ${(msg as { model?: string }).model ?? "?"} · MCP: ${servers.map((s) => `${s.name}:${s.status}`).join(", ") || "none"}` });
    } else if (msg.type === "assistant") {
      const content = (msg as { message?: { content?: { type: string; text?: string; name?: string; input?: unknown }[] } }).message?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) push(runId, { kind: "text", text: block.text });
        else if (block.type === "tool_use") push(runId, { kind: "tool", toolName: block.name, detail: preview(block.input) });
      }
    } else if (msg.type === "user") {
      const content = (msg as { message?: { content?: unknown } }).message?.content;
      if (Array.isArray(content)) {
        for (const block of content as { type: string; content?: unknown; is_error?: boolean }[]) {
          if (block.type === "tool_result") {
            push(runId, { kind: "tool-result", detail: preview(block.content, 300), text: block.is_error ? "error" : undefined });
          }
        }
      }
    } else if (msg.type === "result") {
      const res = msg as { subtype: string; result?: string; total_cost_usd?: number; num_turns?: number };
      r.meta.status = res.subtype === "success" ? "done" : "error";
      r.meta.result = res.result ?? "";
      r.meta.costUsd = res.total_cost_usd;
      r.meta.numTurns = res.num_turns;
      r.meta.endedAt = Date.now();
      if (res.subtype !== "success") r.meta.error = res.subtype;
      push(runId, { kind: "result", text: res.result ?? res.subtype });
    }
  }
}

function makeHooks(def: AgentDef, runId: string, gateFn: (def: AgentDef, t: string, i: Record<string, unknown>) => GateDecision) {
  return {
    PreToolUse: [{
      hooks: [async (input: { hook_event_name: string; tool_name?: string; tool_input?: unknown }) => {
        const toolName = input.tool_name ?? "";
        const d = gateFn(def, toolName, (input.tool_input ?? {}) as Record<string, unknown>);
        if (d.verdict === "deny") {
          push(runId, { kind: "status", detail: `blocked ${toolName}: ${d.why}` });
          return { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: d.why } };
        }
        if (d.verdict === "queue") {
          return { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: d.why } };
        }
        return {};
      }],
    }],
  };
}

// ---- the task runner ------------------------------------------------------

export async function startRun(def: AgentDef, trigger: string, extraPrompt?: string): Promise<{ runId: string } | { error: string }> {
  if (!def.enabled) return { error: "agent is disabled" };
  if (agentHasActiveRun(def.id)) return { error: "agent already has an active run" };
  if (runningCount() >= GLOBAL_CONCURRENCY) return { error: `global run limit (${GLOBAL_CONCURRENCY}) reached` };

  const runId = randomUUID();
  const meta: RunMeta = { id: runId, agentId: def.id, trigger, status: "running", startedAt: Date.now() };
  const abort = new AbortController();
  RUNS.set(runId, { meta, events: [], seq: 0, abort, pending: new Map(), mcpHealth: [] });
  await saveRunMeta(meta);

  void execute(def, runId, trigger, extraPrompt).catch(async (e) => {
    const r = live(runId);
    if (r && r.meta.status === "running") {
      r.meta.status = "error";
      r.meta.error = String((e as Error)?.message || e);
      r.meta.endedAt = Date.now();
      push(runId, { kind: "error", text: r.meta.error });
      await saveRunMeta(r.meta);
    }
  });
  return { runId };
}

async function execute(def: AgentDef, runId: string, trigger: string, extraPrompt?: string): Promise<void> {
  const r = live(runId)!;
  const system = await readSystemPrompt(def.id);
  const timeout = setTimeout(() => r.abort.abort(), RUN_TIMEOUT_MS);

  const prompt =
    `Trigger: ${trigger}.\n` +
    (extraPrompt ? `\n${extraPrompt}\n` : "") +
    `\nCarry out your standing instructions for this trigger. Your workspace directory is your cwd — keep scratch work and artifacts there. ` +
    `Read memory/facts.md and memory/journal.md (one level up from your cwd) first if past context could matter — pull only what's relevant.`;

  try {
    // Custom SDK MCP tools (the http server) require streaming input mode — a
    // plain string prompt "will not work" per the SDK docs, so wrap in a
    // one-shot async generator.
    async function* oneShot() {
      yield { type: "user" as const, message: { role: "user" as const, content: prompt }, parent_tool_use_id: null, session_id: "" };
    }
    const stream = query({
      prompt: oneShot(),
      options: {
        cwd: workspaceDir(def.id),
        model: MODEL_FOR[def.intelligence],
        mcpServers: { http: makeHttpServer() },
        systemPrompt: { type: "preset", preset: "claude_code", append:
          `\n\nYou are "${def.name}", a standing background agent in the user's Agent OS.\n${system}\n\n` +
          `Direct-HTTP tier: the http_request tool calls any API. Per-service instructions live in ../skills/apis/*.md (relative to your cwd) — read the relevant one before calling. ` +
          `Credentials are referenced as {{secret:NAME}} placeholders (resolved server-side); never ask for or echo raw keys.` },
        // "user" pulls the user's own settings — including their locally
        // configured MCP servers. This is the "inherit the fleet" decision.
        settingSources: def.tools.mcp === "inherit" ? ["user"] : [],
        permissionMode: "default",
        maxTurns: MAX_TURNS,
        abortController: r.abort,
        stderr: (d: string) => { if (d.trim()) push(runId, { kind: "stderr", text: d.trim().slice(0, 500) }); },
        // The deterministic half of the gate — see the header comment. Without
        // this, default-mode auto-allows skip canUseTool entirely.
        hooks: makeHooks(def, runId, gate),
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          const d = gate(def, toolName, input);
          if (d.verdict === "deny") return { behavior: "deny" as const, message: d.why };
          if (d.verdict === "queue") {
            const ok = await queueApproval(def, runId, toolName, input, d.reason, d.why);
            return ok
              ? { behavior: "allow" as const, updatedInput: input }
              : { behavior: "deny" as const, message: "The user declined this action. Adapt or wrap up." };
          }
          return { behavior: "allow" as const, updatedInput: input };
        },
      },
    });

    await consume(runId, stream as AsyncIterable<{ type: string; subtype?: string }>);
  } catch (e) {
    if (r.abort.signal.aborted && r.meta.status !== "done") {
      r.meta.status = "killed";
      r.meta.endedAt = Date.now();
      push(runId, { kind: "status", detail: "run killed" });
    } else { throw e; }
  } finally {
    clearTimeout(timeout);
    if (r.meta.status === "running" || r.meta.status === "waiting") {
      r.meta.status = "error";
      r.meta.error = r.meta.error ?? "stream ended without a result";
      r.meta.endedAt = Date.now();
    }
    await saveRunMeta(r.meta);
    // Tier 1 kicks in: successful task runs get a curation pass. Small delay so
    // the run registry + JSONL settle first.
    if (r.meta.status === "done" && !CURATOR_TRIGGERS.has(trigger)) {
      setTimeout(() => { void startCurator(def.id, runId).catch(() => {}); }, 2000);
    }
  }
}

// ---- the curator (Tier 1) -------------------------------------------------

/** Tiny dependency-free line diff — enough to make drift visible, not pretty. */
function diffLines(before: string, after: string, cap = 30): string {
  const b = before.split(/\r?\n/), a = after.split(/\r?\n/);
  const bSet = new Set(b), aSet = new Set(a);
  const removed = b.filter((l) => !aSet.has(l) && l.trim());
  const added = a.filter((l) => !bSet.has(l) && l.trim());
  if (!removed.length && !added.length) return "";
  const lines = [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)];
  return lines.slice(0, cap).join("\n") + (lines.length > cap ? `\n… ${lines.length - cap} more lines` : "");
}

export async function startCurator(agentId: string, forRunId: string, feedback?: { verdict: "up" | "down"; comment?: string }): Promise<{ runId: string } | { error: string }> {
  const def = await loadAgent(agentId);
  if (!def) return { error: "agent not found" };
  if (agentHasActiveRun(agentId)) return { error: "agent busy" };
  if (runningCount() >= GLOBAL_CONCURRENCY) return { error: "global run limit reached" };

  const trigger = feedback ? "feedback" : "curator";
  const runId = randomUUID();
  const meta: RunMeta = { id: runId, agentId, trigger, status: "running", startedAt: Date.now() };
  const abort = new AbortController();
  RUNS.set(runId, { meta, events: [], seq: 0, abort, pending: new Map(), mcpHealth: [] });
  await saveRunMeta(meta);

  void executeCurator(def, runId, forRunId, feedback).catch(async (e) => {
    const r = live(runId);
    if (r && r.meta.status === "running") {
      r.meta.status = "error";
      r.meta.error = String((e as Error)?.message || e);
      r.meta.endedAt = Date.now();
      push(runId, { kind: "error", text: r.meta.error });
      await saveRunMeta(r.meta);
    }
  });
  return { runId };
}

async function executeCurator(def: AgentDef, runId: string, forRunId: string, feedback?: { verdict: "up" | "down"; comment?: string }): Promise<void> {
  const r = live(runId)!;
  const systemBefore = await readSystemPrompt(def.id);
  const timeout = setTimeout(() => r.abort.abort(), CURATOR_TIMEOUT_MS);

  const prompt =
    `You are the CURATOR for the agent "${def.name}". A run just finished: runs/${forRunId}.jsonl (its result is in runs/${forRunId}.meta.json).\n` +
    (feedback ? `\nTHE USER GAVE FEEDBACK on that run: ${feedback.verdict === "up" ? "thumbs UP" : "thumbs DOWN"}${feedback.comment ? ` — "${feedback.comment}"` : ""}. Weight this heavily.\n` : "") +
    `\nYour duties, in order:\n` +
    `1. Read the run transcript (skim — pull only what matters) and the current memory files.\n` +
    `2. Append a dated entry to memory/journal.md: 2-4 lines on what the run did, what worked, what didn't. Newest entries at the top.\n` +
    `3. If journal.md has grown past ~150 lines, compress the OLDEST entries into one-line summaries (multi-resolution memory: recent = full fidelity, old = headlines).\n` +
    `4. Update memory/facts.md only with durable, reusable facts learned this run (contacts, formats that worked, gotchas). No run-by-run noise.\n` +
    `5. Refine system.md ONLY if there is a clear, recurring lesson or explicit user feedback. Make the smallest edit that captures it. Never rewrite wholesale, never change the agent's core mission.\n` +
    `\nYou can only edit this agent's own files. Finish with a one-line summary of what you changed (or "no changes needed").`;

  try {
    const stream = query({
      prompt,
      options: {
        cwd: agentDir(def.id),
        model: MODEL_FOR.standard,
        systemPrompt: { type: "preset", preset: "claude_code", append: "\n\nYou are a careful curator of a background agent's instructions and memory. Conservative edits only." },
        settingSources: [],
        permissionMode: "default",
        maxTurns: CURATOR_MAX_TURNS,
        abortController: r.abort,
        stderr: (d: string) => { if (d.trim()) push(runId, { kind: "stderr", text: d.trim().slice(0, 500) }); },
        hooks: makeHooks(def, runId, curatorGate),
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          // The hook already denied everything off-limits; anything escalated
          // here is unexpected — deny rather than park a background curator.
          const d = curatorGate(def, toolName, input);
          return d.verdict === "allow"
            ? { behavior: "allow" as const, updatedInput: input }
            : { behavior: "deny" as const, message: "why" in d ? d.why : "not permitted" };
        },
      },
    });

    await consume(runId, stream as AsyncIterable<{ type: string; subtype?: string }>);
  } catch (e) {
    if (r.abort.signal.aborted && r.meta.status !== "done") {
      r.meta.status = "killed";
      r.meta.endedAt = Date.now();
      push(runId, { kind: "status", detail: "curator run timed out" });
    } else { throw e; }
  } finally {
    clearTimeout(timeout);
    if (r.meta.status === "running") {
      r.meta.status = "error";
      r.meta.error = r.meta.error ?? "curator stream ended without a result";
      r.meta.endedAt = Date.now();
    }
    // Drift visibility: any system.md change is diffed into the events + log.
    try {
      const systemAfter = await readSystemPrompt(def.id);
      const diff = diffLines(systemBefore, systemAfter);
      if (diff) {
        push(runId, { kind: "status", detail: `system.md changed:\n${diff}` });
        await appendFile(
          path.join(agentDir(def.id), "curator-log.md"),
          `\n## ${new Date().toISOString()} (run ${forRunId.slice(0, 8)})\n\n\`\`\`diff\n${diff}\n\`\`\`\n`,
          "utf8",
        );
      }
    } catch { /* diff is best-effort */ }
    await saveRunMeta(r.meta);
  }
}

/** Read a run's stored feedback (if any) — used by the detail API. */
export async function readFeedback(agentId: string, runId: string): Promise<{ verdict: string; comment?: string } | null> {
  try {
    return JSON.parse(await readFile(path.join(agentDir(agentId), "runs", `${runId}.feedback.json`), "utf8"));
  } catch { return null; }
}

// ---- controls -------------------------------------------------------------

export function killRun(runId: string): boolean {
  const r = live(runId);
  if (!r) return false;
  // Unpark any waiting approvals as denials first, so the stream can wind down.
  for (const resolve of r.pending.values()) resolve(false);
  r.abort.abort();
  return true;
}

/** Live-first read: memory buffer while running, disk once the process forgot. */
export async function getRun(agentId: string, runId: string, afterSeq = -1): Promise<{ meta: RunMeta; events: RunEvent[]; mcpHealth: McpServerHealth[] } | null> {
  const r = live(runId);
  if (r) return { meta: r.meta, events: r.events.filter((e) => e.seq > afterSeq), mcpHealth: r.mcpHealth };
  const meta = await loadRunMeta(agentId, runId);
  if (!meta) return null;
  return { meta, events: await readRunEvents(agentId, runId, afterSeq), mcpHealth: [] };
}
