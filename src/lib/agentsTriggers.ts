// Agents module — Phase 3: the trigger engine. One scheduler loop in the server
// process ticks every minute and evaluates every enabled agent's pollers:
//
//   gmail     interval check-run — the RUN does the checking (via the inherited
//             Gmail MCP) and keeps its own seen-list in memory/gmail-seen.md;
//             the server only rate-limits. Costs one model call per interval, so
//             intervals should be generous (min enforced below).
//   webwatch  server-side fetch + content hash; fires a run only on change. Free
//             between changes — no model cost while nothing happens.
//   filewatch server-side directory scan (mtime > cursor, optional glob). Poll-
//             based on purpose: fs.watch is unreliable on Windows.
//   schedule  cron via croner; fires when a scheduled time passed since lastFire.
//
// Webhooks don't live here — they're push, handled by /api/agents/hook/<id>.
// Missed fires while the server is down are NOT replayed (documented in spec).

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Cron } from "croner";
import type { AgentDef, AgentTrigger } from "./agentsTypes";
import { agentDir, listAgents } from "./agentsStore";
import { startRun } from "./agentsRuntime";
import { lifecycleAllowsTriggers } from "./v2/agents/lifecycle";

const TICK_MS = 60_000;
const MIN_GMAIL_INTERVAL = 10;   // minutes — a check-run costs a model call
const MIN_WATCH_INTERVAL = 5;    // minutes — webwatch fetches are cheap but be polite

interface TriggerCursor {
  lastFire?: number;
  hash?: string;      // webwatch
  since?: number;     // filewatch high-water mark
}
type Cursors = Record<string, TriggerCursor>;

async function readCursors(agentId: string): Promise<Cursors> {
  try { return JSON.parse(await readFile(path.join(agentDir(agentId), "cursors.json"), "utf8")) as Cursors; }
  catch { return {}; }
}
async function writeCursors(agentId: string, c: Cursors): Promise<void> {
  await writeFile(path.join(agentDir(agentId), "cursors.json"), JSON.stringify(c, null, 2), "utf8").catch(() => {});
}

// Key by content, not array index, so re-ordering triggers doesn't orphan state.
function trigKey(t: AgentTrigger): string {
  switch (t.type) {
    case "gmail": return `gmail:${t.query}`;
    case "webwatch": return `webwatch:${t.url}`;
    case "filewatch": return `filewatch:${t.path}:${t.glob ?? "*"}`;
    case "schedule": return `schedule:${t.cron}`;
    default: return t.type;
  }
}

function globToRegex(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/\\\\]*").replace(/\?/g, ".") + "$", "i");
}

async function fetchHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "AgentOS-webwatch/1.0" } });
    if (!res.ok) return null;
    // Collapse whitespace so formatting-only churn (and most timestamps in
    // attributes) doesn't fire false positives on every poll.
    const text = (await res.text()).replace(/\s+/g, " ");
    return createHash("sha256").update(text).digest("hex");
  } catch { return null; }
}

