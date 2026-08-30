// SPEC-F K3.2 — story dedupe: URL canonicalization + embedding cosine.
//
// Two newsletters covering the same story is the NORM, and the whole point of
// the edition is to show it once with both source chips. The merge ladder:
//   1. exact canonical_url hit  (deterministic, always available)
//   2. embedding cosine ≥ settings.newsletter.dedupeThreshold over stories from
//      the last `dedupeWindowDays` days (bounded scan — cheap in JS at our
//      volumes; no vec0 table needed, and the spec sanctions the brute force)
// When the embedder is unreachable the ladder degrades to step 1 ONLY and the
// sync result says `embedDegraded: true`. Honest telemetry beats a silent
// quality drop — offline, that flag is always true.

import { readSettings } from "../../settings";
import { getEmbeddings } from "../memory/embed";
import {
  addStorySource,
  createStory,
  findStoryByCanonicalUrl,
  listStoriesWithEmbeddings,
  today,
} from "./store";
import type { ExtractedItem, NewsletterEmail, Story } from "./types";

/** Query params stripped from every URL before comparison. */
const STRIP_EXACT = new Set([
  "ref",
  "ref_src",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
]);
const STRIP_PREFIX = [/^utm_/i];

/**
 * Hosts whose links are pure redirect wrappers: the real destination sits in a
 * `url`/`u`/`href`/`target`/`redirect` query param. Settings-overridable
 * (rule 16) via settings.newsletter.trackerHosts.
 */
const DEFAULT_TRACKER_HOSTS = [
  "link.mail.beehiiv.com",
  "tracking.tldrnewsletter.com",
  "click.convertkit-mail.com",
  "links.substack.com",
  "email.mg.substack.com",
  "clicks.aweber.com",
  "trk.klclick.com",
];

const REDIRECT_PARAMS = ["url", "u", "href", "target", "redirect", "r", "destination"];

function trackerHosts(): string[] {
  const configured = readSettings().newsletter?.trackerHosts;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.filter((h): h is string => typeof h === "string").map((h) => h.toLowerCase());
  }
  return DEFAULT_TRACKER_HOSTS;
}

function isTrackerHost(host: string, hosts: string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((t) => h === t || h.endsWith(`.${t}`));
}

/**
 * Canonicalize a story URL for dedupe. Returns null for anything that is not an
 * absolute http(s) URL (an item with no link is legal — it just cannot dedupe
 * by URL).
 *
 * Steps: unwrap tracker redirects (up to 3 hops) → lowercase host, drop a
 * leading `www.` and a default port → strip utm_ prefixed params plus
 * ref / fbclid / mc_cid / mc_eid / gclid / igshid
 * → sort the surviving params (stable ordering) → drop the fragment → drop a
 * trailing slash.
 */
export function canonicalizeUrl(raw: string | null | undefined, depth = 0): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  // 1. Tracker unwrap — recurse into the embedded destination.
  if (depth < 3 && isTrackerHost(u.hostname, trackerHosts())) {
    for (const p of REDIRECT_PARAMS) {
      const inner = u.searchParams.get(p);
      if (inner && /^https?:\/\//i.test(inner.trim())) {
        const unwrapped = canonicalizeUrl(inner, depth + 1);
        if (unwrapped) return unwrapped;
      }
    }
  }

  // 2. Host normalization.
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  const port =
    (u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")
      ? ""
      : u.port;

  // 3. Param strip + stable sort.
  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (STRIP_EXACT.has(k.toLowerCase())) continue;
    if (STRIP_PREFIX.some((re) => re.test(k))) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const query = kept.length
    ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";

  // 4. Path: drop a trailing slash (root collapses to empty).
  let pathname = u.pathname;
  if (pathname.endsWith("/") && pathname.length > 1) pathname = pathname.slice(0, -1);
  if (pathname === "/") pathname = "";

  // 5. Fragment is always dropped.
  return `${u.protocol}//${host}${port ? `:${port}` : ""}${pathname}${query}`;
}

/** Cosine over two vectors. Memory V2 L2-normalizes, so this is a dot product —
 *  but the norms are divided out anyway so a hand-built vector still works. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function storyText(item: { title: string; summary?: string }): string {
  return [item.title, item.summary ?? ""].map((s) => s.trim()).filter(Boolean).join("\n");
}

export function dedupeThreshold(): number {
  const v = readSettings().newsletter?.dedupeThreshold;
  return typeof v === "number" && v > 0 && v <= 1 ? v : 0.86;
}

function dedupeWindowDays(): number {
  const v = readSettings().newsletter?.dedupeWindowDays;
  return typeof v === "number" && v >= 0 && v <= 90 ? Math.floor(v) : 3;
}

function windowStart(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - dedupeWindowDays());
  return today(d);
}

/**
 * Embed a batch of item texts. Returns `null` per item AND `degraded: true`
 * when the embedder is unreachable — never throws, because a missing embedder
 * must degrade dedupe, not lose the newsletter.
 */
