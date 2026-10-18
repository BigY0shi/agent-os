// S36 Fleet stats (Nexora C9, owner 2026-10-01: "it doesn't need to be hourly. Maybe
// bidaily or so. But yes, we will need these metrics.").
//
// Two-line sparklines (you vs agents) over a window, an activity heatmap in the owner's
// timezone, the most recent hand-offs between agents, and session counts (last 24 h and
// total). EVERY number here is counted from a stored record: a message row, a run record
// on disk, a mission event. A source Agent OS does not record is listed as "not tracked"
// (the tokenLog.ts convention), never shown as 0 and never estimated. An empty fleet
// produces zero buckets and an empty list, not activity.
//
// Bucket size and window length are settings (fleetStats.bucketHours / windowDays, both
// in the card's gear); the timezone is tasks.timezone, the single timezone source. All
// three are read per request, so changing them re-buckets with no rebuild.
//
// Pure functions (bucketize, heatmap, buildFleetStats) take their inputs as arguments so
// the smoke can prove the math on seeded rows; readFleetStats() is the one that reads the
// real stores.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readSettings } from "@/lib/settings";
import { getDb } from "@/lib/v2/db";
import { listAgents, runsDir } from "@/lib/agentsStore";
import type { RunMeta } from "@/lib/agentsTypes";
import { listModuleRuns } from "@/lib/moduleRuns";
import { listMissions, readEvents, type Mission } from "@/lib/v2/missions/store";
import { listRuns as listUltracodeRuns } from "@/lib/ultracodeRuns";
import { OWNER_TRIGGERS } from "@/lib/v2/crew/crew";

const H = 3_600_000;
const DAY = 24 * H;

export const BUCKET_CHOICES = [6, 12, 24, 48] as const;
export const WINDOW_CHOICES = [7, 14, 30, 60] as const;
export const DEFAULT_BUCKET_HOURS = 12;
export const DEFAULT_WINDOW_DAYS = 14;
export const HANDOFF_LIMIT = 12;

export type Who = "you" | "agents";

/** One thing that happened at a moment: the owner acted, or an agent did. */
export interface FleetEvent { at: number; who: Who; source: string }

export interface Handoff {
  at: number;
  missionId: string;
  mission: string;
  step: string;
  /** Who handed the step over: Jarvis, or the agents of the steps it depended on. */
  from: string;
  /** The seat that received it: agent plus role. */
  to: string;
}

export type SessionSource =
  | { id: string; label: string; tracked: true; last24h: number; total: number }
  | { id: string; label: string; tracked: false; reason: string };

/** What the collector hands the pure builder. */
export interface FleetSources {
  events: FleetEvent[];
  handoffs: Handoff[];
  sessions: SessionSource[];
  errors: Record<string, string>;
}

export interface FleetStatsOptions {
  now: number;
  bucketHours: number;
  windowDays: number;
  timeZone: string;
}

export interface FleetBucket { start: number; you: number; agents: number }

export interface FleetStats {
  generatedAt: number;
  timeZone: string;
  bucketHours: number;
  windowDays: number;
  window: { start: number; end: number };
  /** Oldest first; the last bucket is the one still filling. */
  buckets: FleetBucket[];
  totals: { you: number; agents: number };
  /** 7 rows (Mon..Sun) by 24 hours, in the owner's timezone, over the window. */
  heat: { days: string[]; you: number[][]; agents: number[][] };
  handoffs: Handoff[];
  sessions: { sources: SessionSource[]; last24h: number; total: number; untracked: number };
  basis: { you: string; agents: string };
  errors: Record<string, string>;
}

// ── timezone math ─────────────────────────────────────────────────────────────
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when Intl knows the zone; an unknown zone must not silently become the server's. */
export function isValidTimeZone(tz: string): boolean {
  try { formatter(tz); return true; } catch { return false; }
}

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

