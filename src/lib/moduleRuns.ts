// Module runs — the registry that keeps a long-running module action alive and
// visible after the page that started it is gone.
//
// The problem (tasklist item 5 / roadmap S2): 36 API routes are "await a model
// for up to ten minutes, then respond". The browser drops the fetch the moment
// the owner navigates; the server keeps working and often writes the result,
// but nothing anywhere says a run ever existed. The V2 agents module has its
// own registry (agentsRuntime RUNS + status feed); V1 modules had none.
//
// This is that registry for everything else. A route wraps its work in
// startModuleRun(); the run is recorded immediately, survives the request,
// streams its events to whoever subscribes (the RunsTray in the layout, the
// /api/runs routes), and finishes on its own. The route may still await the
// same promise and answer the original caller as before.
//
// Honesty rules: a run that was "running" when the server died is marked
// "lost" on the next boot, never left spinning; no run is ever invented.
//
// Storage: ~/.agentic-os/module-runs.json (AGENTIC_OS_RUNS_DIR for smokes),
// last MAX_FINISHED finished runs kept, events capped per run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ModuleRunStatus = "running" | "done" | "error" | "lost";

export interface ModuleRunEvent { at: number; text: string }

export interface ModuleRun {
  id: string;
  /** Module slug, e.g. "content-engine", "deals", "marketing". */
  module: string;
  /** Human label: "Generate materials: <topic>". */
  label: string;
  /** Where the owner can go to see the outcome. */
  href?: string;
  status: ModuleRunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** Small, JSON-safe summary of the outcome (never the full payload). */
  result?: unknown;
  progress?: { n: number; total: number };
  events: ModuleRunEvent[];
  dismissedAt?: number;
}

export interface ModuleRunContext {
  id: string;
  log: (text: string) => void;
  progress: (n: number, total: number) => void;
}

const MAX_EVENTS = 40;
const MAX_FINISHED = 50;
const PERSIST_DEBOUNCE_MS = 250;

type Listener = (run: ModuleRun) => void;

interface Registry {
  runs: Map<string, ModuleRun>;
  listeners: Set<Listener>;
  loaded: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

// One registry per process, like agentsRuntime's RUNS map: Next can evaluate
// this module more than once, and the tray must see the route's runs.
const g = globalThis as unknown as { __moduleRuns?: Registry };
const REG: Registry = (g.__moduleRuns ??= { runs: new Map(), listeners: new Set(), loaded: false, persistTimer: null });

export function runsDir(): string {
  const o = process.env.AGENTIC_OS_RUNS_DIR?.trim();
  return o || path.join(os.homedir(), ".agentic-os");
}
export function runsFile(): string {
  return path.join(runsDir(), "module-runs.json");
}

function load(): void {
  if (REG.loaded) return;
  REG.loaded = true;
  let rows: ModuleRun[] = [];
  try {
    const raw = fs.readFileSync(runsFile(), "utf8");
    const parsed = JSON.parse(raw) as { runs?: ModuleRun[] };
    if (Array.isArray(parsed.runs)) rows = parsed.runs;
  } catch {
    return; // first boot, or unreadable: start empty, never invent
  }
  const now = Date.now();
  for (const r of rows) {
    if (!r || typeof r.id !== "string") continue;
    if (r.status === "running") {
      // The process that owned this run is gone. Say so.
      r.status = "lost";
      r.endedAt = now;
      r.error = "server restarted while this run was in flight";
    }
    REG.runs.set(r.id, r);
  }
}

function persistSoon(): void {
  if (REG.persistTimer) return;
  REG.persistTimer = setTimeout(() => {
    REG.persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
  // Never keep a process alive just to flush a status file.
  (REG.persistTimer as { unref?: () => void }).unref?.();
}

export function persistNow(): void {
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    const all = [...REG.runs.values()];
    const running = all.filter((r) => r.status === "running");
    const finished = all.filter((r) => r.status !== "running").sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_FINISHED);
    // Trim the in-memory map to the same window so it cannot grow forever.
    const keep = new Set([...running, ...finished].map((r) => r.id));
    for (const id of [...REG.runs.keys()]) if (!keep.has(id)) REG.runs.delete(id);
    const tmp = runsFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ runs: [...running, ...finished] }, null, 2), "utf8");
    fs.renameSync(tmp, runsFile());
  } catch {
    /* the registry is a convenience; a failed flush must never break a run */
  }
}

