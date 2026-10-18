// Deal Desk control (roadmap S4) - the pure decisions behind "more control from
// the chair": the verdict a card leads with, the age gate on scraped listings,
// the login-wall check on scraped pages, and the URL validation for manual
// intake. Nothing here touches a file, a config directory, or a process, so
// scripts/v2/smoke-deal-desk-control.mjs can import it bare.

// -- (c) Verdict first --------------------------------------------------------
//
// The evaluator already says pass or pursue: pitch.mjs writes `why` as "one blunt
// sentence on why it is/isn't a fit" and opens `pitch` with "Skip -" when it
// scores the lead <= 3; dealBrief.ts asks for the fit call at the start of
// `summary`. That sentence was buried under the summary and the chips, so the
// owner opened every card to find it. This pulls it out and bands it so a card
// can be cleared at reading speed.

export type VerdictBand = "pursue" | "maybe" | "pass" | "unknown";

export interface Verdict {
  band: VerdictBand;
  /** The evaluator's own sentence, or an honest "not screened yet" line. */
  line: string;
  /**
   * Where the sentence came from. "screen" is the cheap pass/not check;
   * "score" means an evaluator wrote prose without a readable call, so the
   * band came off the fit; "none" means nothing has looked at this lead.
   */
  source: "why" | "summary" | "pitch" | "screen" | "score" | "none";
}

/** The quick pass/not check's stored result, when one has run on a lead. */
export interface ScreenResult {
  band: VerdictBand;
  line: string;
  at: number;
  model?: string;
}

export interface VerdictInput {
  why?: string | null;
  summary?: string | null;
  pitch?: string | null;
  /** The quick pass/not check's result, if one has run. */
  screen?: ScreenResult | null;
  /** The refined fit (1-10); bands a prose evaluation that made no explicit call. */
  effectiveFit: number;
}

const PASS_RE = /\bskip\b|\bpass\b(?!\s*(through|along|it on|the))|not (a|the) (good |strong |real |clean |natural |great )?fit|poor(ly)? fit|weak fit|bad fit|isn'?t a fit|is not a fit|no fit|not (a |our )?(good |strong )?match|out of (our )?scope|don'?t (bid|pursue|bother)|\bavoid\b|not worth|hard pass|\bdecline\b/i;
const PURSUE_RE = /strong fit|good fit|great fit|excellent fit|solid fit|clear fit|perfect fit|ideal fit|natural fit|high[- ]fit|clean fit|worth (a |the )?(bid|pitch|pursuing|proposal)|\bpursue\b|go for it|\bbid\b|well[- ]suited|squarely in|right in (our|the) (wheelhouse|lane)/i;
const MAYBE_RE = /\bmaybe\b|borderline|partial(ly)? fit|moderate fit|possible fit|could be|conditional|worth a look|\bdepends\b|mixed|marginal|thin listing|if the/i;

/** The first sentence of a blurb, without a leading "Verdict:"-style label. */
export function firstSentence(text: string | null | undefined): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const s = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)[0].trim();
  return s.replace(/^(verdict|fit|call|decision)\s*[:\-]\s*/i, "").trim();
}

function bandFromText(text: string): VerdictBand | null {
  if (!text) return null;
  if (PASS_RE.test(text)) return "pass";
  if (PURSUE_RE.test(text)) return "pursue";
  if (MAYBE_RE.test(text)) return "maybe";
  return null;
}

export function bandFromScore(fit: number): VerdictBand {
  return fit >= 7 ? "pursue" : fit >= 4 ? "maybe" : "pass";
}