/** Wall-clock parts of a moment in a zone. weekday is 0 = Monday .. 6 = Sunday. */
export function localParts(ts: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(ts));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")) % 24, minute: Number(get("minute")), second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** The epoch ms of local midnight (in the zone) on the day `ts` falls on. */
export function zonedMidnight(ts: number, timeZone: string): number {
  const sec = Math.floor(ts / 1000) * 1000;
  const p = localParts(sec, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asUtc - sec; // zone offset at that moment
  return Date.UTC(p.year, p.month - 1, p.day) - offset;
}

// ── pure math ─────────────────────────────────────────────────────────────────
/** The window the sparklines and heatmap cover: from local midnight `windowDays` ago to now. */
export function windowOf(opts: FleetStatsOptions): { start: number; end: number } {
  return { start: zonedMidnight(opts.now - opts.windowDays * DAY, opts.timeZone), end: opts.now };
}

/** Counts events per bucket of `bucketHours`, aligned to the window's local midnight start. */
export function bucketize(events: FleetEvent[], opts: FleetStatsOptions): FleetBucket[] {
  const { start, end } = windowOf(opts);
  const bucketMs = opts.bucketHours * H;
  const n = Math.max(1, Math.ceil((end - start) / bucketMs));
  const out: FleetBucket[] = Array.from({ length: n }, (_, i) => ({ start: start + i * bucketMs, you: 0, agents: 0 }));
  for (const e of events) {
    if (!Number.isFinite(e.at) || e.at < start || e.at > end) continue;
    out[Math.min(n - 1, Math.floor((e.at - start) / bucketMs))][e.who]++;
  }
  return out;
}

/** Weekday x hour counts in the zone, over the window. */
export function heatmap(events: FleetEvent[], opts: FleetStatsOptions): FleetStats["heat"] {
  const { start, end } = windowOf(opts);
  const grid = (): number[][] => WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  const you = grid(), agents = grid();
  for (const e of events) {
    if (!Number.isFinite(e.at) || e.at < start || e.at > end) continue;
    const p = localParts(e.at, opts.timeZone);
    (e.who === "you" ? you : agents)[p.weekday][p.hour]++;
  }
  return { days: [...WEEKDAYS], you, agents };
}

export const BASIS = {
  you: "your messages to Jarvis, Rabbit and task chats, runs you triggered, missions you created",
  agents: "agent replies, agent runs, module runs, mission steps and Ultracode runs, at the moment they started",
};

/** Builds the whole picture from collected sources; pure, so the smoke can seed it. */
export function buildFleetStats(src: FleetSources, opts: FleetStatsOptions): FleetStats {
  const buckets = bucketize(src.events, opts);
  const totals = buckets.reduce((t, b) => ({ you: t.you + b.you, agents: t.agents + b.agents }), { you: 0, agents: 0 });
  const tracked = src.sessions.filter((s): s is Extract<SessionSource, { tracked: true }> => s.tracked);
  const handoffs = [...src.handoffs].sort((a, b) => b.at - a.at).slice(0, HANDOFF_LIMIT);
  return {
    generatedAt: opts.now,
    timeZone: opts.timeZone,
    bucketHours: opts.bucketHours,
    windowDays: opts.windowDays,
    window: windowOf(opts),
    buckets,
    totals,
    heat: heatmap(src.events, opts),
    handoffs,
    sessions: {
      sources: src.sessions,
      last24h: tracked.reduce((n, s) => n + s.last24h, 0),
      total: tracked.reduce((n, s) => n + s.total, 0),
      untracked: src.sessions.length - tracked.length,
    },
    basis: BASIS,
    errors: src.errors,
  };
}

// ── settings ──────────────────────────────────────────────────────────────────
export function fleetStatsOptions(now = Date.now()): FleetStatsOptions & { errors: Record<string, string> } {
  const s = readSettings();
  const errors: Record<string, string> = {};
  const bucketRaw = Number(s.fleetStats?.bucketHours ?? DEFAULT_BUCKET_HOURS);
  const windowRaw = Number(s.fleetStats?.windowDays ?? DEFAULT_WINDOW_DAYS);
  const bucketHours = (BUCKET_CHOICES as readonly number[]).includes(bucketRaw) ? bucketRaw : DEFAULT_BUCKET_HOURS;
  const windowDays = (WINDOW_CHOICES as readonly number[]).includes(windowRaw) ? windowRaw : DEFAULT_WINDOW_DAYS;
  if (bucketHours !== bucketRaw) errors.bucketHours = `fleetStats.bucketHours ${bucketRaw} is not one of ${BUCKET_CHOICES.join("/")}; using ${DEFAULT_BUCKET_HOURS}`;
  if (windowDays !== windowRaw) errors.windowDays = `fleetStats.windowDays ${windowRaw} is not one of ${WINDOW_CHOICES.join("/")}; using ${DEFAULT_WINDOW_DAYS}`;
  const tzRaw = s.tasks?.timezone ?? "UTC";
  let timeZone = tzRaw;
  if (!isValidTimeZone(tzRaw)) { timeZone = "UTC"; errors.timeZone = `tasks.timezone "${tzRaw}" is not a known zone; showing UTC`; }
  return { now, bucketHours, windowDays, timeZone, errors };
}

// ── the collector: stored records only ────────────────────────────────────────
interface CountRow { n: number }

function readRunMetas(agentId: string): RunMeta[] {
  const dir = runsDir(agentId);
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { return []; }
  const out: RunMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".meta.json")) continue;
    try { out.push(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as RunMeta); } catch { /* torn record: skip, never invent */ }
  }
  return out;
}

