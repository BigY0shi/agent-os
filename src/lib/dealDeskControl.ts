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

export type VerdictBand = "pursue" | "maybe" | "pass";

export interface Verdict {
  band: VerdictBand;
  /** The evaluator's own sentence, or an honest "no verdict written" line. */
  line: string;
  /** Where the sentence came from; "score" means nothing was written. */
  source: "why" | "summary" | "pitch" | "score";
}

export interface VerdictInput {
  why?: string | null;
  summary?: string | null;
  pitch?: string | null;
  /** The refined fit (1-10); decides the band when no text does. */
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
  // Text without a readable call: keep the evaluator's sentence, band on the score.
  if (why) return { band: bandFromScore(d.effectiveFit), line: why, source: "why" };
  if (summary) return { band: bandFromScore(d.effectiveFit), line: summary, source: "summary" };
  const fit = Number.isFinite(d.effectiveFit) ? d.effectiveFit : 0;
  return { band: bandFromScore(fit), line: `No written verdict yet (fit ${fit}/10).`, source: "score" };
}

export const VERDICT_COLOR: Record<VerdictBand, string> = {
  pursue: "#86efac",
  maybe: "#fbbf24",
  pass: "#f87171",
};

export const VERDICT_LABEL: Record<VerdictBand, string> = {
  pursue: "Pursue",
  maybe: "Maybe",
  pass: "Pass",
};

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