export function deriveVerdict(d: VerdictInput): Verdict {
  const pitch = String(d.pitch ?? "").trim();
  const why = firstSentence(d.why);
  const summary = firstSentence(d.summary);

  // The pitch pass writes a literal "Skip - <reason>" opener for a lead it
  // scored out; that is the most explicit verdict any field carries.
  if (/^skip\b/i.test(pitch)) {
    return { band: "pass", line: why || firstSentence(pitch) || "Skip.", source: why ? "why" : "pitch" };
  }
  const whyBand = bandFromText(why);
  if (why && whyBand) return { band: whyBand, line: why, source: "why" };
  const sumBand = bandFromText(summary);
  if (summary && sumBand) return { band: sumBand, line: summary, source: "summary" };
  // The quick pass/not check ran even though no brief did. It is a real look at
  // the listing, so it outranks banding the fit.
  if (d.screen && d.screen.band) {
    return { band: d.screen.band, line: d.screen.line || "Screened.", source: "screen" };
  }
  // Prose without a readable call: keep the evaluator's sentence, band on the score.
  // Banding real prose is interpretation; banding a lead nobody read is invention,
  // which is what the fall-through below used to do.
  if (why) return { band: bandFromScore(d.effectiveFit), line: why, source: "why" };
  if (summary) return { band: bandFromScore(d.effectiveFit), line: summary, source: "summary" };
  // Nothing has evaluated this lead. The fit it carries is the feed's keyword
  // heuristic, not a judgement: feeds.json scores 53 of 131 WeWorkRemotely rows at
  // exactly 8, including "Cribl: Customer Support Manager". Banding that produced a
  // confident green Pursue on leads nobody had looked at. Unknown is the honest answer.
  return { band: "unknown", line: "Not screened yet.", source: "none" };
}

export const VERDICT_COLOR: Record<VerdictBand, string> = {
  pursue: "#86efac",
  maybe: "#fbbf24",
  pass: "#f87171",
  unknown: "#c084fc",
};

export const VERDICT_LABEL: Record<VerdictBand, string> = {
  pursue: "Pursue",
  maybe: "Maybe",
  pass: "Pass",
  unknown: "NA",
};

/** An unscreened lead shows NA rather than the number it never earned. */
export function fitLabel(band: VerdictBand, fit: number): string {
  return band === "unknown" ? "NA" : String(fit);
}

// -- Dossier ---------------------------------------------------------------------
//
// Splitting "understand this listing" from "write the proposal". The proposal pass
// used to receive the notes, the card Q&A, the brief and up to 14k of listing all at
// once, and had to reconcile them WHILE producing copy. The dossier does the
// reconciling once and writes it down, so the writer consumes a settled account
// instead of re-deriving one on every regeneration.
//
// Kept as data rather than as a warm agent holding context: every desk route shells
// out to a `claude -p` that exits, the server restarts often, and an account the owner
// can read and correct beats session state he cannot open.

export interface DossierAsk {
  /** The client's requirement, verbatim from the listing wherever possible. */
  ask: string;
  /** How we answer it from the material on hand, or null when nothing covers it. */
  answer: string | null;
}

export interface Dossier {
  /** Every explicit question or application instruction found in the listing. */
  asks: DossierAsk[];
  /** A phrase the listing demands the proposal open with, when it names one. */
  openWith: string | null;
  /** Our angle, reconciled from the notes, the Q&A and the brief. */
  position: string;
  /** What they asked that nothing on hand answers. Honest gaps, not filler. */
  gaps: string[];
  at: number;
  model?: string;
  /** Fingerprint of the inputs this was built from, so staleness is detectable. */
  inputHash: string;
}

/**
 * FNV-1a over the inputs a dossier was built from. Deliberately dependency-free so
 * this module stays bare-importable by the smoke; it is a change detector, not a
 * security primitive.
 */
export function dossierInputHash(parts: {
  description?: string | null;
  notes?: string | null;
  answers?: { q: string; a: string }[] | null;
  summary?: string | null;
  why?: string | null;
  approach?: string | null;
  crashCourse?: string | null;
}): string {
  const joined = [
    parts.description ?? "",
    parts.notes ?? "",
    (parts.answers ?? []).map((a) => `${a.q}\u0000${a.a}`).join("\u0001"),
    parts.summary ?? "",
    parts.why ?? "",
    parts.approach ?? "",
    parts.crashCourse ?? "",
  ].join("\u0002");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A dossier is stale once any input it was built from has changed - the owner adding
 * a note or asking another question is exactly when it must be rebuilt, and silently
 * writing a proposal off the old account is the failure worth preventing.
 */
export function dossierIsStale(dossier: Dossier | null | undefined, currentHash: string): boolean {
  if (!dossier) return true;
  return dossier.inputHash !== currentHash;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "this", "that", "have", "has", "are",
  "will", "would", "should", "can", "any", "all", "from", "into", "about", "please", "tell",
  "what", "when", "which", "who", "how", "why", "include", "provide", "describe", "explain",
  "want", "need", "like", "make", "give", "also", "must", "each", "their", "them", "they",
]);