function seatName(m: Mission, seatId: string): string {
  const seat = m.seats.find((s) => s.id === seatId);
  return seat ? `${seat.agent}${seat.role ? ` (${seat.role})` : ""}` : seatId;
}

/** Reads every store that records fleet activity. Each source fails on its own: a store
 *  that cannot be read becomes a "not tracked" row with the reason, and the rest still count. */
export async function collectFleetSources(now: number, windowStart: number): Promise<FleetSources> {
  const events: FleetEvent[] = [];
  const handoffs: Handoff[] = [];
  const sessions: SessionSource[] = [];
  const errors: Record<string, string> = {};
  const sinceIso = new Date(windowStart).toISOString();
  const dayAgoIso = new Date(now - DAY).toISOString();
  const dayAgo = now - DAY;

  const source = async (id: string, label: string, fn: () => Promise<{ last24h: number; total: number }> | { last24h: number; total: number }) => {
    try {
      const c = await fn();
      sessions.push({ id, label, tracked: true, last24h: c.last24h, total: c.total });
    } catch (e) {
      const reason = String((e as Error)?.message ?? e).slice(0, 200);
      errors[id] = reason;
      sessions.push({ id, label, tracked: false, reason });
    }
  };

  const db = (() => { try { return getDb(); } catch (e) { errors.db = String((e as Error)?.message ?? e); return null; } })();
  const needDb = () => { if (!db) throw new Error(errors.db ?? "database unavailable"); return db; };
  const count = (sql: string, ...args: unknown[]) => (needDb().prepare(sql).get(...args) as CountRow).n;

  // Jarvis: the owner's words and Jarvis's replies, one conversation = one session.
  await source("jarvis", "Jarvis conversations", () => {
    const rows = needDb().prepare("SELECT role, created_at FROM jarvis_messages WHERE created_at >= ?").all(sinceIso) as { role: string; created_at: string }[];
    for (const r of rows) {
      const at = Date.parse(r.created_at);
      if (r.role === "user") events.push({ at, who: "you", source: "jarvis" });
      else if (r.role === "assistant") events.push({ at, who: "agents", source: "jarvis" });
    }
    return { total: count("SELECT COUNT(*) AS n FROM jarvis_conversations"), last24h: count("SELECT COUNT(*) AS n FROM jarvis_conversations WHERE created_at >= ?", dayAgoIso) };
  });

  // Rabbit: same shape.
  await source("rabbit", "Rabbit sessions", () => {
    const rows = needDb().prepare("SELECT role, created_at FROM rabbit_messages WHERE created_at >= ?").all(sinceIso) as { role: string; created_at: string }[];
    for (const r of rows) {
      const at = Date.parse(r.created_at);
      if (r.role === "user") events.push({ at, who: "you", source: "rabbit" });
      else if (r.role === "assistant") events.push({ at, who: "agents", source: "rabbit" });
    }
    return { total: count("SELECT COUNT(*) AS n FROM rabbit_sessions"), last24h: count("SELECT COUNT(*) AS n FROM rabbit_sessions WHERE created_at >= ?", dayAgoIso) };
  });

  // Task chats: only a human's own words count as "you"; trigger messages are system-sent.
  await source("task-chats", "Task chats", () => {
    const rows = needDb().prepare("SELECT role, user_type, ephemeral, created_at FROM v2_messages WHERE created_at >= ?").all(sinceIso) as { role: string; user_type: string; ephemeral: number; created_at: string }[];
    for (const r of rows) {
      const at = Date.parse(r.created_at);
      if (r.role === "user" && r.user_type === "human" && !r.ephemeral) events.push({ at, who: "you", source: "task-chats" });
      else if (r.role === "assistant") events.push({ at, who: "agents", source: "task-chats" });
    }
    return { total: count("SELECT COUNT(*) AS n FROM v2_conversations"), last24h: count("SELECT COUNT(*) AS n FROM v2_conversations WHERE created_at >= ?", dayAgoIso) };
  });

  // Task sessions: the coding / browser / exec slots a task opened (rows only, no events: the
  // chat above already carries the words).
  await source("task-sessions", "Task sessions (coding, browser, exec)", () => ({
    total: count("SELECT COUNT(*) AS n FROM v2_task_sessions"),
    last24h: count("SELECT COUNT(*) AS n FROM v2_task_sessions WHERE created_at >= ?", dayAgoIso),
  }));

  // Agent runs (~/.agentic-os/agents/<id>/runs/*.meta.json): the agent acts when the run starts;
  // a run the owner triggered (manual, crew-chat; the Crew convention) is also the owner acting.
  await source("agent-runs", "Agent runs", async () => {
    let total = 0, last24h = 0;
    for (const def of await listAgents()) {
      for (const m of readRunMetas(def.id)) {
        if (!Number.isFinite(m.startedAt)) continue;
        total++;
        if (m.startedAt >= dayAgo) last24h++;
        if (m.startedAt < windowStart) continue;
        events.push({ at: m.startedAt, who: "agents", source: "agent-runs" });
        if (OWNER_TRIGGERS.has(m.trigger)) events.push({ at: m.startedAt, who: "you", source: "agent-runs" });
      }
    }
    return { total, last24h };
  });

  // Module runs: the registry keeps every running run plus the last 50 finished, so this
  // total is the registry's, not all time; the label says so.
  await source("module-runs", "Module runs (the registry keeps the last 50 finished)", () => {
    const runs = listModuleRuns({ includeDismissed: true });
    for (const r of runs) if (r.startedAt >= windowStart) events.push({ at: r.startedAt, who: "agents", source: "module-runs" });
    return { total: runs.length, last24h: runs.filter((r) => r.startedAt >= dayAgo).length };
  });

  // Missions: created by the owner; every step that started is an agent at work; a
  // "handoff" event is Jarvis (or the steps it depended on) passing work to a seat.
  await source("missions", "Missions", () => {
    const missions = listMissions();
    let last24h = 0;
    for (const m of missions) {
      if (m.createdAt >= dayAgo) last24h++;
      if (m.createdAt >= windowStart) events.push({ at: m.createdAt, who: "you", source: "missions" });
      const steps = m.plan?.steps ?? [];
      for (const s of steps) if (typeof s.startedAt === "number" && s.startedAt >= windowStart) events.push({ at: s.startedAt, who: "agents", source: "missions" });
      for (const ev of readEvents(m.id)) {
        if (ev.kind !== "handoff" || !ev.stepId || !ev.seatId) continue;
        const step = steps.find((s) => s.id === ev.stepId);
        const upstream = [...new Set((step?.dependsOn ?? []).map((id) => steps.find((s) => s.id === id)?.seatId).filter((x): x is string => !!x).map((sid) => seatName(m, sid)))];
        handoffs.push({ at: ev.at, missionId: m.id, mission: m.name, step: step?.title ?? ev.stepId, from: upstream.length ? upstream.join(", ") : "Jarvis", to: seatName(m, ev.seatId) });
      }
    }
    return { total: missions.length, last24h };
  });

  // Ultracode runs (~/.agentic-os/ultracode-runs/*.json).
  await source("ultracode", "Ultracode runs", async () => {
    const runs = await listUltracodeRuns(100_000);
    for (const r of runs) if (r.startedAt >= windowStart) events.push({ at: r.startedAt, who: "agents", source: "ultracode" });
    return { total: runs.length, last24h: runs.filter((r) => r.startedAt >= dayAgo).length };
  });

  // Hermes keeps its own state.db and Agent OS has no reader for it (C9 names it as a
  // source; nothing in src/lib opens it). Said plainly rather than shown as 0.
  sessions.push({ id: "hermes", label: "Hermes sessions", tracked: false, reason: "Hermes keeps its own state.db; Agent OS does not read it" });

  return { events, handoffs, sessions, errors };
}

/** The whole thing from the live stores with the current settings. */
export async function readFleetStats(now = Date.now()): Promise<FleetStats> {
  const { errors: optErrors, ...opts } = fleetStatsOptions(now);
  const src = await collectFleetSources(now, windowOf(opts).start);
  const stats = buildFleetStats(src, opts);
  stats.errors = { ...optErrors, ...stats.errors };
  return stats;
}
