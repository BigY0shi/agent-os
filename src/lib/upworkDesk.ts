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

import { readFile, writeFile, mkdir, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { deriveVerdict, partitionByAge, type Verdict, type ScreenResult, type Dossier } from "./dealDeskControl";

// Where the scraper pipeline writes its artifacts. Override with UPWORK_LEADS_DIR.
export const LEADS_DIR =
  process.env.UPWORK_LEADS_DIR || path.join(os.homedir(), "Documents", "Upwork-Leads");
const BOARD_FILE = path.join(LEADS_DIR, "board.json");
const PITCHES_FILE = path.join(LEADS_DIR, "pitches.json");
const FEEDS_FILE = path.join(LEADS_DIR, "feeds.json");

// Per-deal state. Override with AGENTIC_OS_DESK - a smoke MUST redirect this to a
// temp dir before importing this module (project rule 19), or it reads and then
// rewrites the operator's live board.
const STATE_FILE =
  process.env.AGENTIC_OS_DESK || path.join(os.homedir(), ".agentic-os", "upwork-desk.json");
const AOS = path.dirname(STATE_FILE);
// The retired generation, and the prefix for a not-yet-promoted one. The rotation
// itself is documented at writeState.
const PREV_FILE = path.join(AOS, `${path.parse(STATE_FILE).name}_prev.json`);
const GEN_PREFIX = `${path.parse(STATE_FILE).name}_gen_`;

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
  // `posted` is whatever the source emitted and is NOT comparable across sources:
  // Upwork writes a relative string ("Posted 2 hours ago") that was true only at
  // scrape time, RemoteOK writes ISO 8601, WWR writes RFC 2822. The two fields below
  // exist on Upwork records and let us recover an absolute instant; see resolvePostedAt.
  datePosted?: string | null; _scrapedAt?: string | null;
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
  /**
   * On-demand equivalent of a pitches.json entry. Upwork leads get summary/why/
   * approach/crashCourse from the offline pitch pass; RemoteOK and WWR leads never
   * went through it, so those fields were pinned to null forever and feed cards
   * looked second-class. Generating a brief fills them for ANY source.
   */
  brief?: Brief;
  /**
   * The quick pass/not check. Cheaper than a brief and run over EVERY lead, so a
   * card that no brief reached still leads with a real call instead of a band
   * invented from the feed's keyword fit.
   */
  screen?: ScreenResult;
  /**
   * The settled account of this listing: the client's asks and our answers,
   * reconciled once so the proposal writer is not re-deriving them mid-draft.
   */
  dossier?: Dossier;
  /**
   * S4 (d): enrichment (or intake) hit Upwork's login wall on this card. Set by
   * the gated runner, cleared by a fresh cookie or a later successful visit.
   */
  needsLogin?: boolean;
  loginWallAt?: number;
  /** S4 (e): the research pass "More info needed" fires, and how it went. */
  research?: Research;
  /**
   * The lead record itself, copied here the first time the owner touches this card.
   *
   * The desk used to hold only a POINTER into board.json / feeds.json, and those are
   * pipeline output: score_board.mjs ends with a wholesale
   * `writeFileSync(board.json, scored)`, so every scrape replaces the file outright.
   * A lead the new run did not re-find lost its record, and the state row here - the
   * owner's approval, his notes, a finished proposal - was left pointing at nothing
   * and vanished off the board. That happened on 2026-09-04: 12 rows orphaned, 8 of
   * them carrying submit-ready proposals.
   *
   * The owner's expectation, in his words, was that a card is "immutable until I
   * explicitly and manually drop them off the board". This is what makes that true.
   * Once the desk has committed to a lead it owns a copy, and no pipeline rewrite can
   * take it away again.
   */
  lead?: LeadSnapshot;
}

/**
 * A captured lead record. `at` and `from` are provenance, not decoration: a recovered
 * card needs to be able to say where its fields came from rather than implying the
 * scraper vouched for them.
 */
export interface LeadSnapshot extends Partial<BoardRecord> {
  id: string;
  title: string;
  url: string;
  at: number;
  /** "board" / "feeds" when captured live; "pitches" when rebuilt after the record was lost. */
  from: "board" | "feeds" | "pitches";
}
export interface Research {
  status: "running" | "done" | "error" | "stopped";
  at: number;
  runId?: string;
  /** Which steps ran / were skipped, in words, for the card. */
  note?: string;
  steps?: string[];
}
export interface Brief {
  summary?: string; why?: string; approach?: string; crashCourse?: string; at?: number;
}
export interface Enrichment { proposals?: string | number | null; paymentVerified?: boolean | null; hireRate?: number | null; at?: number }
type StateStore = Record<string, DealState>;

