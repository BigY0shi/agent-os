// Deal Desk — backend for the Upwork proposals Kanban module.
//
// Reads the owned-scraper output (board.json + pitches.json produced by the
// pipeline in C:\Users\Yoshi\Documents\Upwork-Leads) and merges it with a
// per-deal state store so the dashboard can show listing + pitch + approach +
// crash course, and the operator can move / annotate / approve each card.
//
// State (status, notes, need-info flag, edited pitch, Q&A answers, enrichment)
// lives in ~/.agentic-os/upwork-desk.json, keyed by the stable job UID — so it
// survives re-scrapes and persists across runs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Where the scraper pipeline writes its artifacts. Override with UPWORK_LEADS_DIR.
export const LEADS_DIR =
  process.env.UPWORK_LEADS_DIR || path.join(os.homedir(), "Documents", "Upwork-Leads");
const BOARD_FILE = path.join(LEADS_DIR, "board.json");
const PITCHES_FILE = path.join(LEADS_DIR, "pitches.json");
const FEEDS_FILE = path.join(LEADS_DIR, "feeds.json");

const AOS = path.join(os.homedir(), ".agentic-os");
const STATE_FILE = path.join(AOS, "upwork-desk.json");

// ── Columns (pipeline stages, left → right) ────────────────────────────────────
export type DealStatus = "new" | "reviewing" | "approved" | "ready" | "sent" | "parked" | "denied" | "dismissed";

export const DESK_COLUMNS: { key: DealStatus; label: string; accent: string }[] = [
  { key: "new", label: "New", accent: "#a855f7" },
  { key: "reviewing", label: "Reviewing", accent: "#22d3ee" },
  { key: "approved", label: "Approved", accent: "#fbbf24" },
  { key: "ready", label: "Ready to Send", accent: "#86efac" },
  { key: "sent", label: "Sent", accent: "#34d399" },
];
export const VALID_STATUS: DealStatus[] = ["new", "reviewing", "approved", "ready", "sent", "parked", "denied", "dismissed"];

// ── Types ──────────────────────────────────────────────────────────────────────
interface BoardRecord {
  id: string; subId?: string; title: string; url: string;
  budget: string | null; jobType: string | null; experienceLevel: string | null;
  duration: string | null; posted: string | null; description: string | null;
  tags: string[]; clientCountry: string | null; clientTotalSpent: number | null;
  clientRating: number | null; clientHires: number | null; clientMemberSince: string | null;
  easiness: number; winnability: number; fit: number; composite: number; _query?: string;
}
interface Pitch {
  url?: string; fitRefined?: number; summary?: string; why?: string; pitch?: string;
  approach?: string; crashCourse?: string;
}
export interface Answer { q: string; a: string; ts: number }
export interface DealState {
  status?: DealStatus; notes?: string; needsInfo?: boolean; editedPitch?: string;
  answers?: Answer[]; enrichment?: Enrichment; updatedAt?: number;
}
export interface Enrichment { proposals?: string | number | null; paymentVerified?: boolean | null; hireRate?: number | null; at?: number }
type StateStore = Record<string, DealState>;

export interface Deal extends BoardRecord {
  status: DealStatus;
  source?: string;
  automatable?: boolean;
  summary: string | null;
  why: string | null; pitch: string | null; approach: string | null; crashCourse: string | null;
  notes: string; needsInfo: boolean; editedPitch: string | null;
  answers: Answer[]; enrichment: Enrichment | null; updatedAt: number | null;
  effectiveFit: number;
}

// Labor/staffing titles are never a systems-build fit — mirror the board renderer's backstop.
const STAFFING =
  /\b(sdr|appointment setter|inside sales|account executive|business development (lead|rep|representative|manager)|sales (rep|representative)|cold caller|telemarket|virtual assistant|technical (operations )?manager|project manager|client coordinator)\b/i;

