// Hire Engine data layer — reads hire-candidates.json (written by Upwork-Leads/hire.mjs)
// and merges it with the local review state.
//
// Deliberately a SEPARATE corpus from the Deal Desk. That one works freelance/contract
// gigs; this one works part-time/full-time employment listings, because the pitch is
// different — you are displacing a salary line, not winning a project.
//
// Same shape as upworkDesk.ts on purpose: this whole engine is a repurposing of the
// Deal Desk pipeline pointed at hiring posts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { machineFor, type MachineKey } from "./hireMachines";

export const LEADS_DIR =
  process.env.UPWORK_LEADS_DIR || path.join(os.homedir(), "Documents", "Upwork-Leads");
const CANDIDATES_FILE = path.join(LEADS_DIR, "hire-candidates.json");
const STATE_FILE = path.join(LEADS_DIR, "hire-state.json");

export const HIRE_STATUSES = ["new", "researching", "approved", "sent", "parked", "dismissed"] as const;
export type HireStatus = (typeof HIRE_STATUSES)[number];

/** One row as hire.mjs writes it. */
export interface HireRecord {
  id: string; source: string; title: string; company: string | null; url: string;
  employment: string | null; salary: string | null; salaryNum: number | null;
  location: string | null; posted: string | null; desc: string | null;
  machineKey: MachineKey; machine: string;
  coverage: number; budget: number; commitment: number; composite: number;
}

export interface HireState {
  status?: HireStatus;
  notes?: string;
  /** Generated outreach — the "augment the hire" pitch for this specific posting. */
  pitch?: string;
  /** Why this role is (or is not) a fit for the machine. */
  read?: string;
  updatedAt?: number;
}

export interface HireLead extends HireRecord {
  status: HireStatus;
  notes: string;
  pitch: string | null;
  read: string | null;
  updatedAt: number | null;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

type StateStore = Record<string, HireState>;

async function readState(): Promise<StateStore> {
  return readJson<StateStore>(STATE_FILE, {});
}

async function patch(id: string, fn: (s: HireState) => HireState): Promise<HireState> {
  const store = await readState();
  const next = fn(store[id] || {});
  next.updatedAt = Date.now();
  store[id] = next;
  await mkdir(path.dirname(STATE_FILE), { recursive: true }).catch(() => {});
  await writeFile(STATE_FILE, JSON.stringify(store, null, 1));
  return next;
}

export async function listHireLeads(): Promise<HireLead[]> {
  const [records, state] = await Promise.all([
    readJson<HireRecord[]>(CANDIDATES_FILE, []),
    readState(),
  ]);
  const out: HireLead[] = [];
  for (const r of records) {
    const st = state[r.id] || {};
    if (st.status === "dismissed") continue;
    out.push({
      ...r,
      status: st.status || "new",
      notes: st.notes ?? "",
      pitch: st.pitch ?? null,
      read: st.read ?? null,
      updatedAt: st.updatedAt ?? null,
    });
  }
  out.sort((a, b) => b.composite - a.composite);
  return out;
}

export async function getHireLead(id: string): Promise<HireLead | null> {
  return (await listHireLeads()).find((d) => d.id === id) || null;
}

export async function setHireStatus(id: string, status: HireStatus): Promise<HireState> {
  return patch(id, (s) => ({ ...s, status }));
}

export async function setHireNotes(id: string, notes: string): Promise<HireState> {
  return patch(id, (s) => ({ ...s, notes }));
}

export async function setHirePitch(id: string, pitch: string, read?: string): Promise<HireState> {
  return patch(id, (s) => ({ ...s, pitch, ...(read ? { read } : {}) }));
}

/** Counts per machine, for the portfolio strip. */
export async function machineCounts(): Promise<Record<string, { total: number; new: number }>> {
  const leads = await listHireLeads();
  const out: Record<string, { total: number; new: number }> = {};
  for (const l of leads) {
    const k = machineFor(l.machineKey).key;
    (out[k] ??= { total: 0, new: 0 }).total++;
    if (l.status === "new") out[k].new++;
  }
  return out;
}