export interface Deal extends BoardRecord {
  status: DealStatus;
  source?: string;
  /** Absolute post time (epoch ms) normalised across sources; null if unknowable. */
  postedAt: number | null;
  automatable?: boolean;
  summary: string | null;
  why: string | null; pitch: string | null; approach: string | null; crashCourse: string | null;
  notes: string; needsInfo: boolean; editedPitch: string | null;
  answers: Answer[]; enrichment: Enrichment | null; updatedAt: number | null;
  effectiveFit: number;
  /** S4 (c): the evaluator's pass/pursue call, pulled to the front of the card. */
  verdict: Verdict;
  /** S4 (d): the last visit to this listing hit the login wall. */
  needsLogin: boolean;
  loginWallAt: number | null;
  /** S4 (e): the last research pass on this card, or null if none ran. */
  research: Research | null;
  /** The quick pass/not check's result, or null if it has not run or did not stick. */
  screen: ScreenResult | null;
  /** The dossier, or null if none has been built for this card. */
  dossier: Dossier | null;
  /**
   * This card is being served from the desk's own snapshot because the pipeline no
   * longer has its record. The scores the scraper owned are not knowable for a card
   * rebuilt from pitches.json, so the UI shows them as NA rather than as zero.
   */
  recovered?: boolean;
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
// -- State store: generation rotation ------------------------------------------
//
// The live file's body is never written in place. A write creates a brand-new
// file, renames the current live file aside as the previous generation, then
// renames the new file into the live name:
//
//   1. write   upwork-desk_gen_<nonce>.json          a fresh body, written once
//   2. rename  upwork-desk.json  ->  upwork-desk_prev.json
//   3. rename  upwork-desk_gen_<nonce>.json  ->  upwork-desk.json
//
// Every body is therefore write-once, _prev's included: retiring a generation is
// a rename, which swaps the directory entry and unlinks the old inode rather
// than editing bytes. Two files sit at rest, the live one and the last good one.
//
// What this replaces: a plain writeFile over the canonical path, which rewrote
// all 121 KB of a 145-deal board on every status change and every saved
// proposal. A crash or a power cut mid-write left the file truncated, and the
// reader swallowed the parse error and returned {} - the whole board, every note
// and every drafted proposal, reported as empty rather than as broken.
function stagingFile(): string {
  return path.join(AOS, `${GEN_PREFIX}${Date.now().toString(36)}${randomBytes(4).toString("hex")}.json`);
}

async function parseStore(file: string): Promise<StateStore | null> {
  try {
    const v = JSON.parse(await readFile(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StateStore) : null;
  } catch { return null; }
}

// The newest staging file that never got promoted. A crash between steps 2 and 3
// leaves one, and it holds the NEWEST state, not a stale copy - it is the write
// that was interrupted after the rotation but before the promotion.
async function newestOrphan(): Promise<{ store: StateStore; mtime: number } | null> {
  try {
    const names = (await readdir(AOS)).filter((n) => n.startsWith(GEN_PREFIX) && n.endsWith(".json"));
    const stamped = (await Promise.all(names.map(async (n) => {
      const f = path.join(AOS, n);
      try { return { f, mtime: (await stat(f)).mtimeMs }; } catch { return null; }
    }))).filter((x): x is { f: string; mtime: number } => !!x);
    const newest = stamped.sort((a, b) => b.mtime - a.mtime)[0];
    if (!newest) return null;
    const store = await parseStore(newest.f);
    return store ? { store, mtime: newest.mtime } : null;
  } catch { return null; }
}

// Fall back through the surviving generations rather than reporting an unreadable
// board as an empty one. A missing live file on a first run is not a fault and
// stays quiet; a live file that exists but will not parse is always logged.
async function readState(): Promise<StateStore> {
  const live = await parseStore(STATE_FILE);
  if (live) return live;

  const liveExists = existsSync(STATE_FILE);
  if (!liveExists && !existsSync(PREV_FILE)) return {}; // first run, genuinely empty

  console.error(`[deal-desk] live state ${liveExists ? "did not parse" : "is missing"} at ${STATE_FILE} - trying an earlier generation`);
  // An orphan wins only if it is genuinely newer than _prev. A staging file left
  // by a crash months ago is older data, not an interrupted write, and preferring
  // it on age alone would quietly roll the board back.
  const orphan = await newestOrphan();
  const prevMtime = existsSync(PREV_FILE) ? await stat(PREV_FILE).then((s) => s.mtimeMs, () => -1) : -1;
  const useOrphan = !!orphan && orphan.mtime > prevMtime;
  const recovered = useOrphan ? orphan.store : await parseStore(PREV_FILE);
  if (recovered) {
    console.error(`[deal-desk] recovered ${Object.keys(recovered).length} deals from ${useOrphan ? "an interrupted write" : PREV_FILE}`);
    return recovered;
  }
  console.error("[deal-desk] no readable generation - the board will render empty");
  return {};
}

// In-process write mutex, same shape as hermesGoals.ts. Rotation makes a single
// write crash-safe; it does not make two concurrent read-modify-writes safe.
// Without this, approving one card while another saves a proposal has both reads
// see the same store and the slower write drop the other's change.
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(() => fn(), () => fn());
  writeLock = next.then(() => undefined, () => undefined);
  return next;
}

async function writeState(s: StateStore): Promise<void> {
  if (!existsSync(AOS)) await mkdir(AOS, { recursive: true });
  const staged = stagingFile();
  await writeFile(staged, JSON.stringify(s, null, 2), "utf8");
  // Retire the current generation. Absent on a first run, which is not a fault.
  //
  // A live file that does not parse must NOT be retired into _prev: this write is
  // very likely the recovery write that just restored the board FROM _prev, and
  // moving the damaged file over it would destroy the only good copy at the exact
  // moment it is the only good copy. Park it beside them instead, never deleted,
  // so the damage can be inspected. Re-parsing costs one read of a file readState
  // just read, which is not worth threading a flag through the call for.
  if (existsSync(STATE_FILE)) {
    const healthy = (await parseStore(STATE_FILE)) !== null;
    if (healthy) {
      await rename(STATE_FILE, PREV_FILE);
    } else {
      const parked = path.join(AOS, `${path.parse(STATE_FILE).name}_corrupt_${Date.now().toString(36)}.json`);
      await rename(STATE_FILE, parked);
      console.error(`[deal-desk] the damaged live file was parked at ${parked}; ${PREV_FILE} was left intact`);
    }
  }
  // Promote. If this throws, the staged file survives and readState finds it.
  await rename(staged, STATE_FILE);
}

// ── Merge board + pitches + state → Deal[] ──────────────────────────────────────
// ── Posted time ────────────────────────────────────────────────────────────────
// Every source states "when was this posted" differently, and one of them states it
// in a way that rots: Upwork's "Posted 2 hours ago" was accurate the moment it was
// scraped and has been drifting ever since. Cards rendered that string verbatim, so
// a month-old lead still claimed to be two hours old.
//
// Resolve all three shapes to one absolute epoch, and let the UI derive the relative
// label live from that.

const REL_UNITS: Record<string, number> = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
};

