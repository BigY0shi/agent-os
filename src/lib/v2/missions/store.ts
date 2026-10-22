// S17 Missions (_design/jarvis-v3-plan.md): a dedicated Goal Mode. This file is the
// store only: mission records, the append-only event log, and each seat's scratch dir.
// runtime.ts moves missions between stages; nothing here spawns anything.
//
// Layout (AGENTIC_OS_MISSIONS_DIR redirects it for smokes):
//   ~/.agentic-os/missions/<id>/mission.json     the record (atomic write)
//   ~/.agentic-os/missions/<id>/events.jsonl     WHAT HAPPENED, IN ORDER (append-only)
//   ~/.agentic-os/missions/<id>/steps/<step>.log the seat's raw output while it runs
//   ~/.agentic-os/missions/<id>/steps/<step>.md  the seat's final answer
//   ~/.agentic-os/missions/<id>/seats/<step>/    the seat's own scratch dir (its cwd)
// Files, not a DB migration, so missions never compete for a migration number.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MissionAgent = "claude" | "hermes" | "codex" | "antigravity";
export const MISSION_AGENTS: MissionAgent[] = ["claude", "hermes", "codex", "antigravity"];
/** Which CLIs take a turn cap. codex and agy have none; the mission time limit bounds them. */
export const TURN_CAPPED: Record<MissionAgent, boolean> = { claude: true, hermes: true, codex: false, antigravity: false };
export const MAX_TURNS = 50;

export type MissionStage = "briefing" | "in-progress" | "review" | "delivered" | "stopped" | "failed";
export type StepStatus = "waiting" | "running" | "done" | "failed" | "stopped";
export type Priority = "low" | "normal" | "high";
export type ReportLength = "brief" | "standard" | "detailed";

export interface Seat { id: string; agent: MissionAgent; model?: string; role: string }

export interface Step {
  id: string;
  title: string;
  seatId: string;
  brief: string;
  dependsOn: string[];
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
  /** When the seat last printed anything (its real output, not a heartbeat). */
  lastHeardAt?: number;
  lastLine?: string;
  exitCode?: number | null;
  error?: string;
}

export interface MissionPlan { rationale: string; guardrails: string[]; steps: Step[]; plannedAt: number }

export interface Mission {
  id: string;
  name: string;
  objective: string;
  successLooksLike: string;
  priority: Priority;
  targetDate?: string; // YYYY-MM-DD
  teamMode: "jarvis" | "manual";
  seats: Seat[];
  limits: { timeLimitMin: number; maxSteps: number; reportLength: ReportLength };
  endAction: "review" | "deliver";
  stage: MissionStage;
  /** Busy doing something the owner is not asked about (planning, reporting). */
  working?: "planning" | "reporting" | null;
  plan?: MissionPlan;
  planApproved: boolean;
  createdAt: number;
  launchedAt?: number;
  deadlineAt?: number;
  finishedAt?: number;
  deliveredAt?: number;
  result?: string;
  /** The owner's last "send back" note, fed to the next plan or report. */
  note?: string;
  error?: string;
}

export type EventKind =
  | "created" | "planning" | "plan-ready" | "plan-failed" | "approved" | "sent-back"
  | "handoff" | "waiting" | "picked-up" | "step-done" | "step-failed" | "timeout"
  | "reporting" | "report-ready" | "report-failed" | "review" | "accepted" | "delivered"
  | "stopped" | "recovered";

export interface MissionEvent {
  at: number;
  kind: EventKind;
  text: string;
  stepId?: string;
  seatId?: string;
  /** For a hand-off: the exact brief the seat was sent. */
  brief?: string;
}

export class MissionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function missionsDir(): string {
  return process.env.AGENTIC_OS_MISSIONS_DIR || path.join(os.homedir(), ".agentic-os", "missions");
}
const ID_RE = /^m_[a-z0-9]{8,40}$/;
export function missionDir(id: string): string {
  if (!ID_RE.test(id)) throw new MissionError("bad mission id", 400);
  return path.join(missionsDir(), id);
}
const STEP_RE = /^s\d{1,2}$/;
export function stepFile(id: string, stepId: string, ext: "log" | "md"): string {
  if (!STEP_RE.test(stepId)) throw new MissionError("bad step id", 400);
  return path.join(missionDir(id), "steps", `${stepId}.${ext}`);
}
export function seatDir(id: string, stepId: string): string {
  if (!STEP_RE.test(stepId)) throw new MissionError("bad step id", 400);
  return path.join(missionDir(id), "seats", stepId);
}

