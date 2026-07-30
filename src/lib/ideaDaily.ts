// Idea Engine — Phase 3: the Daily Idea. A light loop (booted from
// instrumentation.ts beside the Agents scheduler) that, at the configured local
// hour, runs one radar scan and auto-validates the single best new candidate
// into the Idea of the Day. HARD CAP: one auto-validation per calendar day —
// the stamp file is written BEFORE the run starts, so even a crash can't cause
// a double-spend. Everything else stays on-demand.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSettings } from "./settings";
import { IDEA_DIR } from "./ideaEngine";
import { readCandidates, scanStatus, startScan, patchCandidate } from "./ideaRadar";
import { anyRunning, liveRun, startValidation } from "./ideaValidation";

const DAILY_FILE = path.join(IDEA_DIR, "daily.json");

export interface DailyState {
  lastRunDate: string | null;   // YYYY-MM-DD local
  dossierId: string | null;
  candidateTopic: string | null;
  note: string | null;
}

export async function readDaily(): Promise<DailyState> {
  try { return JSON.parse(await readFile(DAILY_FILE, "utf8")) as DailyState; }
  catch { return { lastRunDate: null, dossierId: null, candidateTopic: null, note: null }; }
}

async function writeDaily(s: DailyState): Promise<void> {
  await writeFile(DAILY_FILE, JSON.stringify(s, null, 1), "utf8").catch(() => {});
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function tick(): Promise<void> {
  const cfg = readSettings().ideaEngine;
  // Settings arrive stringly from the gear UI — coerce defensively.
  const enabled = String(cfg.dailyEnabled) === "true" || cfg.dailyEnabled === true;
  const hour = Number(cfg.dailyHour ?? 7);
  if (!enabled || !Number.isFinite(hour)) return;
  if (new Date().getHours() !== hour) return;

  const daily = await readDaily();
  if (daily.lastRunDate === todayLocal()) return;      // the hard cap
  if (anyRunning() || scanStatus().running) return;    // never stack on manual work

  // Stamp FIRST — a crash after this point costs the day's slot, never a double-run.
  await writeDaily({ lastRunDate: todayLocal(), dossierId: null, candidateTopic: null, note: "scan started" });

  await startScan();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    if (!scanStatus().running) break;
  }

  const candidates = await readCandidates();
  const pick = candidates
    .filter((c) => c.status === "new")
    .sort((a, b) => ((b.scores.momentum.value ?? 0) + (b.scores.pain.value ?? 0)) - ((a.scores.momentum.value ?? 0) + (a.scores.pain.value ?? 0)))[0];
  if (!pick) {
    await writeDaily({ lastRunDate: todayLocal(), dossierId: null, candidateTopic: null, note: "scan found no new candidates" });
    return;
  }

  const res = await startValidation(`${pick.topic} — ${pick.thesis}`, pick.id);
  if ("error" in res) {
    await writeDaily({ lastRunDate: todayLocal(), dossierId: null, candidateTopic: pick.topic, note: `validation not started: ${res.error}` });
    return;
  }
  await patchCandidate(pick.id, { status: "validating" });
  await writeDaily({ lastRunDate: todayLocal(), dossierId: null, candidateTopic: pick.topic, note: "validating" });

  // Wait for the council (bounded), then stamp the dossier as Idea of the Day.
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const run = liveRun(res.runId);
    if (!run || run.status !== "running") {
      const done = run?.status === "done" && run.dossierId;
      await writeDaily({
        lastRunDate: todayLocal(),
        dossierId: done ? run!.dossierId! : null,
        candidateTopic: pick.topic,
        note: done ? "idea of the day ready" : `validation ${run?.status ?? "lost"}: ${run?.error ?? ""}`,
      });
      if (done) await patchCandidate(pick.id, { status: "validated", dossierId: run!.dossierId });
      return;
    }
  }
}

/** Idempotent — instrumentation.ts calls this once per server start. */
export function ensureIdeaDaily(): void {
  const g = globalThis as unknown as { __ideaDaily?: ReturnType<typeof setInterval> };
  if (g.__ideaDaily) return;
  // 10-minute cadence is plenty for an hour-granular schedule.
  g.__ideaDaily = setInterval(() => { void tick().catch(() => {}); }, 10 * 60_000);
  setTimeout(() => { void tick().catch(() => {}); }, 30_000);
}