export async function embedItems(
  texts: string[],
): Promise<{ vectors: Array<Float32Array | null>; degraded: boolean; error?: string }> {
  if (texts.length === 0) return { vectors: [], degraded: false };
  try {
    const raw = await getEmbeddings(texts);
    return { vectors: raw.map((v) => Float32Array.from(v)), degraded: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[newsletter/dedupe] embedder unreachable — dedupe degrades to canonical-URL only: ${message}`,
    );
    return { vectors: texts.map(() => null), degraded: true, error: message };
  }
}

export interface DuplicateHit {
  story: Story;
  reason: "canonical-url" | "embedding";
  score?: number;
}

/**
 * Find an existing story this item duplicates. Step 1 (URL) is exact and always
 * runs; step 2 (embedding) only when a vector is available.
 */
export function findDuplicate(input: {
  canonicalUrl: string | null;
  embedding: Float32Array | null;
}): DuplicateHit | null {
  if (input.canonicalUrl) {
    const hit = findStoryByCanonicalUrl(input.canonicalUrl);
    if (hit) return { story: hit, reason: "canonical-url" };
  }
  if (!input.embedding) return null;

  const threshold = dedupeThreshold();
  let best: DuplicateHit | null = null;
  for (const candidate of listStoriesWithEmbeddings(windowStart())) {
    if (!candidate.embedding) continue;
    const score = cosine(input.embedding, candidate.embedding);
    if (score >= threshold && (!best || score > (best.score ?? 0))) {
      const { embedding: _drop, ...story } = candidate;
      void _drop;
      best = { story, reason: "embedding", score };
    }
  }
  return best;
}

export interface AbsorbResult {
  newStories: number;
  merged: number;
  embedDegraded: boolean;
  storyIds: string[];
}

/**
 * The display name for a story's source chip.
 *
 * The SENDER wins. A chip names the publication that ran the story, and the
 * only thing that reliably knows that is the mail itself — the subscription is
 * whatever bucket the alias happens to belong to. Under one-alias-per-sector
 * (the real usage pattern, since addy quotas are finite) a subscription covers
 * several publications, so preferring its name labelled every story in a sector
 * identically.
 *
 * The subscription name still serves as the fallback: it is the human's own
 * label, and it beats a bare address when a sender set no display name.
 */
export function sourceNameFor(email: NewsletterEmail, subscriptionName?: string | null): string {
  const sender = email.fromName?.trim();
  if (sender) return sender;
  if (subscriptionName && subscriptionName.trim()) return subscriptionName.trim();
  return email.fromAddr?.trim() || email.subject?.trim() || "Unknown source";
}

/**
 * Fold one email's extracted items into the story graph: each item either
 * creates a story or attaches as a SOURCE on the story it duplicates.
 *
 * `firstSeen` (the edition bucket) is the day the story first appeared —
 * merging into an older story deliberately does NOT move it, so a story stays
 * in the edition that first carried it.
 */
export async function absorbItems(
  email: NewsletterEmail,
  items: ExtractedItem[],
  opts: { sourceName: string; date?: string } = { sourceName: "Unknown source" },
): Promise<AbsorbResult> {
  const out: AbsorbResult = { newStories: 0, merged: 0, embedDegraded: false, storyIds: [] };
  if (items.length === 0) return out;

  const { vectors, degraded } = await embedItems(items.map((i) => storyText(i)));
  out.embedDegraded = degraded;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const canonicalUrl = canonicalizeUrl(item.url ?? null);
    const embedding = vectors[i] ?? null;

    const dup = findDuplicate({ canonicalUrl, embedding });
    if (dup) {
      // Only count a MERGE when this email is a genuinely new source for the
      // story — re-listing the same email's item twice is not a merge.
      const added = addStorySource({
        storyId: dup.story.id,
        emailId: email.id,
        sourceName: opts.sourceName,
        itemUrl: item.url ?? null,
        itemTitle: item.title,
      });
      if (added) out.merged++;
      out.storyIds.push(dup.story.id);
      continue;
    }

    const story = createStory({
      title: item.title,
      canonicalUrl,
      summary: item.summary ?? "",
      embedding,
      firstSeen: opts.date ?? today(),
    });
    addStorySource({
      storyId: story.id,
      emailId: email.id,
      sourceName: opts.sourceName,
      itemUrl: item.url ?? null,
      itemTitle: item.title,
    });
    out.newStories++;
    out.storyIds.push(story.id);
  }
  return out;
}