/** Distinctive words of an ask: what a real answer would almost certainly echo. */
function keyTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const w of String(text).toLowerCase().match(/[a-z0-9][a-z0-9+.#-]{3,}/g) ?? []) {
    if (!STOPWORDS.has(w)) seen.add(w);
  }
  return [...seen];
}

/**
 * Asks the draft looks like it never addressed.
 *
 * This is a HEURISTIC and is framed as one on purpose: it reports what is probably
 * MISSING and never asserts that anything is covered. Term overlap cannot prove an
 * answer is present or good, and a check that claimed it could would be the same
 * invention the NA verdict band exists to prevent. Treat a hit as "look at this",
 * not as a verdict.
 */
export function likelyMissedAsks(draft: string, dossier: Dossier | null | undefined, threshold = 0.34): DossierAsk[] {
  if (!dossier?.asks?.length) return [];
  const hay = String(draft ?? "").toLowerCase();
  if (!hay.trim()) return dossier.asks.slice();
  return dossier.asks.filter((a) => {
    const terms = keyTerms(a.ask);
    // Nothing distinctive to look for; do not guess either way.
    if (!terms.length) return false;
    const hits = terms.filter((t) => hay.includes(t)).length;
    return hits / terms.length < threshold;
  });
}

/** The listing demanded an opening phrase and the draft does not start with it. */
export function openWithViolated(draft: string, dossier: Dossier | null | undefined): boolean {
  const want = dossier?.openWith?.trim();
  if (!want) return false;
  return !String(draft ?? "").trim().toLowerCase().startsWith(want.toLowerCase());
}

// -- Listing text for a model prompt --------------------------------------------
//
// The proposal route sliced the description at 1500 characters while the BRIEF got
// 4000, so the one component that must answer the client's questions was the one that
// could not see them. Measured over the real board (170 listings): 88 run past 1500
// characters, 75 carry explicit application instructions, and 54 of those 75 sit PAST
// character 1500. Those instructions are terminal ("To Apply", "When applying"), so a
// head slice drops exactly what has to be answered.
//
// The cap clears the longest listing in the corpus (12,069). If one ever exceeds it,
// BOTH ends are kept, because the tail is where the instructions live.
export const DESC_CAP = 14000;
export const TAIL_KEEP = 4000;

export function listingText(d: string | null | undefined): string {
  const t = String(d ?? "");
  if (t.length <= DESC_CAP) return t;
  return `${t.slice(0, DESC_CAP - TAIL_KEEP)}

[... middle of the listing trimmed ...]

${t.slice(-TAIL_KEEP)}`;
}

// -- (f) Age gate ---------------------------------------------------------------
//
// The feed was pulling listings three to four weeks old and the board showed them
// beside fresh ones. `deals.maxAgeDays` (gear, default 5) drops older listings when
// a scrape or a feed pull LANDS, and the age shows on the card. A record whose post
// time cannot be resolved is KEPT, never dropped: an unknown date is not an old one.

export const DEFAULT_MAX_AGE_DAYS = 5;

// What the Upwork scrape searches for (owner, 2026-10-08: "a space in the configuration
// settings to set the topic/keywords"). These defaults are the 24 searches the crawler's
// hand-edited INPUT.json held that day, so nothing changes until the gear is edited; the
// scrape route now writes them into INPUT.json before every run.
export const DEFAULT_SEARCH_QUERIES: readonly string[] = [
  "hubspot automation", "gohighlevel", "salesforce administrator", "zapier automation",
  "make.com automation", "n8n automation", "ai agent development", "ai chatbot development",
  "klaviyo email marketing", "shopify klaviyo", "shopify developer", "webflow",
  "wordpress developer", "next js developer", "react developer", "crm setup", "ai seo",
  "power bi dashboard", "airtable automation", "saas ui ux design", "app development",
  "custom app development", "generative engine optimization", "workflow optimization",
];
export const DEFAULT_PAGES_PER_QUERY = 2;
export const MAX_SEARCH_QUERIES = 60;

/** Searches from whatever the settings hold (an array, or one-per-line / comma text):
 *  trimmed, case-insensitively deduped, 1-80 chars each, at most MAX_SEARCH_QUERIES.
 *  Nothing usable -> the defaults (an empty search list would make the scrape throw). */
export function cleanSearchQueries(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const q = String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!q || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(q);
    if (out.length >= MAX_SEARCH_QUERIES) break;
  }
  return out.length ? out : [...DEFAULT_SEARCH_QUERIES];
}