async function evalTrigger(def: AgentDef, t: AgentTrigger, cur: TriggerCursor, now: number): Promise<{ fire?: string; cursor: TriggerCursor }> {
  if (t.type === "gmail") {
    const interval = Math.max(t.intervalMin || 30, MIN_GMAIL_INTERVAL) * 60_000;
    if (now - (cur.lastFire ?? 0) < interval) return { cursor: cur };
    return {
      fire:
        `Gmail check. Search the inbox with the Gmail tools for: ${t.query}\n` +
        `Compare the message ids against your seen-list in ../memory/gmail-seen.md (relative to your workspace cwd; create it if missing). ` +
        `Process ONLY unseen messages per your standing instructions, then append their ids to the seen-list (keep the newest 500 lines). ` +
        `If nothing is new, reply exactly: NOTHING-NEW and stop immediately.`,
      cursor: { ...cur, lastFire: now },
    };
  }

  if (t.type === "webwatch") {
    const interval = Math.max(t.intervalMin || 30, MIN_WATCH_INTERVAL) * 60_000;
    if (now - (cur.lastFire ?? 0) < interval) return { cursor: cur };
    const hash = await fetchHash(t.url);
    if (!hash) return { cursor: { ...cur, lastFire: now } };            // unreachable — try again next interval
    if (!cur.hash) return { cursor: { ...cur, lastFire: now, hash } };  // first observation = baseline, no fire
    if (hash === cur.hash) return { cursor: { ...cur, lastFire: now } };
    return {
      fire: `Watched page changed: ${t.url}\nFetch it, work out what changed since your last look (your journal may have notes), and act per your standing instructions.`,
      cursor: { ...cur, lastFire: now, hash },
    };
  }

  if (t.type === "filewatch") {
    const since = cur.since ?? now;   // first tick baselines — don't replay history
    let names: string[] = [];
    try {
      const re = t.glob ? globToRegex(t.glob) : null;
      for (const f of await readdir(t.path)) {
        if (re && !re.test(f)) continue;
        try {
          const s = await stat(path.join(t.path, f));
          if (s.isFile() && s.mtimeMs > since) names.push(f);
        } catch { /* vanished mid-scan */ }
      }
    } catch { return { cursor: cur }; } // dir missing — leave cursor alone
    names = names.slice(0, 20);
    if (!names.length) return { cursor: { ...cur, since: Math.max(since, now - TICK_MS) } };
    return {
      fire: `New file(s) in ${t.path}: ${names.join(", ")}\nProcess them per your standing instructions.`,
      cursor: { ...cur, since: now, lastFire: now },
    };
  }

  if (t.type === "schedule") {
    const expr = normalizeSchedule(t.cron);
    if (!expr) {
      warnOnce(`schedule "${t.cron}" is neither a cron expression nor a recognizable phrase — this trigger will NEVER fire until it is fixed`);
      return { cursor: cur };
    }
    try {
      const from = new Date(cur.lastFire ?? Date.now() - TICK_MS);
      const next = new Cron(expr).nextRun(from);
      if (next && next.getTime() <= now) {
        return { fire: `Scheduled run (${t.cron}). Carry out your standing instructions.`, cursor: { ...cur, lastFire: now } };
      }
    } catch { warnOnce(`schedule "${t.cron}" (normalized "${expr}") failed in croner — trigger inert`); }
    return { cursor: cur };
  }

  return { cursor: cur };
}

// ── Schedule normalization ─────────────────────────────────────────────────────
//
// Root cause of the first silent no-fire (2026-07-31): the UI placeholder read
// "0 8 * * * (8am daily)" and the operator reasonably typed "8am Daily" — which
// croner throws on, and the old catch swallowed FOREVER with no trace. Two rules
// now: common human phrases are accepted, and anything unparseable is loud.

/** Warn once per distinct message per server process — a bad schedule is re-evaluated every minute. */
function warnOnce(msg: string): void {
  const g = globalThis as unknown as { __agentsWarned?: Set<string> };
  (g.__agentsWarned ??= new Set());
  if (g.__agentsWarned.has(msg)) return;
  g.__agentsWarned.add(msg);
  console.warn(`[agents] ${msg}`);
}

/**
 * Accept a real cron expression as-is, else translate common natural phrases:
 *   "8am daily" / "daily at 8:30pm" / "every day at 7am"   -> "m H * * *"
 *   "hourly" / "every 2 hours" / "every 15 minutes"        -> interval crons
 *   "midnight" -> 0 0; "noon" -> 0 12 (optionally + "daily")
 *   "mondays 9am" / "every tuesday at 17:30"               -> "m H * * dow"
 *   "weekdays 9am" / "weekends noon"                       -> 1-5 / 0,6
 * Returns a cron string croner accepts, or null when unrecognizable.
 * Exported for direct verification without a rebuild.
 */
