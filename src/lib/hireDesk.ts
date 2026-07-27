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

/**
 * Firmographics, fetched on demand when you enrich an approved lead.
 *
 * This is the signal the scrape CANNOT provide: the job boards give a company NAME and
 * nothing else, so a 12-person shop and a public enterprise posting the same $40k
 * support role score identically. Size is what separates them, and it decides whether
 * the pitch is even coherent — a $1,500-2,500 machine augmenting one hire lands with an
 * SMB and is mis-sized for a company with procurement and an existing support stack.
 */
export interface Firmo {
  domain?: string;
  /** Hunter's headcount band, e.g. "11-50", "251-1K". */
  employees?: string;
  /** "public" is a strong disqualifier for this offer. */
  type?: string;
  foundedYear?: number;
  /** A contact address, if domain-search happened to surface one. */
  email?: string;
  /** Our verdict, derived from the above — see sizeFit(). */
  fit?: "ideal" | "workable" | "poor";
  fitWhy?: string;
  at?: number;
  error?: string;
}

export interface HireState {
  status?: HireStatus;
  notes?: string;
  /** Generated outreach — the "augment the hire" pitch for this specific posting. */
  pitch?: string;
  /** Why this role is (or is not) a fit for the machine. */
  read?: string;
  firmo?: Firmo;
  updatedAt?: number;
}

/**
 * Turn a headcount band into a buy verdict for THIS offer.
 * Bands come from Hunter as strings like "1-10", "51-200", "1K-5K".
 */
export function sizeFit(f: { employees?: string; type?: string }): { fit: "ideal" | "workable" | "poor"; fitWhy: string } {
  if (f.type === "public") {
    return { fit: "poor", fitWhy: "Public company — procurement cycles and an existing tooling stack make a $1.5-2.5k augmentation a mis-sized pitch." };
  }
  const band = (f.employees || "").toLowerCase();
  if (!band) return { fit: "workable", fitWhy: "No headcount available — treat as unknown rather than good." };
  // Anything expressed in thousands is out of range for this offer.
  if (/\bk\b|\dk/.test(band) || /^\s*(1001|5001|10001)/.test(band)) {
    return { fit: "poor", fitWhy: `Roughly ${f.employees} staff — too large; they buy platforms, not a one-hire augmentation.` };
  }
  const first = parseInt(band, 10);
  if (Number.isNaN(first)) return { fit: "workable", fitWhy: `Headcount "${f.employees}" not parseable.` };
  if (first >= 501) return { fit: "poor", fitWhy: `Roughly ${f.employees} staff — too large for this offer.` };
  if (first >= 201) return { fit: "workable", fitWhy: `Roughly ${f.employees} staff — upper edge; likely has some tooling already.` };
  if (first >= 11) return { fit: "ideal", fitWhy: `Roughly ${f.employees} staff — the sweet spot: big enough to hire, small enough that one hire hurts.` };
  return { fit: "workable", fitWhy: `Roughly ${f.employees} staff — may not have the budget or the ticket volume yet.` };
}

export interface HireLead extends HireRecord {
  status: HireStatus;
  notes: string;
  pitch: string | null;
  read: string | null;
  firmo: Firmo | null;
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
      firmo: st.firmo ?? null,
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

export async function setHireFirmo(id: string, firmo: Firmo): Promise<HireState> {
  return patch(id, (s) => ({ ...s, firmo: { ...firmo, at: Date.now() } }));
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