// ── Description reformatter ──────────────────────────────────────────────────────
// The scraper flattens descriptions into one line (no newlines). This reconstructs
// readable structure — bullets + section-header breaks — WITHOUT adding, removing, or
// rewriting any words (only whitespace + bullet-char normalization). Mirrors
// Upwork-Leads/format_desc.mjs (kept in sync; verified content-lossless over the corpus).
const SECTION_HEADERS = [
  "Job Description", "Project Description", "Project Overview", "Overview",
  "Project Scope", "Scope of Work", "Scope of the Project", "Scope of the Work", "The Scope",
  "Key Responsibilities", "Responsibilities include", "Responsibilities",
  "Key Requirements", "Requirements", "Qualifications", "Required Skills", "Skills Required", "Required Experience",
  "Our Expectations", "Expectations", "What We're Looking For", "What We Are Looking For", "What we're looking for",
  "What You'll Do", "What You Will Do", "What we need", "What We Need", "What's Needed", "Whats Needed",
  "Deliverables", "About Us", "About the Role", "About You", "About the Company", "About the Project", "About the Job",
  "Must Have", "Must-Haves", "Must Haves", "Nice to Have", "Nice-to-Haves", "Bonus Points", "Bonus Skills",
  "Tech Stack", "Technical Requirements", "Current Tech Stack", "Tools",
  "Timeline", "Budget", "Compensation", "Rate", "Hours",
  "To Apply", "How to Apply", "When Applying",
  "Ideal Candidate", "The Ideal Candidate", "Who You Are", "Who We Are",
  "Already Done", "Already Completed", "What's Included", "What's Done",
  "What We Need From You", "Current Situation", "Project Type", "Engagement Details",
  "Required Qualifications", "Preferred Qualifications", "Preferred Experience",
  "Ideal Candidate Profile", "Success Measures", "Position Details", "Key Deliverables",
  "The Role", "The Opportunity", "Success in This Role", "What You Bring", "What We Offer",
  "Your Role", "Scope of Project", "Key Tasks", "Main Responsibilities",
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function formatDescription(raw: string | null): string | null {
  if (!raw || typeof raw !== "string") return raw ?? null;
  let s = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  // 0) Markdown header markers (## / ###, bounded so "C#"/"F#" survive) → break.
  s = s.replace(/(^|[\s.!?:)])#{2,6}[ \t]+/g, "$1\n\n");
  // 1) Section headers → break before, on their own line. SINGLE pass, longest-first
  //    (so "Project Overview" matches before "Overview"). The header MUST sit at a
  //    clause boundary (preceded by sentence-end punctuation or a bullet) so compound
  //    phrases ("Core Responsibilities", "Software Requirements") are never torn apart.
  //    Conservative: a missed header beats a mangled sentence.
  const headerAlt = [...SECTION_HEADERS].sort((a, b) => b.length - a.length)
    .map((h) => escapeRe(h).replace(/['’]/g, "['’ ]?")).join("|"); // tolerate stripped apostrophes ("You ll")
  const headerRe = new RegExp(`([.!?:)\\]\\u2022])[ \\t]+(${headerAlt})(:?)[ \\t]*(?=[A-Z0-9*\\u2022▪◦])`, "g");
  s = s.replace(headerRe, (_m, pre, header, colon) => `${pre}\n\n${header}${colon}\n`);
  // 2) Generic "Sentence. Short Label:" headers — only after a real sentence end
  //    (lowercase + .!?); excludes "1." and "U.S." → no orphaned numbers / split abbrevs.
  s = s.replace(/([a-z][.!?])[ \t]+([A-Z][a-z]+(?:[ \t][A-Za-z'&/]+){0,3}):[ \t]+(?=[A-Z])/g,
    (_m, end, label) => `${end}\n\n${label}: `);
  // 3) Inline bullets → one per line (unicode, asterisk, and dash-lists when ≥2 appear).
  s = s.replace(/[ \t]*[•▪◦‣⁃][ \t]*/g, "\n• ");
  // Asterisk bullets — only when ≥2 markers (a real list), so a lone *emphasis* span isn't bulleted.
  if ((s.match(/(^|[\s])\*[ \t]*(?=[A-Za-z0-9])/g) || []).length >= 2)
    s = s.replace(/(^|[\s])\*[ \t]*(?=[A-Za-z0-9])/g, "\n• ");
  // Hyphen-minus dash lists — only when ≥3 markers (a real list, not prose dashes).
  if ((s.match(/[ \t]-[ \t]+(?=[A-Z0-9])/g) || []).length >= 3)
    s = s.replace(/[ \t]-[ \t]+(?=[A-Z0-9])/g, "\n• ");
  // 4) Tidy whitespace without touching content.
  s = s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// ── IO helpers ───────────────────────────────────────────────────────────────────
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}
async function readState(): Promise<StateStore> { return readJson<StateStore>(STATE_FILE, {}); }
async function writeState(s: StateStore): Promise<void> {
  if (!existsSync(AOS)) await mkdir(AOS, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

// ── Merge board + pitches + state → Deal[] ──────────────────────────────────────
export async function listDeals(): Promise<Deal[]> {
  const [board, pitches, state] = await Promise.all([
    readJson<BoardRecord[]>(BOARD_FILE, []),
    readJson<Pitch[]>(PITCHES_FILE, []),
    readState(),
  ]);
  const pitchByUrl = new Map(pitches.filter((p) => p.url).map((p) => [p.url as string, p]));

  // Only surface the pitched shortlist — those are the reviewable deals.
  const deals: Deal[] = [];
  for (const b of board) {
    const p = pitchByUrl.get(b.url);
    if (!p) continue;
    const st = state[b.id] || {};
    if (st.status === "dismissed") continue; // removed from the desk
    let effectiveFit = p.fitRefined ?? b.fit;
    if (STAFFING.test(b.title || "")) effectiveFit = Math.min(effectiveFit, 2);
    const composite = +(0.4 * b.easiness + 0.4 * b.winnability + 0.2 * effectiveFit).toFixed(2);
    const defaultStatus: DealStatus = effectiveFit <= 3 ? "parked" : "new";
    deals.push({
      ...b,
      description: formatDescription(b.description),
      composite,
      effectiveFit,
      status: st.status || defaultStatus,
      summary: p.summary ?? null,
      why: p.why ?? null,
      pitch: st.editedPitch ?? p.pitch ?? null,
      approach: p.approach ?? null,
      crashCourse: p.crashCourse ?? null,
      notes: st.notes ?? "",
      needsInfo: st.needsInfo ?? false,
      editedPitch: st.editedPitch ?? null,
      answers: st.answers ?? [],
      enrichment: st.enrichment ?? null,
      updatedAt: st.updatedAt ?? null,
    });
  }

  // Remote freelance feeds (RemoteOK / WWR / Reddit) — source-tagged; no pre-pitch, proposal
  // is drafted on demand. Appear alongside Upwork leads, keyed by id in the same state store.
  const feeds = await readJson<(BoardRecord & { source: string })[]>(FEEDS_FILE, []);
  for (const f of feeds) {
    const st = state[f.id] || {};
    if (st.status === "dismissed") continue;
    const effectiveFit = f.fit;
    const composite = f.composite ?? +(0.4 * f.easiness + 0.4 * f.winnability + 0.2 * effectiveFit).toFixed(2);
    deals.push({
      ...f,
      description: formatDescription(f.description),
      composite, effectiveFit,
      status: st.status || (effectiveFit <= 3 ? "parked" : "new"),
      summary: null, why: null, pitch: st.editedPitch ?? null, approach: null, crashCourse: null,
      notes: st.notes ?? "", needsInfo: st.needsInfo ?? false, editedPitch: st.editedPitch ?? null,
      answers: st.answers ?? [], enrichment: st.enrichment ?? null, updatedAt: st.updatedAt ?? null,
    });
  }

  deals.sort((a, b) => b.composite - a.composite);
  return deals;
}

export async function getDeal(id: string): Promise<Deal | null> {
  return (await listDeals()).find((d) => d.id === id) || null;
}

// ── Mutations (all merge into the state store) ──────────────────────────────────
async function patch(id: string, fn: (s: DealState) => DealState): Promise<DealState> {
  const store = await readState();
  const next = fn(store[id] || {});
  next.updatedAt = Date.now();
  store[id] = next;
  await writeState(store);
  return next;
}

export async function setStatus(id: string, status: DealStatus): Promise<DealState> {
  if (!VALID_STATUS.includes(status)) throw new Error(`Invalid status: ${status}`);
  return patch(id, (s) => ({ ...s, status }));
}
export async function setNotes(id: string, notes: string): Promise<DealState> {
  return patch(id, (s) => ({ ...s, notes: String(notes).slice(0, 5000) }));
}
export async function setNeedsInfo(id: string, needsInfo: boolean): Promise<DealState> {
  return patch(id, (s) => ({ ...s, needsInfo: !!needsInfo }));
}
export async function setEditedPitch(id: string, editedPitch: string): Promise<DealState> {
  return patch(id, (s) => ({ ...s, editedPitch: String(editedPitch).slice(0, 8000) }));
}
export async function addAnswer(id: string, q: string, a: string): Promise<DealState> {
  return patch(id, (s) => ({ ...s, answers: [...(s.answers || []), { q, a, ts: Date.now() }].slice(-20) }));
}
export async function setEnrichment(id: string, e: Enrichment): Promise<DealState> {
  return patch(id, (s) => ({ ...s, enrichment: { ...e, at: Date.now() } }));
}

// Plan a "clear passed & refill" pass. Goal: keep the NEW column topped up to `target`.
//  • toDismiss = leads that resolve to parked/denied (rejected or low-fit "passed" leads).
//    The live New queue and your kept stages (approved/reviewing/ready/sent) are untouched.
//  • need = target − (how many are currently in New); pitch that many next-best leads so
//    the New column reaches `target`, independent of how many were dismissed. The route
//    forces the freshly-pitched leads into "new" so even fit≤3 picks land in the queue.
export async function refillPlan(target = 20): Promise<{ toDismiss: string[]; toPitch: string[]; newCount: number; target: number }> {
  const [board, pitches, store] = await Promise.all([
    readJson<BoardRecord[]>(BOARD_FILE, []),
    readJson<Pitch[]>(PITCHES_FILE, []),
    readState(),
  ]);
  const pitchByUrl = new Map(pitches.filter((p) => p.url).map((p) => [p.url as string, p]));

  const toDismiss: string[] = [];
  let newCount = 0;
  for (const b of board) {
    const p = pitchByUrl.get(b.url);
    if (!p) continue;
    const st = store[b.id] || {};
    if (st.status === "dismissed") continue;
    let fit = p.fitRefined ?? b.fit;
    if (STAFFING.test(b.title || "")) fit = Math.min(fit, 2);
    const status = st.status || (fit <= 3 ? "parked" : "new");
    if (status === "parked" || status === "denied") toDismiss.push(b.id); // rejected / passed
    else if (status === "new") newCount += 1;                              // the live review queue
    // approved / reviewing / ready / sent are kept and don't count toward the New target
  }

  const need = Math.max(0, target - newCount);
  const pitchedUrls = new Set(pitches.map((p) => p.url));
  const dismissedIds = new Set([
    ...toDismiss,
    ...Object.entries(store).filter(([, s]) => s.status === "dismissed").map(([id]) => id),
  ]);
  const toPitch = [...board]
    .filter((b) => !STAFFING.test(b.title || ""))      // skip obvious staffing non-fits
    .sort((a, b) => b.composite - a.composite)
    .filter((b) => !pitchedUrls.has(b.url) && !dismissedIds.has(b.id))
    .slice(0, need)
    .map((b) => b.id);

  return { toDismiss, toPitch, newCount, target };
}