/** "Posted 2 hours ago" → 7_200_000. Null when the text isn't a relative phrase. */
function relativeOffsetMs(text: string): number | null {
  const t = text.toLowerCase();
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/);
  if (m) return Number(m[1]) * REL_UNITS[m[2]];
  // Upwork also emits these word forms, which the numeric pattern above misses.
  if (/\byesterday\b/.test(t)) return REL_UNITS.day;
  if (/\blast week\b/.test(t)) return REL_UNITS.week;
  if (/\blast month\b/.test(t)) return REL_UNITS.month;
  if (/\bjust now\b|\bmoments? ago\b/.test(t)) return 0;
  return null;
}

/**
 * Absolute post time in epoch ms, or null when it genuinely can't be known.
 * Order matters: an explicit timestamp always beats a phrase we have to reconstruct.
 */
export function resolvePostedAt(rec: Partial<BoardRecord>): number | null {
  // 1. Upwork's own absolute field (present on ~90% of board records).
  if (rec.datePosted) { const t = Date.parse(rec.datePosted); if (!Number.isNaN(t)) return t; }
  const posted = (rec.posted || "").trim();
  if (!posted) return null;
  // 2. RemoteOK (ISO 8601) and WWR (RFC 2822) both parse directly.
  const direct = Date.parse(posted);
  if (!Number.isNaN(direct)) return direct;
  // 3. A relative phrase is only meaningful against the moment it was captured.
  const off = relativeOffsetMs(posted);
  if (off === null) return null;
  const anchor = rec._scrapedAt ? Date.parse(rec._scrapedAt) : NaN;
  if (Number.isNaN(anchor)) return null;
  return anchor - off;
}

