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
