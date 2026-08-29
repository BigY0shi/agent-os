// SPEC-F K3.2 (first half) — email HTML → markdown → extracted items.
//
// Two stages, deliberately separable:
//   htmlToMarkdown()  deterministic, offline, no model involved
//   extractItems()    provider-routed through cliComplete (rule 11: the chosen
//                     agent runs or the call FAILS — there is no silent
//                     fallback to a local model)
//
// NEWSLETTER_STUB_PARSE=1 swaps the model for a deterministic markdown-link
// extractor. That is what the smoke runs: it keeps the test model-independent
// AND still exercises the real dedupe ladder with real URLs. It is a test seam,
// never a production fallback — with the env unset, a missing agent throws.
//
// Turndown note: the OPTIONS match the gmail connector's config (SPEC-F §4
// "copied as-is"), but the post-processing deliberately does NOT. The connector
// flattens whitespace to a single line (fine for a 200-char activity snippet);
// a newsletter needs its line structure intact or every item runs together.

import TurndownService from "turndown";
import { cliComplete } from "../../loopEngine";
import { readSettings } from "../../settings";
import { extractJsonObj } from "../json";
import type { ExtractedItem, NewsletterEmail } from "./types";

/** Max items we accept from one email (SPEC-F K3.2). */
export const MAX_ITEMS_PER_EMAIL = 15;
/** How much of the email body the extraction prompt carries. */
const PROMPT_BODY_CHARS = 24_000;
/** Wall clock for one extraction. */
const EXTRACT_TIMEOUT_MS = 180_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["style", "script", "noscript", "iframe", "object", "embed"]);

/** Lines that are pure newsletter chrome, dropped before the model sees them. */
const BOILERPLATE_RE =
  /^(unsubscribe|update your preferences|view (this|in) (email )?in (your )?browser|manage your subscription|you('re| are) receiving this|sent to |copyright ©|©\s*\d{4}|all rights reserved|privacy policy|forwarded this email)/i;

/**
 * Strip newsletter chrome from converted markdown: tracking-pixel image lines,
 * long rulers, unsubscribe/preferences footers, and runs of blank lines.
 * Deterministic — no model, no network.
 */
export function stripBoilerplate(md: string): string {
  const kept: string[] = [];
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const probe = line.trim().replace(/^[*_>\-\s]+/, "");
    if (BOILERPLATE_RE.test(probe)) continue;
    // Bare tracking-pixel / spacer images.
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line.trim()) && line.length < 200 && /\b(open|pixel|track|spacer|beacon)\b/i.test(line)) {
      continue;
    }
    if (/^[-=_*]{4,}$/.test(line.trim())) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Email HTML (or plain text) → markdown, boilerplate stripped. */
export function htmlToMarkdown(html: string, text = ""): string {
  if (html && html.trim()) {
    let md: string;
    try {
      md = turndown.turndown(html);
    } catch (err) {
      // A turndown failure is a PER-MESSAGE parse failure, surfaced by the
      // caller as parse_status='failed' — not a batch abort.
      throw new Error(
        `HTML→markdown failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return stripBoilerplate(md);
  }
  return stripBoilerplate(text.replace(/\r/g, ""));
}

// ── item extraction ──────────────────────────────────────────────────────────

export function parseAgent(): string {
  const configured = readSettings().newsletter?.parseAgent;
  return typeof configured === "string" && configured.trim() ? configured.trim() : "claude";
}

export function stubParseEnabled(): boolean {
  return process.env.NEWSLETTER_STUB_PARSE === "1";
}

/**
 * The deterministic extractor behind NEWSLETTER_STUB_PARSE=1: every markdown
 * link on its own becomes an item, the rest of that line becomes the summary.
 * Real structure, real URLs, zero model.
 */
export function stubExtractItems(contentMd: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  const linkRe = /\[([^\]]{3,200})\]\((https?:\/\/[^\s)]+)\)/g;
  for (const line of contentMd.split(/\r?\n/)) {
    linkRe.lastIndex = 0;
    const m = linkRe.exec(line);
    if (!m) continue;
    const title = m[1].trim();
    const url = m[2].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    const summary = line
      .replace(m[0], "")
      .replace(/^[\s\-*—–:.]+/, "")
      .trim();
    items.push({ title, url, summary });
    if (items.length >= MAX_ITEMS_PER_EMAIL) break;
  }
  return items;
}

function extractionPrompt(email: NewsletterEmail): string {
  return [
    "You are extracting the individual STORIES from one newsletter email.",
    "",
    `SUBJECT: ${email.subject ?? "(no subject)"}`,
    `FROM: ${email.fromAddr ?? "(unknown sender)"}`,
    "",
    "EMAIL BODY (markdown):",
    "---",
    email.contentMd.slice(0, PROMPT_BODY_CHARS),
    "---",
    "",
    `Return ONLY a JSON object (no prose, no fences), at most ${MAX_ITEMS_PER_EMAIL} items:`,
    '{ "items": [ { "title": "the story headline as the newsletter wrote it",',
    '              "url": "the link for that story, omitted entirely when there is none",',
    '              "summary": "1-2 sentences, in your own words, of what the story says" } ] }',
    "",
    "Rules:",
    "- One entry per distinct STORY. Sponsor slots, housekeeping, and the newsletter's own",
    "  self-promotion are NOT stories — leave them out.",
    "- Never invent a URL. If a story has no link, omit the url field.",
    "- Never invent a story that is not in the body.",
    "- If the email contains no stories at all, return { \"items\": [] }.",
  ].join("\n");
}

/**
 * Extract the stories in one email.
 *
 * Throws on a provider failure or an unparseable response — the caller records
 * that on the email row (`parse_status='failed'` + `parse_error`) and moves to
 * the next message. Per SPEC-F §4's error split: external/model failures are
 * SOFT per message, config failures are LOUD.
 */
export async function extractItems(email: NewsletterEmail): Promise<ExtractedItem[]> {
  const body = email.contentMd.trim();
  if (!body) return [];

  if (stubParseEnabled()) return stubExtractItems(body);

  const agent = parseAgent();
  const raw = await cliComplete(agent, extractionPrompt(email), {
    timeoutMs: EXTRACT_TIMEOUT_MS,
  });
  const parsed = extractJsonObj<{ items?: unknown }>(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(
      `item extraction via '${agent}' returned no parseable JSON object (got ${raw.length} chars)`,
    );
  }
  return normalizeItems(parsed.items);
}

/** Validate + clamp whatever the model returned. Junk entries are dropped. */
export function normalizeItems(raw: unknown[]): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;
    const url = typeof e.url === "string" && /^https?:\/\//i.test(e.url.trim()) ? e.url.trim() : undefined;
    const summary = typeof e.summary === "string" ? e.summary.trim() : "";
    out.push({ title: title.slice(0, 400), ...(url ? { url } : {}), summary: summary.slice(0, 2000) });
    if (out.length >= MAX_ITEMS_PER_EMAIL) break;
  }
  return out;
}
