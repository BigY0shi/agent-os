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
    try {
      const from = new Date(cur.lastFire ?? Date.now() - TICK_MS);
      const next = new Cron(t.cron).nextRun(from);
      if (next && next.getTime() <= now) {
        return { fire: `Scheduled run (${t.cron}). Carry out your standing instructions.`, cursor: { ...cur, lastFire: now } };
      }
    } catch { /* bad cron expr — ignore rather than crash the loop */ }
    return { cursor: cur };
  }

  return { cursor: cur };
}

async function tick(): Promise<void> {
  const agents = await listAgents();
  const now = Date.now();
  for (const def of agents) {
    if (!def.enabled) continue;
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
