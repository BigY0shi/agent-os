// Agents module — persistence. One directory per agent under ~/.agentic-os/agents/:
//
//   <id>/agent.json          definition (AgentDef)
//   <id>/system.md           curator-maintained system prompt (the instructions)
//   <id>/skills/*.md         refinable instruction docs (Phase 4)
//   <id>/memory/facts.md     durable distilled facts
//   <id>/memory/journal.md   multi-resolution run history (Phase 2 compaction)
//   <id>/runs/<runId>.jsonl  full event stream, append-only source of truth
//   <id>/runs/<runId>.meta.json
//   <id>/workspace/          the run cwd — scratch + artifacts
//   <id>/cursors.json        trigger state (Phase 3)
//
// Deleting an agent exiles the directory (house rule: nothing is destroyed).

import { readFile, writeFile, mkdir, readdir, rename, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { AgentDef, RunMeta, RunEvent, ApprovalReq } from "./agentsTypes";

const ROOT = path.join(os.homedir(), ".agentic-os", "agents");

export function agentDir(id: string): string { return path.join(ROOT, id); }
export function workspaceDir(id: string): string { return path.join(ROOT, id, "workspace"); }
export function runsDir(id: string): string { return path.join(ROOT, id, "runs"); }

async function ensure(dir: string) { await mkdir(dir, { recursive: true }).catch(() => {}); }

// Agent ids come from randomUUID, but they also arrive via URL params — never
// let a crafted id escape the agents root.
export function safeId(id: string): string | null {
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

export async function listAgents(): Promise<AgentDef[]> {
  await ensure(ROOT);
  const out: AgentDef[] = [];
  for (const entry of (await readdir(ROOT).catch(() => [] as string[]))) {
    if (entry.startsWith(".")) continue;
    try {
      out.push(JSON.parse(await readFile(path.join(ROOT, entry, "agent.json"), "utf8")) as AgentDef);
    } catch { /* not an agent dir */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadAgent(id: string): Promise<AgentDef | null> {
  try { return JSON.parse(await readFile(path.join(agentDir(id), "agent.json"), "utf8")) as AgentDef; }
  catch { return null; }
}

export async function saveAgent(def: AgentDef): Promise<void> {
  def.updatedAt = Date.now();
  await ensure(agentDir(def.id));
  await writeFile(path.join(agentDir(def.id), "agent.json"), JSON.stringify(def, null, 2), "utf8");
}

export async function createAgent(input: {
  name: string;
  description?: string;
  instructions: string;
  permissionMode?: AgentDef["permissionMode"];
  intelligence?: AgentDef["intelligence"];
}): Promise<AgentDef> {
  const id = randomUUID();
  const now = Date.now();
  const def: AgentDef = {
    id,
    name: input.name.trim().slice(0, 80) || "Unnamed agent",
    description: (input.description ?? "").trim().slice(0, 200),
    permissionMode: input.permissionMode ?? "gated",
    intelligence: input.intelligence ?? "standard",
    triggers: [{ type: "manual" }],
    tools: { mcp: "inherit", browser: false },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  for (const sub of ["", "skills", "memory", "runs", "workspace"]) await ensure(path.join(agentDir(id), sub));
  await writeFile(path.join(agentDir(id), "agent.json"), JSON.stringify(def, null, 2), "utf8");
  await writeFile(path.join(agentDir(id), "system.md"), input.instructions.trim() + "\n", "utf8");
  await writeFile(path.join(agentDir(id), "memory", "facts.md"), "# Facts\n", "utf8");
  await writeFile(path.join(agentDir(id), "memory", "journal.md"), "# Journal\n", "utf8");
  return def;
}

export async function readSystemPrompt(id: string): Promise<string> {
  try { return await readFile(path.join(agentDir(id), "system.md"), "utf8"); }
  catch { return ""; }
}

export async function writeSystemPrompt(id: string, text: string): Promise<void> {
  await writeFile(path.join(agentDir(id), "system.md"), text.trim() + "\n", "utf8");
}

/** Exile, never delete — the whole agent dir moves under agents/.exile/. */
export async function exileAgent(id: string): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(ROOT, ".exile", `${stamp}_${id}`);
  await ensure(path.join(ROOT, ".exile"));
  try { await rename(agentDir(id), dest); return true; }
  catch { return false; }
}

// ---- runs ----------------------------------------------------------------

export async function saveRunMeta(meta: RunMeta): Promise<void> {
  await ensure(runsDir(meta.agentId));
  await writeFile(path.join(runsDir(meta.agentId), `${meta.id}.meta.json`), JSON.stringify(meta, null, 2), "utf8");
}

export async function loadRunMeta(agentId: string, runId: string): Promise<RunMeta | null> {
  try { return JSON.parse(await readFile(path.join(runsDir(agentId), `${runId}.meta.json`), "utf8")) as RunMeta; }
  catch { return null; }
}

export async function listRuns(agentId: string, limit = 30): Promise<RunMeta[]> {
  const out: RunMeta[] = [];
  for (const f of (await readdir(runsDir(agentId)).catch(() => [] as string[]))) {
    if (!f.endsWith(".meta.json")) continue;
    try { out.push(JSON.parse(await readFile(path.join(runsDir(agentId), f), "utf8")) as RunMeta); }
    catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function appendRunEvent(agentId: string, runId: string, ev: RunEvent): Promise<void> {
  await ensure(runsDir(agentId));
  await appendFile(path.join(runsDir(agentId), `${runId}.jsonl`), JSON.stringify(ev) + "\n", "utf8");
}

export async function readRunEvents(agentId: string, runId: string, afterSeq = -1): Promise<RunEvent[]> {
  try {
    const raw = await readFile(path.join(runsDir(agentId), `${runId}.jsonl`), "utf8");
    const out: RunEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as RunEvent;
        if (ev.seq > afterSeq) out.push(ev);
      } catch { /* torn write mid-append — next poll gets it */ }
    }
    return out;
  } catch { return []; }
}

// ---- approvals (global queue, persisted so the UI survives a reload) ------

const APPROVALS = path.join(ROOT, "approvals.json");

export async function readApprovals(): Promise<ApprovalReq[]> {
  try { return JSON.parse(await readFile(APPROVALS, "utf8")) as ApprovalReq[]; }
  catch { return []; }
}

export async function writeApprovals(list: ApprovalReq[]): Promise<void> {
  await ensure(ROOT);
  await writeFile(APPROVALS, JSON.stringify(list, null, 1), "utf8");
}