// -- (f) Age gate at landing time ----------------------------------------------
// board.json / shortlist.json (after a scrape) and feeds.json (after a pull) are
// pipeline outputs, but they are the owner's data too, so a prune never discards:
// the dropped records are written beside the file as <name>.dropped-<stamp>.json.
export type LeadsFile = "board" | "shortlist" | "feeds";
const LEADS_FILES: Record<LeadsFile, string> = { board: BOARD_FILE, shortlist: path.join(LEADS_DIR, "shortlist.json"), feeds: FEEDS_FILE };

export async function pruneLeadsFileByAge(which: LeadsFile, maxAgeDays: number, now = Date.now()): Promise<{ kept: number; dropped: number; unknown: number; droppedFile: string | null }> {
  const file = LEADS_FILES[which];
  const rows = await readJson<Partial<BoardRecord>[]>(file, []);
  if (!Array.isArray(rows) || !rows.length) return { kept: 0, dropped: 0, unknown: 0, droppedFile: null };
  const part = partitionByAge(rows, (r) => resolvePostedAt(r), maxAgeDays, now);
  if (!part.dropped.length) return { kept: part.kept.length, dropped: 0, unknown: part.unknown.length, droppedFile: null };
  const droppedFile = path.join(LEADS_DIR, `${which}.dropped-${new Date(now).toISOString().slice(0, 10)}.json`);
  const prior = await readJson<Partial<BoardRecord>[]>(droppedFile, []);
  await writeFile(droppedFile, JSON.stringify([...prior, ...part.dropped], null, 2), "utf8");
  await writeFile(file, JSON.stringify(part.kept, null, 2), "utf8");
  return { kept: part.kept.length, dropped: part.dropped.length, unknown: part.unknown.length, droppedFile };
}