/** Result pages read per search: 1..10, default 2 (about 10 jobs a page). */
export function clampPagesPerQuery(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGES_PER_QUERY;
  return Math.min(10, Math.round(n));
}

/** The crawler input for this run, from the Deal Desk gear (2026-10-08). Keys the gear does
 *  not own (headless, maxConcurrency, dedupe, ...) are kept from the existing file. */
export function crawlerInput(existing: Record<string, unknown>, deals: { searchQueries?: unknown; pagesPerQuery?: unknown; maxAgeDays?: unknown } | undefined): Record<string, unknown> {
  return {
    ...existing,
    queries: cleanSearchQueries(deals?.searchQueries),
    maxPagesPerQuery: clampPagesPerQuery(deals?.pagesPerQuery),
    // The age gate now runs on the search page too, so an old job is never opened.
    maxAgeDays: clampMaxAgeDays(deals?.maxAgeDays),
  };
}
const DAY_MS = 86_400_000;

/** Whole days since `postedAt`; null when the instant is unknown. */
export function ageDays(postedAt: number | null | undefined, now = Date.now()): number | null {
  if (typeof postedAt !== "number" || !Number.isFinite(postedAt)) return null;
  return Math.max(0, Math.floor((now - postedAt) / DAY_MS));
}

/** A usable gate from whatever the settings file holds: 1..365, default 5. */
export function clampMaxAgeDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_AGE_DAYS;
  return Math.min(365, Math.round(n));
}

// Landing-time pruning alone was never enough, and the board proved it: on
// 2026-09-04 feeds.json held 131 rows of which a 5-day gate would have dropped
// 120, and no feeds.dropped-*.json had ever been written, so the prune had never
// run on that data at all. Two holes made that possible. A row written by any
// path other than POST /api/deals/feeds (running feeds.mjs by hand, an early
// return at the route's 502 guard) is never seen by the prune; and age is not a
// property that holds still, so a row that passed the gate on Monday is stale by
// Friday and nothing looks at it again.
//
// So the gate is also applied where the board is READ, against the current
// clock. Non-destructive on purpose: the row stays in the file, the desk simply
// does not show it, and the count of what was hidden is reported rather than
// swallowed.

/**
 * Statuses the gate never hides. Once a lead has been picked up, its posting
 * date stops being the point: dropping a card out from under a proposal already
 * sent would destroy work, which is worse than showing something old.
 */
export const AGE_GATE_EXEMPT: ReadonlySet<string> = new Set([
  "reviewing", "approved", "ready", "sent", "denied", "dismissed",
]);

/**
 * Should the desk hide this lead as stale? Only untouched triage ("new",
 * "parked") is eligible. An unresolvable post time is KEPT, matching the prune:
 * an unknown date is not an old one.
 */
export function hiddenByAgeGate(
  status: string,
  postedAt: number | null | undefined,
  maxAgeDays: number,
  now = Date.now(),
): boolean {
  if (AGE_GATE_EXEMPT.has(status)) return false;
  const age = ageDays(postedAt, now);
  if (age === null) return false;
  return age > clampMaxAgeDays(maxAgeDays);
}

// -- (d) Login wall -------------------------------------------------------------
//
// The browser was logged out and enrichment ran against the login page as if it
// were the listing. Any scraped page (enrichment, manual intake) passes its
// title, final URL and body text through here BEFORE its fields are trusted.
// Markers were taken from Upwork-Leads/actor/enrich.mjs (the "log in to
// continue" family) and from Upwork's login route (/ab/account-security/login).

export interface ScrapedPage {
  title?: string | null;
  url?: string | null;
  /** Body text, whitespace-collapsed; the first few thousand chars are enough. */
  text?: string | null;
}

export interface LoginWallCheck {
  wall: boolean;
  /** Which marker fired, for the log line and the card. Null when no wall. */
  reason: "url" | "title" | "text" | null;
}

