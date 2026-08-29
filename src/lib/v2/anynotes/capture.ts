// SPEC-F I1.2 — the capture engine: URL classification, oEmbed (tweet/video),
// readability (article), screenshot save.
//
// Failure policy (SPEC-F §5): capture NEVER throws for a remote problem. Every
// extraction failure degrades to a link-only note with meta.captureMode='fallback'
// and a captureError string the route surfaces as a 422 — the user learns loudly
// that extraction failed and still keeps the link. Config/programming errors
// (bad base64, unwritable media dir) DO throw — that is the SPEC-F §4 error
// split ("external soft, config loud").
//
// OFFLINE: ANYNOTES_OFFLINE=1 short-circuits every network call, so the smoke
// script (and any air-gapped run) exercises the classify + degrade + readability
// paths without touching the wire. extractArticleFromHtml() is pure: it takes an
// HTML string, which is how the fixture is tested.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { readSettings } from "../../settings";
import { shortId } from "./store";
import type { CaptureMode, NoteType } from "./types";

// ── paths ────────────────────────────────────────────────────────────────────

/** Media root. AGENTIC_OS_ANYNOTES_DIR is the smoke override (same pattern as
 *  AGENTIC_OS_DB / AGENTIC_OS_SETTINGS) so tests never write the real folder. */
export function anynotesDir(): string {
  const override = process.env.AGENTIC_OS_ANYNOTES_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "anynotes");
}

export function mediaDir(): string {
  return path.join(anynotesDir(), "media");
}

/** Filenames the media route will serve. Anything else is rejected before any
 *  filesystem call — the resolve-prefix check below is the second gate. */
export const MEDIA_FILE_RE = /^[a-z0-9_-]+\.(png|jpg|jpeg|webp)$/;

/**
 * Resolve a media filename to an absolute path, or null if it is not a plain
 * safe filename inside the media dir (kanbanWorkspace.resolveWorkspaceFilePath
 * pattern: regex FIRST, then resolve + prefix check, so encoded traversal
 * (`..%2f`, `..\`) and absolute paths both die).
 */
export function mediaFilePath(file: string): string | null {
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    return null; // malformed percent-encoding is not a filename
  }
  if (!MEDIA_FILE_RE.test(name)) return null;
  const root = mediaDir();
  const abs = path.resolve(root, name);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

// ── settings ─────────────────────────────────────────────────────────────────

export function maxSnapshotChars(): number {
  const v = readSettings().anynotes?.maxSnapshotChars;
  return typeof v === "number" && v > 0 ? Math.min(v, 500_000) : 24_000;
}

export function isOffline(): boolean {
  return process.env.ANYNOTES_OFFLINE === "1";
}

// ── URL classification ───────────────────────────────────────────────────────

const TWEET_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);
const VIDEO_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** tweet | video | article — the three URL note types (screenshot/text are not URLs). */
export function classifyUrl(url: string): Extract<NoteType, "tweet" | "video" | "article"> {
  const host = hostOf(url);
  if (TWEET_HOSTS.has(host)) return "tweet";
  if (VIDEO_HOSTS.has(host)) return "video";
  return "article";
}

// ── HTML → markdown ──────────────────────────────────────────────────────────