function emit(run: ModuleRun): void {
  for (const cb of REG.listeners) {
    try { cb(run); } catch { /* a bad listener never stops the run */ }
  }
  persistSoon();
}

function summarizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 400 ? msg.slice(0, 400) + "…" : msg;
}

/**
 * Register and start a run. Returns the id at once and the promise of the
 * work, so a route can `await run.promise` and still answer the original
 * caller. The run outlives the request either way.
 */
export function startModuleRun<T>(
  spec: { module: string; label: string; href?: string },
  work: (ctx: ModuleRunContext) => Promise<T>,
  opts: { summarize?: (result: T) => unknown } = {},
): { id: string; promise: Promise<T> } {
  load();
  const id = randomUUID();
  const run: ModuleRun = {
    id,
    module: spec.module,
    label: spec.label.slice(0, 160),
    href: spec.href,
    status: "running",
    startedAt: Date.now(),
    events: [],
  };
  REG.runs.set(id, run);
  emit(run);

  const ctx: ModuleRunContext = {
    id,
    log: (text) => {
      const t = String(text ?? "").trim();
      if (!t) return;
      run.events.push({ at: Date.now(), text: t.slice(0, 300) });
      if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
      emit(run);
    },
    progress: (n, total) => {
      run.progress = { n, total };
      emit(run);
    },
  };

  const promise = (async () => {
    try {
      const result = await work(ctx);
      run.status = "done";
      run.endedAt = Date.now();
      if (opts.summarize) {
        try { run.result = opts.summarize(result); } catch { /* summary is optional */ }
      }
      emit(run);
      return result;
    } catch (e) {
      run.status = "error";
      run.endedAt = Date.now();
      run.error = summarizeError(e);
      emit(run);
      throw e;
    }
  })();
  // A caller that does not await must not turn a failed run into an
  // unhandled rejection; the run record already carries the error.
  promise.catch(() => {});
  return { id, promise };
}

export function getModuleRun(id: string): ModuleRun | null {
  load();
  return REG.runs.get(id) ?? null;
}

/** Running first (oldest running at the top), then finished newest-first. */
export function listModuleRuns(opts: { includeDismissed?: boolean; limit?: number } = {}): ModuleRun[] {
  load();
  const all = [...REG.runs.values()].filter((r) => opts.includeDismissed || !r.dismissedAt);
  const running = all.filter((r) => r.status === "running").sort((a, b) => a.startedAt - b.startedAt);
  // Tiebreak on startedAt: two runs can finish in the same millisecond, and
  // Map insertion order would then put the OLDER one first.
  const finished = all.filter((r) => r.status !== "running").sort((a, b) => ((b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)) || (b.startedAt - a.startedAt));
  const rows = [...running, ...finished];
  return typeof opts.limit === "number" ? rows.slice(0, opts.limit) : rows;
}

export function dismissModuleRun(id: string): boolean {
  load();
  const run = REG.runs.get(id);
  if (!run || run.status === "running") return false; // a live run is not dismissable; STOP is a different verb
  run.dismissedAt = Date.now();
  emit(run);
  return true;
}

export function subscribeModuleRuns(cb: Listener): () => void {
  load();
  REG.listeners.add(cb);
  return () => { REG.listeners.delete(cb); };
}

export function runningModuleCount(): number {
  load();
  let n = 0;
  for (const r of REG.runs.values()) if (r.status === "running") n++;
  return n;
}

/** Test-only: forget everything in memory so a smoke can exercise load(). */
export function __resetModuleRunsForTests(): void {
  REG.runs.clear();
  REG.listeners.clear();
  REG.loaded = false;
  if (REG.persistTimer) { clearTimeout(REG.persistTimer); REG.persistTimer = null; }
}