const LOGIN_URL_RE = /upwork\.com\/(ab\/account-security\/login|login|nx\/signup|signup)\b/i;
const LOGIN_TITLE_RE = /^\s*(log ?in|sign ?in|sign ?up)\b|\blog ?in to upwork\b|\bupwork login\b/i;
const LOGIN_TEXT_RE = /\b(log ?in|sign ?up|sign ?in) to (continue|apply|see|view|proceed)\b|\blog ?in to upwork\b|\bwelcome back\b[\s\S]{0,120}\bpassword\b|\bforgot password\b[\s\S]{0,200}\b(log ?in|continue with (google|apple))\b/i;
// A listing page carries these; the login page does not. Their presence vetoes a
// text-only match, because listings quote "log in to apply" in their own copy.
const LISTING_TEXT_RE = /\bproposals\b|\babout the client\b|\bjob details\b|\bactivity on this job\b/i;

export function detectLoginWall(page: ScrapedPage): LoginWallCheck {
  const url = String(page.url ?? "");
  const title = String(page.title ?? "");
  const text = String(page.text ?? "").replace(/\s+/g, " ");
  if (LOGIN_URL_RE.test(url)) return { wall: true, reason: "url" };
  if (LOGIN_TITLE_RE.test(title)) return { wall: true, reason: "title" };
  if (LOGIN_TEXT_RE.test(text.slice(0, 6000)) && !LISTING_TEXT_RE.test(text)) return { wall: true, reason: "text" };
  return { wall: false, reason: null };
}

/** The page to send the owner to when a wall is hit. */
export const UPWORK_LOGIN_URL = "https://www.upwork.com/ab/account-security/login";

// -- (a) Manual intake ------------------------------------------------------------
//
// The owner pastes one or more job-listing URLs and the desk scrapes, evaluates
// and pitches them like feed items. Only Upwork job pages are accepted today:
// the scraper's record shape (Upwork-Leads/actor/src/parse.js mergeRecord) is
// keyed on the job uid, and every other host would need its own parser. A URL
// that is not that is rejected BY NAME with the reason, never dropped quietly.

export const INTAKE_MAX_URLS = 20;

export interface IntakeTarget {
  /** The job uid (digits after ~02 / ~01); the desk's stable key. */
  id: string;
  /** Canonical listing URL, the form the scraper writes. */
  url: string;
  /** What was pasted, for the report. */
  input: string;
}

export interface IntakeParse {
  accepted: IntakeTarget[];
  rejected: { input: string; reason: string }[];
}

const UID_RE = /~0[12](\d{15,22})\b/;

/** Split pasted text (or a list) into distinct, canonical Upwork job targets. */
export function parseIntakeUrls(input: string | string[]): IntakeParse {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[\s,;]+/);
  const out: IntakeParse = { accepted: [], rejected: [] };
  const seen = new Set<string>();
  for (const piece of raw) {
    const s = String(piece ?? "").trim();
    if (!s) continue;
    if (out.accepted.length >= INTAKE_MAX_URLS) { out.rejected.push({ input: s, reason: `over the ${INTAKE_MAX_URLS}-URL cap for one paste` }); continue; }
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { out.rejected.push({ input: s, reason: "not a URL" }); continue; }
    if (!/(^|\.)upwork\.com$/i.test(u.hostname)) { out.rejected.push({ input: s, reason: `not an Upwork listing (${u.hostname})` }); continue; }
    const m = u.pathname.match(UID_RE) || u.search.match(UID_RE);
    if (!m) { out.rejected.push({ input: s, reason: "an Upwork page, but not a job listing (no ~02 job id in the path)" }); continue; }
    const id = m[1];
    if (seen.has(id)) continue; // the same listing pasted twice is one target
    seen.add(id);
    out.accepted.push({ id, url: `https://www.upwork.com/jobs/~02${id}/`, input: s });
  }
  return out;
}

export interface AgePartition<T> {
  kept: T[];
  dropped: T[];
  /** Kept too, listed so a caller can say how many had no date. */
  unknown: T[];
}

/**
 * Split records into kept / dropped by `maxAgeDays`. `postedAtOf` resolves the
 * absolute post time (lib/upworkDesk resolvePostedAt); null keeps the record.
 */
export function partitionByAge<T>(items: T[], postedAtOf: (t: T) => number | null, maxAgeDays: number, now = Date.now()): AgePartition<T> {
  const limit = clampMaxAgeDays(maxAgeDays);
  const out: AgePartition<T> = { kept: [], dropped: [], unknown: [] };
  for (const it of items) {
    const age = ageDays(postedAtOf(it), now);
    if (age === null) { out.kept.push(it); out.unknown.push(it); continue; }
    if (age > limit) out.dropped.push(it); else out.kept.push(it);
  }
  return out;
}