export function newMissionId(): string { return `m_${randomUUID().replace(/-/g, "").slice(0, 16)}`; }

export function saveMission(m: Mission): void {
  const dir = missionDir(m.id);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "mission.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2), "utf8");
  renameSync(tmp, file);
}

export function loadMission(id: string): Mission | null {
  const file = path.join(missionDir(id), "mission.json");
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as Mission; }
  catch (e) { throw new MissionError(`mission ${id} is unreadable: ${(e as Error).message}`, 500); }
}

export function listMissions(): Mission[] {
  if (!existsSync(missionsDir())) return [];
  const out: Mission[] = [];
  for (const id of readdirSync(missionsDir())) {
    if (!ID_RE.test(id)) continue;
    try { const m = loadMission(id); if (m) out.push(m); } catch { /* one bad record never hides the rest */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function appendEvent(id: string, ev: Omit<MissionEvent, "at"> & { at?: number }): MissionEvent {
  const full: MissionEvent = { at: ev.at ?? Date.now(), ...ev } as MissionEvent;
  mkdirSync(missionDir(id), { recursive: true });
  appendFileSync(path.join(missionDir(id), "events.jsonl"), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function readEvents(id: string): MissionEvent[] {
  const file = path.join(missionDir(id), "events.jsonl");
  if (!existsSync(file)) return [];
  const out: MissionEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as MissionEvent); } catch { /* a torn last line is skipped, never fatal */ }
  }
  return out;
}

export function readStepOutput(id: string, stepId: string, kind: "log" | "md", maxChars = 200_000): string {
  const file = stepFile(id, stepId, kind);
  if (!existsSync(file)) return "";
  const txt = readFileSync(file, "utf8");
  return txt.length > maxChars ? "…[earlier output trimmed]\n" + txt.slice(-maxChars) : txt;
}

// ── input validation for a new mission ───────────────────────────────────────

const str = (v: unknown, max: number, what: string, required = true): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new MissionError(`${what} is required`);
  if (s.length > max) throw new MissionError(`${what} is longer than ${max} characters`);
  return s;
};

export interface NewMissionInput {
  name?: unknown; objective?: unknown; successLooksLike?: unknown; priority?: unknown; targetDate?: unknown;
  teamMode?: unknown; seats?: unknown; timeLimitMin?: unknown; maxSteps?: unknown; reportLength?: unknown; endAction?: unknown;
}

export function validateNewMission(input: NewMissionInput): Omit<Mission, "id" | "stage" | "planApproved" | "createdAt"> {
  const name = str(input.name, 120, "name");
  const objective = str(input.objective, 4000, "objective");
  const successLooksLike = str(input.successLooksLike, 2000, "what success looks like");
  const priority: Priority = input.priority === "low" || input.priority === "high" ? input.priority : "normal";
  let targetDate: string | undefined;
  if (typeof input.targetDate === "string" && input.targetDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) throw new MissionError("target date must be YYYY-MM-DD");
    targetDate = input.targetDate;
  }
  const teamMode = input.teamMode === "manual" ? "manual" : "jarvis";
  let seats: Seat[] = [];
  if (teamMode === "manual") {
    if (!Array.isArray(input.seats) || input.seats.length === 0 || input.seats.length > 6) throw new MissionError("pick 1 to 6 crew members");
    seats = input.seats.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (!MISSION_AGENTS.includes(r.agent as MissionAgent)) throw new MissionError(`crew member ${i + 1}: unknown agent`);
      const model = typeof r.model === "string" && r.model.trim() ? r.model.trim() : undefined;
      if (model && !/^[A-Za-z0-9._:/-]{1,80}$/.test(model)) throw new MissionError(`crew member ${i + 1}: model name has characters it cannot`);
      return { id: `c${i + 1}`, agent: r.agent as MissionAgent, model, role: str(r.role, 200, `crew member ${i + 1} role`, false) || "generalist" };
    });
  }
  const timeLimitMin = Number(input.timeLimitMin ?? 60);
  if (!Number.isFinite(timeLimitMin) || timeLimitMin < 15 || timeLimitMin > 480) throw new MissionError("time limit must be 15 minutes to 8 hours");
  const maxSteps = Number(input.maxSteps ?? 5);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new MissionError("maximum steps must be 1 to 12");
  const reportLength: ReportLength = input.reportLength === "brief" || input.reportLength === "detailed" ? input.reportLength : "standard";
  const endAction = input.endAction === "deliver" ? "deliver" : "review";
  return { name, objective, successLooksLike, priority, targetDate, teamMode, seats, limits: { timeLimitMin, maxSteps, reportLength }, endAction };
}