export function normalizeSchedule(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Already valid? croner is the authority.
  try { new Cron(s); return s; } catch { /* fall through to phrases */ }

  const p = s.toLowerCase().replace(/\s+/g, " ").trim();

  if (/^(hourly|every hour)$/.test(p)) return "0 * * * *";
  let m = p.match(/^every (\d{1,2}) ?(minutes?|mins?)$/);
  if (m) return `*/${Math.min(59, Math.max(1, +m[1]))} * * * *`;
  m = p.match(/^every (\d{1,2}) ?(hours?|hrs?)$/);
  if (m) return `0 */${Math.min(23, Math.max(1, +m[1]))} * * *`;

  const DOW: Record<string, string> = {
    sunday: "0", monday: "1", tuesday: "2", wednesday: "3", thursday: "4", friday: "5", saturday: "6",
  };
  // Day scope: daily (default), weekdays, weekends, or a named weekday.
  let dow = "*";
  let rest = p;
  const dayWord = p.match(/\b(weekdays|weekends|(?:sun|mon|tues|wednes|thurs|fri|satur)days?)\b/);
  if (dayWord) {
    const w = dayWord[1];
    if (w === "weekdays") dow = "1-5";
    else if (w === "weekends") dow = "0,6";
    else dow = DOW[w.replace(/s$/, "")] ?? "*";
    rest = p.replace(dayWord[0], " ");
  }
  rest = rest.replace(/\b(every ?day|everyday|daily|each day|every|at|on)\b/g, " ").replace(/\s+/g, " ").trim();

  // Time: "8am", "8:30pm", "17:30", "noon", "midnight". Bare "8" is ambiguous — reject.
  if (rest === "noon") return `0 12 * * ${dow}`;
  if (rest === "midnight") return `0 0 * * ${dow}`;
  m = rest.match(/^(\d{1,2})(?::(\d{2}))? ?(am|pm)$/);
  if (m) {
    let h = +m[1] % 12;
    if (m[3] === "pm") h += 12;
    return `${+(m[2] ?? 0)} ${h} * * ${dow}`;
  }
  m = rest.match(/^(\d{1,2}):(\d{2})$/);
  if (m && +m[1] <= 23 && +m[2] <= 59) return `${+m[2]} ${+m[1]} * * ${dow}`;
  // A pure day phrase with no time ("mondays") defaults to 9am — a sane standup hour.
  if (rest === "" && dow !== "*") return `0 9 * * ${dow}`;

  return null;
}

async function tick(): Promise<void> {
  const agents = await listAgents();
  const now = Date.now();
  for (const def of agents) {
    if (!def.enabled) continue;
    // F1.2: lifecycle ∈ {ideation, forge, test, retired} never trigger-fires;
    // absent lifecycle = "deployed" so nothing pre-existing stops firing.
    if (!lifecycleAllowsTriggers(def)) continue;
    const pollers = def.triggers.filter((t) => t.type !== "manual" && t.type !== "webhook");
    if (!pollers.length) continue;
    const cursors = await readCursors(def.id);
    let dirty = false;
    for (const t of pollers) {
      const key = trigKey(t);
      try {
        const { fire, cursor } = await evalTrigger(def, t, cursors[key] ?? {}, now);
        if (fire) {
          const res = await startRun(def, t.type, fire);
          if ("error" in res) {
            // Busy or at capacity — don't advance change-cursors, so the same
            // event fires again next tick instead of being silently dropped.
            continue;
          }
        }
        cursors[key] = cursor;
        dirty = true;
      } catch { /* one bad trigger never kills the loop */ }
    }
    if (dirty) await writeCursors(def.id, cursors);
  }
}

/** Idempotent — instrumentation.ts calls this once per server start. */
export function ensureScheduler(): void {
  const g = globalThis as unknown as { __agentsScheduler?: ReturnType<typeof setInterval> };
  if (g.__agentsScheduler) return;
  g.__agentsScheduler = setInterval(() => { void tick().catch(() => {}); }, TICK_MS);
  // First tick shortly after boot so schedules/watches don't wait a full minute.
  setTimeout(() => { void tick().catch(() => {}); }, 5_000);
}
