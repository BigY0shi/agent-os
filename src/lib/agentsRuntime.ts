// Agents module — the Tier-2 runner. Wraps the Claude Agent SDK: one query() per
// run, streaming events into an in-memory registry (mirrored to JSONL on disk).
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
// The constitution (send / publish / pay / credential / delete) queues for human
// approval in ALL modes. A queued call parks the run mid-flight — the canUseTool
// promise simply doesn't resolve until the user decides in the Approvals inbox.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { CLAUDE_MODEL } from "./config";
import type { AgentDef, AgentIntelligence, ApprovalReq, ApprovalReason, McpServerHealth, RunEvent, RunMeta } from "./agentsTypes";
import {
  appendRunEvent, loadRunMeta, readApprovals, readRunEvents, readSystemPrompt,
  saveRunMeta, workspaceDir, writeApprovals, agentDir,
} from "./agentsStore";

// Model ids verified live on the claude CLI 2026-07-28 ("Reply OK" probes).
const MODEL_FOR: Record<AgentIntelligence, string> = {
  fast: "claude-haiku-4-5",
  standard: "claude-sonnet-5",
  deep: CLAUDE_MODEL,
};

const RUN_TIMEOUT_MS = 30 * 60 * 1000;      // wall clock per run
const APPROVAL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // then the call is denied + run parks
const MAX_TURNS = 150;
const GLOBAL_CONCURRENCY = 2;

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
const READONLY_TOOLS = /^(Read|Grep|Glob|WebFetch|WebSearch|TodoWrite|Task|ListMcpResourcesTool|ReadMcpResourceTool)$/;

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

  // bypass
  void READONLY_TOOLS; // (kept for future fine-graining; bypass allows the rest)
  return { verdict: "allow" };
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

// ---- the runner -----------------------------------------------------------

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
    `Read memory/facts.md and memory/journal.md first if past context could matter (agentic search — pull only what's relevant).`;

  try {
    const stream = query({
      prompt,
      options: {
        cwd: workspaceDir(def.id),
        model: MODEL_FOR[def.intelligence],
        systemPrompt: { type: "preset", preset: "claude_code", append:
          `\n\nYou are "${def.name}", a standing background agent in the user's Agent OS.\n${system}` },
        // "user" pulls the user's own settings — including their locally
        // configured MCP servers. This is the "inherit the fleet" decision.
        settingSources: def.tools.mcp === "inherit" ? ["user"] : [],
        permissionMode: "default",
        maxTurns: MAX_TURNS,
        abortController: r.abort,
        // The deterministic half of the gate — see the header comment. Without
        // this, default-mode auto-allows skip canUseTool entirely.
        hooks: {
          PreToolUse: [{
            hooks: [async (input: { hook_event_name: string; tool_name?: string; tool_input?: unknown }) => {
              const toolName = input.tool_name ?? "";
              const d = gate(def, toolName, (input.tool_input ?? {}) as Record<string, unknown>);
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
        },
        stderr: (d: string) => { if (d.trim()) push(runId, { kind: "stderr", text: d.trim().slice(0, 500) }); },
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

    for await (const msg of stream) {
      if (msg.type === "system" && msg.subtype === "init") {
        const servers = (msg as unknown as { mcp_servers?: { name: string; status: string }[] }).mcp_servers ?? [];
        r.mcpHealth = servers.map((s) => ({ name: s.name, status: s.status }));
        push(runId, { kind: "init", detail: `model ${(msg as unknown as { model?: string }).model ?? "?"} · MCP: ${servers.map((s) => `${s.name}:${s.status}`).join(", ") || "none"}` });
      } else if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) push(runId, { kind: "text", text: block.text });
          else if (block.type === "tool_use") push(runId, { kind: "tool", toolName: block.name, detail: preview(block.input) });
        }
      } else if (msg.type === "user") {
        const content = (msg as unknown as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content as { type: string; content?: unknown; is_error?: boolean }[]) {
            if (block.type === "tool_result") {
              push(runId, { kind: "tool-result", detail: preview(block.content, 300), text: block.is_error ? "error" : undefined });
            }
          }
        }
      } else if (msg.type === "result") {
        const res = msg as unknown as { subtype: string; result?: string; total_cost_usd?: number; num_turns?: number };
        r.meta.status = res.subtype === "success" ? "done" : "error";
        r.meta.result = res.result ?? "";
        r.meta.costUsd = res.total_cost_usd;
        r.meta.numTurns = res.num_turns;
        r.meta.endedAt = Date.now();
        if (res.subtype !== "success") r.meta.error = res.subtype;
        push(runId, { kind: "result", text: res.result ?? res.subtype });
      }
    }
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
  }
}

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
