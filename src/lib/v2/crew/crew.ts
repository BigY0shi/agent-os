// S21 Crew (_design/jarvis-v3-plan.md): the owner's configured agents as a crew, with
// counts measured from their real runs (lib/agentsStore). Nothing here is estimated:
//   messages   one run = one message to the agent (its trigger) and one reply (its end)
//   reply time a run's end minus its start
//   heatmap    owner messages = starts of runs the owner sent (manual, crew chat);
//              agent replies = ends of every run; bucketed by the server's local hour
// Agent-to-agent hand-offs are not recorded anywhere yet, so none are drawn.
//
// Crew chat: the drawer's messages to one agent. Each message starts a real run of that
// agent (trigger "crew-chat"); the log keeps only what the owner wrote and the run id,
// and the reply is read from that run's own record, never copied or made up.
// Log: ~/.agentic-os/crew/<agentId>.jsonl (AGENTIC_OS_CREW_DIR for smokes).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentDef, BandStatus, RunMeta } from "@/lib/agentsTypes";

export const OWNER_TRIGGERS = new Set(["manual", "crew-chat"]);
const DAY = 86_400_000;

export interface CrewAgent {
  id: string; name: string; description: string; enabled: boolean; intelligence: string;
  status: BandStatus; detail: string | null;
  runs7d: number; avgReplyMs: number | null; tokens7d: number; sessions: number; lastAt: number | null;
}
export interface CrewActivity { agentId: string; agent: string; what: string; source: string; at: number; tokens: number | null; status: string }
export interface CrewSnapshot {
  counts: { agents: number; workingNow: number; messages7d: number; avgReplyMs: number | null; agentTimeMonthMs: number };
  agents: CrewAgent[];
  heat: { owner7d: number[][]; agent7d: number[][]; owner24h: number[]; agent24h: number[]; days: string[] };
  recent: CrewActivity[];
  basis: string;
}

export interface CrewInputs {
  agents: AgentDef[];
  runs: Map<string, RunMeta[]>;
  status: Map<string, { status: BandStatus; detail?: string }>;
  now?: number;
}

/** Pure: everything the Crew view shows, from agent definitions, runs and live status. */
export function buildCrewSnapshot({ agents, runs, status, now = Date.now() }: CrewInputs): CrewSnapshot {
  const weekAgo = now - 7 * DAY;
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const owner7d = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const agent7d = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const owner24h = Array(24).fill(0) as number[];
  const agent24h = Array(24).fill(0) as number[];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dayIndex = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return 6 - Math.round((today.getTime() - d.getTime()) / DAY); };
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY).toLocaleDateString("en-US", { weekday: "short" }));

  let messages7d = 0, replyTotal = 0, replyN = 0, monthMs = 0, working = 0;
  const recent: CrewActivity[] = [];
  const rows: CrewAgent[] = agents.map((a) => {
    const list = runs.get(a.id) ?? [];
    const st = status.get(a.id);
    if (st?.status === "running") working++;
    let r7 = 0, rTot = 0, rN = 0, tok = 0, last: number | null = null;
    for (const r of list) {
      const end = r.endedAt ?? null;
      last = Math.max(last ?? 0, end ?? r.startedAt);
      if (r.startedAt >= weekAgo) {
        r7++;
        if (r.tokens) tok += r.tokens;
        if (end) { rTot += end - r.startedAt; rN++; }
        if (OWNER_TRIGGERS.has(r.trigger)) {
          const di = dayIndex(r.startedAt);
          if (di >= 0 && di < 7) owner7d[di][new Date(r.startedAt).getHours()]++;
        }
      }
      if (end && end >= weekAgo) { const di = dayIndex(end); if (di >= 0 && di < 7) agent7d[di][new Date(end).getHours()]++; }
      if (OWNER_TRIGGERS.has(r.trigger) && r.startedAt >= now - DAY) owner24h[new Date(r.startedAt).getHours()]++;
      if (end && end >= now - DAY) agent24h[new Date(end).getHours()]++;
      if (r.startedAt >= monthStart && end) monthMs += end - r.startedAt;
      recent.push({
        agentId: a.id, agent: a.name,
        what: r.status === "running" ? "working" : r.status === "error" ? `failed${r.error ? `: ${r.error.slice(0, 100)}` : ""}` : r.status === "killed" ? "stopped" : r.status === "waiting" ? "waiting for you" : (r.result ?? "finished").split("\n").find((l) => l.trim())?.slice(0, 140) ?? "finished",
        source: r.trigger, at: end ?? r.startedAt, tokens: r.tokens ?? null, status: r.status,
      });
    }
    messages7d += r7; replyTotal += rTot; replyN += rN;
    return {
      id: a.id, name: a.name, description: a.description, enabled: a.enabled, intelligence: a.intelligence,
      status: st?.status ?? (a.enabled ? "idle" : "offline"), detail: st?.detail ?? null,
      runs7d: r7, avgReplyMs: rN ? Math.round(rTot / rN) : null, tokens7d: tok, sessions: list.length, lastAt: last,
    };
  });
  recent.sort((x, y) => y.at - x.at);
  return {
    counts: { agents: agents.length, workingNow: working, messages7d, avgReplyMs: replyN ? Math.round(replyTotal / replyN) : null, agentTimeMonthMs: monthMs },
    agents: rows,
    heat: { owner7d, agent7d, owner24h, agent24h, days },
    recent: recent.slice(0, 20),
    basis: "each agent's recorded runs (up to its last 500); a run is one message and one reply",
  };
}