export async function listDeals(): Promise<Deal[]> {
  const [board, pitches, state] = await Promise.all([
    readJson<BoardRecord[]>(BOARD_FILE, []),
    readJson<Pitch[]>(PITCHES_FILE, []),
    readState(),
  ]);
  const pitchByUrl = new Map(pitches.filter((p) => p.url).map((p) => [p.url as string, p]));

  // Only surface the pitched shortlist — those are the reviewable deals.
  const deals: Deal[] = [];
  // What the pipeline files still know about, so the snapshot pass below can tell
  // "already shown" from "the record is gone and only our copy remains".
  const emitted = new Set<string>();
  for (const b of board) {
    const p = pitchByUrl.get(b.url);
    if (!p) continue;
    const st = state[b.id] || {};
    if (st.status === "dismissed") continue; // removed from the desk
    let effectiveFit = p.fitRefined ?? b.fit;
    if (STAFFING.test(b.title || "")) effectiveFit = Math.min(effectiveFit, 2);
    const composite = +(0.4 * b.easiness + 0.4 * b.winnability + 0.2 * effectiveFit).toFixed(2);
    const defaultStatus: DealStatus = effectiveFit <= 3 ? "parked" : "new";
    // A generated brief is newer than the offline pitch pass, so it wins.
    const summary = st.brief?.summary ?? p.summary ?? null;
    const why = st.brief?.why ?? p.why ?? null;
    deals.push({
      ...b,
      description: formatDescription(b.description),
      postedAt: resolvePostedAt(b),
      composite,
      effectiveFit,
      status: st.status || defaultStatus,
      summary,
      why,
      // The verdict reads the evaluator's OWN opener, never the operator's edit.
      verdict: deriveVerdict({ why, summary, pitch: p.pitch ?? null, screen: st.screen ?? null, effectiveFit }),
      screen: st.screen ?? null,
      dossier: st.dossier ?? null,
      pitch: st.editedPitch ?? p.pitch ?? null,
      approach: st.brief?.approach ?? p.approach ?? null,
      crashCourse: st.brief?.crashCourse ?? p.crashCourse ?? null,
      notes: st.notes ?? "",
      needsInfo: st.needsInfo ?? false,
      editedPitch: st.editedPitch ?? null,
      answers: st.answers ?? [],
      enrichment: st.enrichment ?? null,
      updatedAt: st.updatedAt ?? null,
      needsLogin: st.needsLogin ?? false,
      loginWallAt: st.loginWallAt ?? null,
      research: st.research ?? null,
    });
    emitted.add(b.id);
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
      postedAt: resolvePostedAt(f),
      composite, effectiveFit,
      status: st.status || (effectiveFit <= 3 ? "parked" : "new"),
      // Feed leads skip the offline pitch pass entirely, so these come from the
      // on-demand brief if one has been generated — previously hardcoded to null,
      // which is why RemoteOK/WWR cards never showed the analysis Upwork cards did.
      summary: st.brief?.summary ?? null, why: st.brief?.why ?? null,
      verdict: deriveVerdict({ why: st.brief?.why ?? null, summary: st.brief?.summary ?? null, pitch: null, screen: st.screen ?? null, effectiveFit }),
      screen: st.screen ?? null,
      dossier: st.dossier ?? null,
      pitch: st.editedPitch ?? null,
      approach: st.brief?.approach ?? null, crashCourse: st.brief?.crashCourse ?? null,
      notes: st.notes ?? "", needsInfo: st.needsInfo ?? false, editedPitch: st.editedPitch ?? null,
      answers: st.answers ?? [], enrichment: st.enrichment ?? null, updatedAt: st.updatedAt ?? null,
      needsLogin: st.needsLogin ?? false, loginWallAt: st.loginWallAt ?? null,
      research: st.research ?? null,
    });
    emitted.add(f.id);
  }

  // Anything the owner has touched whose record the pipeline has since dropped. This
  // is the half of the fix that does the work: the capture in patch() is worthless if
  // the read still insists on finding a row in a file that no longer has one.
  for (const [id, st] of Object.entries(state)) {
    if (emitted.has(id) || !st.lead || st.status === "dismissed") continue;
    const L = st.lead;
    const effectiveFit = L.fit ?? 0;
    const easiness = L.easiness ?? 0;
    const winnability = L.winnability ?? 0;
    deals.push({
      id, subId: L.subId, title: L.title, url: L.url,
      budget: L.budget ?? null, jobType: L.jobType ?? null, experienceLevel: L.experienceLevel ?? null,
      duration: L.duration ?? null, posted: L.posted ?? null,
      description: formatDescription(L.description ?? null),
      datePosted: L.datePosted ?? null, _scrapedAt: L._scrapedAt ?? null,
      tags: L.tags ?? [], clientCountry: L.clientCountry ?? null,
      clientTotalSpent: L.clientTotalSpent ?? null, clientRating: L.clientRating ?? null,
      clientHires: L.clientHires ?? null, clientMemberSince: L.clientMemberSince ?? null,
      easiness, winnability, fit: L.fit ?? 0,
      composite: L.composite ?? +(0.4 * easiness + 0.4 * winnability + 0.2 * effectiveFit).toFixed(2),
      source: (L as { source?: string }).source,
      postedAt: resolvePostedAt(L),
      status: st.status || "new",
      effectiveFit,
      summary: st.brief?.summary ?? null, why: st.brief?.why ?? null,
      verdict: deriveVerdict({ why: st.brief?.why ?? null, summary: st.brief?.summary ?? null, pitch: null, screen: st.screen ?? null, effectiveFit }),
      screen: st.screen ?? null,
      dossier: st.dossier ?? null,
      pitch: st.editedPitch ?? null,
      approach: st.brief?.approach ?? null, crashCourse: st.brief?.crashCourse ?? null,
      notes: st.notes ?? "", needsInfo: st.needsInfo ?? false, editedPitch: st.editedPitch ?? null,
      answers: st.answers ?? [], enrichment: st.enrichment ?? null, updatedAt: st.updatedAt ?? null,
      needsLogin: st.needsLogin ?? false, loginWallAt: st.loginWallAt ?? null,
      research: st.research ?? null,
      // Only a pitches.json rebuild is missing the scraper's own scores; a snapshot
      // captured live off board.json carries them and is not flagged.
      recovered: L.from === "pitches",
    });
    emitted.add(id);
  }

  deals.sort((a, b) => b.composite - a.composite);
  return deals;
}

export async function getDeal(id: string): Promise<Deal | null> {
  return (await listDeals()).find((d) => d.id === id) || null;
}

// ── Mutations (all merge into the state store) ──────────────────────────────────
/**
 * Find a lead's record in the files the pipeline owns, so the desk can keep its own
 * copy. Returns null when the record is already gone - nothing to capture, and a
 * fabricated stub would be worse than an honest miss.
 */