// Same config as the gmail connector's turndown (SPEC-F §4 port map: "copied as-is").
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["style", "script", "noscript", "iframe", "object", "embed"]);

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n\n…[snapshot truncated at ${max} chars]` : s;
}

export interface ArticleExtract {
  title: string;
  author: string | null;
  site: string | null;
  contentMd: string;
  thumbUrl: string | null;
  mode: Extract<CaptureMode, "readability" | "opengraph">;
}

function metaContent(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return null;
}

/**
 * Readability over a raw HTML string — PURE (no network), which is what the
 * smoke fixture drives. Falls back to an og-meta + title scrape when readability
 * finds no article body; returns null only when neither yields a title or text.
 */
export function extractArticleFromHtml(
  html: string,
  url: string,
  max = maxSnapshotChars(),
): ArticleExtract | null {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  const site = metaContent(doc, ['meta[property="og:site_name"]']) || hostOf(url) || null;
  const thumbUrl =
    metaContent(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]']) || null;

  let readTitle: string | null = null;
  let readAuthor: string | null = null;
  let readMd = "";
  try {
    // Readability mutates the document it is given — fine, it is ours.
    const parsed = new Readability(doc).parse();
    if (parsed) {
      readTitle = parsed.title?.trim() || null;
      readAuthor = parsed.byline?.trim() || null;
      if (parsed.content) readMd = turndown.turndown(parsed.content).trim();
    }
  } catch {
    /* fall through to the og/title scrape below */
  }

  if (readMd) {
    return {
      title: readTitle || metaContent(doc, ['meta[property="og:title"]']) || url,
      author: readAuthor,
      site,
      contentMd: cap(readMd, max),
      thumbUrl,
      mode: "readability",
    };
  }

  const ogTitle =
    metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    doc.querySelector("title")?.textContent?.trim() ||
    null;
  const ogDesc =
    metaContent(doc, ['meta[property="og:description"]', 'meta[name="description"]']) || null;
  if (!ogTitle && !ogDesc) return null;
  return {
    title: ogTitle || url,
    author: null,
    site,
    contentMd: cap((ogDesc ?? "").trim(), max),
    thumbUrl,
    mode: "opengraph",
  };
}

// ── network helpers ──────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 AgentOS-AnyNotes/1";

async function fetchText(url: string, accept: string, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

interface OEmbed {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  html?: string;
}

async function fetchOEmbed(endpoint: string): Promise<OEmbed> {
  const raw = await fetchText(endpoint, "application/json");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("oEmbed response was not an object");
  return parsed as OEmbed;
}

/** oEmbed tweet HTML → readable text (the blockquote body, links kept). */
function tweetHtmlToText(html: string, max: number): string {
  const { document } = parseHTML(`<body>${html}</body>`);
  const quote = document.querySelector("blockquote") ?? document.body;
  const text = (quote?.textContent ?? "").replace(/\s*\n\s*\n+/g, "\n\n").trim();
  return cap(text, max);
}

// ── capture ──────────────────────────────────────────────────────────────────

export interface CaptureResult {
  type: NoteType;
  title: string;
  author: string | null;
  site: string | null;
  contentMd: string;
  thumbUrl: string | null;
  meta: Record<string, unknown>;
  /** true = link-only degraded note; the route answers 422 and still saves it. */
  degraded: boolean;
  /** Why extraction failed, when degraded. Surfaced verbatim to the user. */
  error?: string;
}

function fallback(url: string, type: NoteType, why: string): CaptureResult {
  let title = url;
  try {
    const u = new URL(url);
    title = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    /* keep the raw string */
  }
  return {
    type,
    title,
    author: null,
    site: hostOf(url) || null,
    contentMd: url,
    thumbUrl: null,
    meta: { captureMode: "fallback" satisfies CaptureMode, captureError: why },
    degraded: true,
    error: why,
  };
}

/**
 * Capture a URL. Classifies, then runs the type's extractor. Any remote failure
 * (and ANYNOTES_OFFLINE=1) degrades to a link-only note rather than throwing.
 */
export async function captureUrl(
  url: string,
  opts: { max?: number } = {},
): Promise<CaptureResult> {
  const max = opts.max ?? maxSnapshotChars();
  const type = classifyUrl(url);
  if (isOffline()) {
    return fallback(url, type, "ANYNOTES_OFFLINE=1 — network capture skipped");
  }
  try {
    if (type === "tweet") return await captureTweet(url, max);
    if (type === "video") return await captureVideo(url, max);
    return await captureArticle(url, max);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return fallback(url, type, why);
  }
}

export async function captureTweet(url: string, max = maxSnapshotChars()): Promise<CaptureResult> {
  // x.com/twitter.com oEmbed has been flaky post-migration (SPEC-F §8) — the
  // degraded contract above is the whole mitigation. NO headless-browser
  // fallback here: workstream E owns browser automation. V2-BROWSER-CAPTURE
  const endpoint = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`;
  const data = await fetchOEmbed(endpoint);
  const body = data.html ? tweetHtmlToText(data.html, max) : "";
  if (!body && !data.author_name) throw new Error("oEmbed returned no tweet body");
  return {
    type: "tweet",
    title: body ? body.split("\n")[0].slice(0, 140) : `Tweet by ${data.author_name}`,
    author: data.author_name ?? null,
    site: data.provider_name ?? (hostOf(url) || null),
    contentMd: body,
    thumbUrl: data.thumbnail_url ?? null,
    meta: { captureMode: "oembed" satisfies CaptureMode, oembed: { provider: data.provider_name } },
    degraded: false,
  };
}

export async function captureVideo(url: string, max = maxSnapshotChars()): Promise<CaptureResult> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const data = await fetchOEmbed(endpoint);
  if (!data.title) throw new Error("oEmbed returned no video title");
  return {
    type: "video",
    title: data.title,
    author: data.author_name ?? null,
    site: data.provider_name ?? "YouTube",
    contentMd: cap([data.title, data.author_name ? `by ${data.author_name}` : "", url].filter(Boolean).join("\n\n"), max),
    thumbUrl: data.thumbnail_url ?? null,
    meta: { captureMode: "oembed" satisfies CaptureMode, oembed: { provider: data.provider_name } },
    degraded: false,
  };
}

export async function captureArticle(url: string, max = maxSnapshotChars()): Promise<CaptureResult> {
  const html = await fetchText(url, "text/html,application/xhtml+xml");
  const extracted = extractArticleFromHtml(html, url, max);
  if (!extracted) throw new Error("readability found no article content");
  return {
    type: "article",
    title: extracted.title,
    author: extracted.author,
    site: extracted.site,
    contentMd: extracted.contentMd,
    thumbUrl: extracted.thumbUrl,
    meta: { captureMode: extracted.mode },
    degraded: false,
  };
}

// ── screenshots ──────────────────────────────────────────────────────────────

const MAGIC: Array<{ ext: "png" | "jpg" | "webp"; test: (b: Buffer) => boolean }> = [
  { ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

/** 20 MB — a pasted screenshot far above this is a mistake, not a note. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Persist a pasted/dropped image under the media dir. THROWS on bad input
 * (unreadable base64, unrecognized format, oversize) — that is a caller/config
 * error, not a remote failure, so it must be loud (SPEC-F §4 split).
 */
export function saveScreenshot(imageBase64: string): { mediaPath: string; bytes: number } {
  const stripped = imageBase64.replace(/^data:image\/[a-z+]+;base64,/i, "").trim();
  if (!stripped) throw new Error("imageBase64 was empty");
  let buf: Buffer;
  try {
    buf = Buffer.from(stripped, "base64");
  } catch {
    throw new Error("imageBase64 was not valid base64");
  }
  if (buf.length === 0) throw new Error("imageBase64 decoded to zero bytes");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${buf.length} bytes — the cap is ${MAX_IMAGE_BYTES}`);
  }
  const match = MAGIC.find((m) => m.test(buf));
  if (!match) throw new Error("image was not a PNG, JPEG or WebP");

  const dir = mediaDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `${shortId()}.${match.ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return { mediaPath: name, bytes: buf.length };
}