// ── crew chat log ────────────────────────────────────────────────────────────

export function crewDir(): string {
  return process.env.AGENTIC_OS_CREW_DIR || path.join(os.homedir(), ".agentic-os", "crew");
}
const logFile = (agentId: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(agentId)) throw new Error("bad agent id");
  return path.join(crewDir(), `${agentId}.jsonl`);
};

export interface OwnerLine { at: number; text: string; runId: string | null; error?: string }
export function appendOwnerLine(agentId: string, line: OwnerLine): void {
  mkdirSync(crewDir(), { recursive: true });
  appendFileSync(logFile(agentId), JSON.stringify(line) + "\n", "utf8");
}
export function readOwnerLines(agentId: string, limit = 60): OwnerLine[] {
  const f = logFile(agentId);
  if (!existsSync(f)) return [];
  const out: OwnerLine[] = [];
  for (const l of readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } }
  return out.slice(-limit);
}

export interface ChatTurn { at: number; role: "owner" | "agent"; text: string; runId?: string; status?: string; pending?: boolean }
/** The conversation: each owner line followed by what its run actually returned. */
export function chatFrom(lines: OwnerLine[], metas: Map<string, RunMeta | null>): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const l of lines) {
    turns.push({ at: l.at, role: "owner", text: l.text, runId: l.runId ?? undefined });
    if (l.error) { turns.push({ at: l.at, role: "agent", text: `Could not start: ${l.error}`, status: "error" }); continue; }
    const m = l.runId ? metas.get(l.runId) : null;
    if (!m) { turns.push({ at: l.at, role: "agent", text: "The run's record is missing.", status: "missing" }); continue; }
    if (m.status === "running" || m.status === "waiting") turns.push({ at: m.startedAt, role: "agent", text: m.status === "waiting" ? "Waiting for your approval in Agents." : "Working…", runId: m.id, status: m.status, pending: true });
    else turns.push({ at: m.endedAt ?? m.startedAt, role: "agent", text: m.status === "done" ? (m.result?.trim() || "(finished with no text)") : m.status === "killed" ? "Stopped." : `Failed${m.error ? `: ${m.error}` : "."}`, runId: m.id, status: m.status });
  }
  return turns;
}