async function findLeadRecord(id: string): Promise<LeadSnapshot | null> {
  const [board, feeds] = await Promise.all([
    readJson<BoardRecord[]>(BOARD_FILE, []),
    readJson<(BoardRecord & { source?: string })[]>(FEEDS_FILE, []),
  ]);
  const hit = board.find((r) => r.id === id);
  if (hit) return { ...hit, at: Date.now(), from: "board" };
  const fed = feeds.find((r) => r.id === id);
  if (fed) return { ...fed, at: Date.now(), from: "feeds" };
  return null;
}

/**
 * Every state mutation funnels through here, which is exactly why the snapshot is
 * taken here: touching a card in ANY way (a status, a note, a brief, a proposal, a
 * dossier answer) is the owner committing to it, and from that moment the desk keeps
 * its own copy of the lead. One capture, never refreshed - a later scrape re-finding
 * the lead is welcome to supply fresher fields via the normal board path, but it can
 * no longer take the card away.
 */
async function patch(id: string, fn: (s: DealState) => DealState): Promise<DealState> {
  // Read outside the lock: findLeadRecord touches only pipeline files, and holding the
  // state lock across two more file reads would serialise every desk click behind them.
  const snapshotNeeded = !(await readState())[id]?.lead;
  const captured = snapshotNeeded ? await findLeadRecord(id) : null;
  return withLock(async () => {
    const store = await readState();
    const next = fn(store[id] || {});
    next.updatedAt = Date.now();
    if (!next.lead && captured) next.lead = captured;
    store[id] = next;
    await writeState(store);
    return next;
  });
}

export async function setStatus(id: string, status: DealStatus): Promise<DealState> {
  if (!VALID_STATUS.includes(status)) throw new Error(`Invalid status: ${status}`);
  return patch(id, (s) => ({ ...s, status }));
}

/**
 * S4 (b): one status for many cards in ONE generation. Bulk deny from the board
 * face is the caller; looping setStatus would rotate the store once per card
 * (twenty renames for twenty cards) and let a crash land between two of them.
 * Returns the ids actually written (duplicates and blanks dropped).
 */
export async function setStatusBulk(ids: string[], status: DealStatus): Promise<string[]> {
  if (!VALID_STATUS.includes(status)) throw new Error(`Invalid status: ${status}`);
  const unique = [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (!unique.length) return [];
  return withLock(async () => {
    const store = await readState();
    const now = Date.now();
    for (const id of unique) store[id] = { ...(store[id] || {}), status, updatedAt: now };
    await writeState(store);
    return unique;
  });
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

export async function setBrief(id: string, b: Brief): Promise<DealState> {
  return patch(id, (s) => ({ ...s, brief: { ...b, at: Date.now() } }));
}

/**
 * Persist a quick pass/not check. A failed check writes NOTHING: the lead stays
 * unscreened and reads NA, which is the honest state. Never store a band the
 * checker did not actually return.
 */
export async function setScreen(id: string, r: Omit<ScreenResult, "at">): Promise<DealState> {
  return patch(id, (s) => ({ ...s, screen: { ...r, at: Date.now() } }));
}

/**
 * Persist a dossier. Like a screen, a failed build writes nothing: the card simply
 * has no dossier, which the proposal path treats as "build one" rather than as an
 * empty account it can proceed from.
 */
export async function setDossier(id: string, d: Dossier): Promise<DealState> {
  return patch(id, (s) => ({ ...s, dossier: d }));
}

/** S4 (e): the research pass writes its state as it goes; the card reads it. */
export async function setResearch(id: string, r: Omit<Research, "at"> & { at?: number }): Promise<DealState> {
  return patch(id, (s) => ({ ...s, research: { ...r, at: r.at ?? Date.now() } }));
}

/**
 * S4 (d): flag (or clear) the login wall on many cards in one write. `on: false`
 * with an empty list clears EVERY flagged card - that is what a fresh cookie means.
 */
export async function setNeedsLogin(ids: string[], on: boolean): Promise<string[]> {
  return withLock(async () => {
    const store = await readState();
    const now = Date.now();
    const targets = ids.length ? [...new Set(ids.filter(Boolean))] : (on ? [] : Object.keys(store).filter((id) => store[id]?.needsLogin));
    for (const id of targets) {
      const s = store[id] || {};
      store[id] = on
        ? { ...s, needsLogin: true, loginWallAt: now, updatedAt: now }
        : { ...s, needsLogin: false, updatedAt: now };
    }
    if (targets.length) await writeState(store);
    return targets;
  });
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
