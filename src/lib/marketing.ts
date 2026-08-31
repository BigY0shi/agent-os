// MARKETING HUB — the engine behind /marketing: plan, produce, and gate campaigns
// + social content for the user's three brands (PayloadsCO, Launchworks, Cobalt).
//
// P1 scope (locked in _design/marketing-hub-blueprint.md):
//   PLAN     a campaign brief goes to a planning COUNCIL (lead plan → adversarial
//            critic → revision; toggleable in settings) → dated content calendar.
//   PRODUCE  per-item drafts by the user's CLI agents, with the brand PERSONA
//            (model-agnostic data, edited in-app) + marketing skills injected.
//   DEPLOY   approval-gated queue — NOTHING publishes without an explicit approve;
//            ANY revision of an approved item strips approval (standing rule).
//            Blog + posts are draft/export only in P1 (Ghost adapter later).
//
// Storage: ~/.agentic-os/marketing/campaigns/<slug>.json (items embedded),
//          ~/.agentic-os/marketing/personas/<id>.json (seeded on first read).
// Nothing is ever deleted — campaign removal exiles the file to .exile/<stamp>/.

import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { cliComplete, LOOP_CLI_AGENTS } from "@/lib/loopEngine";
import { withSkills } from "@/lib/platformSkills";
import { readSettings } from "@/lib/settings";
// The tolerant model-JSON parser lives in ONE place (SPEC-F K3.2) and is
// shared with the newsletter item extractor.
import { extractJsonObj } from "@/lib/v2/json";
import { colorFor } from "@/lib/v2/marketing/palette";

const MARKETING_DIR = path.join(os.homedir(), ".agentic-os", "marketing");
const CAMPAIGNS_DIR = path.join(MARKETING_DIR, "campaigns");
const PERSONAS_DIR = path.join(MARKETING_DIR, "personas");

export type Business = "payloadsco" | "launchworks" | "cobalt";
export type Channel = "youtube" | "short-video" | "text-post" | "blog";
export type ItemStatus = "idea" | "drafted" | "approved" | "scheduled" | "published";
export type CampaignStatus = "draft" | "planned" | "live" | "done";

export const BUSINESSES: { id: Business; label: string }[] = [
  { id: "payloadsco", label: "PayloadsCO" },
  { id: "launchworks", label: "Launchworks / Deal Desk" },
  { id: "cobalt", label: "Cobalt Research Supply" },
];
export const CHANNELS: { id: Channel; label: string }[] = [
  { id: "youtube", label: "YouTube (long-form)" },
  { id: "short-video", label: "Short video (LinkedIn + Shorts)" },
  { id: "text-post", label: "Text posts (LinkedIn / X / FB)" },
  { id: "blog", label: "Blog / SEO (draft-only)" },
];

export interface ContentItem {
  id: string;
  channel: Channel;
  platform?: string;      // e.g. "linkedin" | "youtube-shorts" | "x" | "facebook"
  title: string;
  brief: string;          // what this piece should do (from the plan)
  draft?: string;         // the produced content
  status: ItemStatus;
  scheduledFor?: string;  // ISO date the plan suggests
  publishedUrl?: string;
  updated?: string;
}

export interface Campaign {
  slug: string;
  title: string;
  business: Business;
  goal: string;           // what success looks like
  angle?: string;         // optional positioning angle / constraint from the user
  channels: Channel[];
  status: CampaignStatus;
  plan?: string;          // the council's campaign plan (markdown)
  items: ContentItem[];
  created: string;
  updated?: string;
  /** Stable palette colour (SPEC-F J1.1). Assigned on first read and persisted
   *  so the rollup calendar cannot reshuffle between deploys. */
  color?: string;
}

// Personas are MODEL-AGNOSTIC data (AGENTS.md rule 17): plain records injected
// verbatim into whichever agent drafts. Edited in-app, never baked into prompt code.
export interface Persona {
  id: string;             // matches Business for the three seeds
  name: string;
  business: Business;
  audience: string;
  tone: string;
  rules: string[];        // voice do's
  banned: string[];       // hard-banned phrases/patterns (humanizer: no em/en dashes)
  cta: string;            // how calls-to-action should feel
  examples?: string;      // optional short voice samples
}

// ── storage ──────────────────────────────────────────────────────────────────
async function ensureDirs() {
  await mkdir(CAMPAIGNS_DIR, { recursive: true });
  await mkdir(PERSONAS_DIR, { recursive: true });
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "campaign";
}

export async function listCampaigns(): Promise<Campaign[]> {
  await ensureDirs();
  let names: string[] = [];
  try { names = await readdir(CAMPAIGNS_DIR); } catch { return []; }
  const out: Campaign[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try { out.push(backfillColor(JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, n), "utf8")))); } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  return out;
}

export async function readCampaign(slug: string): Promise<Campaign | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let c: Campaign;
  try { c = JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, `${slug}.json`), "utf8")); } catch { return null; }
  return backfillColor(c);
}

/**
 * Give a campaign its colour the first time anyone reads it, and write it back
 * (J1.1). Persisting matters: a colour recomputed per render would reshuffle
 * the rollup calendar whenever the palette changes. Campaigns created before
 * this existed pick theirs up on next read, so no migration is needed.
 *
 * The write is fire-and-forget on purpose — a read-only filesystem should not
 * turn a page load into an error over a cosmetic field.
 */
function backfillColor(c: Campaign): Campaign {
  if (c.color) return c;
  c.color = colorFor(c.slug);
  void writeCampaign(c).catch(() => {});
  return c;
}

export async function writeCampaign(c: Campaign): Promise<void> {
  await ensureDirs();
  c.updated = new Date().toISOString();
  await writeFile(path.join(CAMPAIGNS_DIR, `${c.slug}.json`), JSON.stringify(c, null, 2), "utf8");
}

// Exile, never delete (Rule 1): the campaign file moves to .exile/<stamp>/.
export async function exileCampaign(slug: string): Promise<boolean> {
  if (!/^[a-z0-9-]+$/.test(slug)) return false;
  const src = path.join(CAMPAIGNS_DIR, `${slug}.json`);
  if (!existsSync(src)) return false;
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const dir = path.join(MARKETING_DIR, ".exile", stamp);
  await mkdir(dir, { recursive: true });
  await rename(src, path.join(dir, `${slug}.json`));
  return true;
}

// ── personas (seeded once, then fully user-owned via the in-app editor) ──────
const SEED_PERSONAS: Persona[] = [
  {
    id: "payloadsco", name: "PayloadsCO", business: "payloadsco",
    audience: "makers, hardware tinkerers and embedded/ESP32 hobbyists who buy gear they can hack",
    tone: "builder-to-builder: direct, technical but friendly, quietly confident, zero hype",
    rules: [
      "Lead with what the hardware actually does, shown not claimed",
      "Use concrete specs and real project examples over adjectives",
      "Write like a maker sharing a bench win, not a brand announcing",
    ],
    banned: ["em dashes and en dashes (use commas or periods)", "game-changer", "revolutionary", "unleash", "elevate"],
    cta: "low-pressure and specific: 'grab the board', 'see the build', never 'don't miss out'",
  },
  {
    id: "launchworks", name: "Launchworks / Deal Desk", business: "launchworks",
    audience: "owners and ops leads at small B2B companies drowning in manual work, skeptical of AI hype",
    tone: "practical operator: plain English, numbers and outcomes, honest about limits, augment-not-replace framing",
    rules: [
      "Augment the hire, never replace the human, that is the standing positioning",
      "Anchor on time and money actually saved, with the boring 40-60% automated",
      "Short sentences. No consultant-speak. Sound like someone who ships",
    ],
    banned: ["em dashes and en dashes (use commas or periods)", "synergy", "leverage (as a verb)", "AI-powered revolution", "10x your business"],
    cta: "an easy, concrete first step: 'book the 20-minute walkthrough', 'send us one workflow'",
  },
  {
    id: "cobalt", name: "Cobalt Research Supply", business: "cobalt",
    audience: "researchers, lab managers and serious home-lab buyers who value reliability and straight answers",
    tone: "precise, trustworthy, quietly expert; e-commerce clarity without retail pushiness",
    rules: [
      "Accuracy over excitement, every claim checkable",
      "Explain what it is for and who it is NOT for",
      "Stock, shipping and spec details stated plainly",
    ],
    banned: ["em dashes and en dashes (use commas or periods)", "limited time only", "act now", "best on the market"],
    cta: "informational: 'check the spec sheet', 'see current stock', never countdown pressure",
  },
];

export async function listPersonas(): Promise<Persona[]> {
  await ensureDirs();
  let names: string[] = [];
  try { names = await readdir(PERSONAS_DIR); } catch { names = []; }
  const jsons = names.filter((n) => n.endsWith(".json"));
  if (!jsons.length) {
    for (const p of SEED_PERSONAS) await writeFile(path.join(PERSONAS_DIR, `${p.id}.json`), JSON.stringify(p, null, 2), "utf8");
    return SEED_PERSONAS;
  }
  const out: Persona[] = [];
  for (const n of jsons) {
    try { out.push(JSON.parse(await readFile(path.join(PERSONAS_DIR, n), "utf8"))); } catch { /* skip corrupt */ }
  }
  return out;
}

export async function writePersona(p: Persona): Promise<void> {
  await ensureDirs();
  if (!/^[a-z0-9-]+$/.test(p.id)) throw new Error("bad persona id");
  await writeFile(path.join(PERSONAS_DIR, `${p.id}.json`), JSON.stringify(p, null, 2), "utf8");
}

export async function personaFor(business: Business): Promise<Persona | null> {
  const all = await listPersonas();
  return all.find((p) => p.business === business || p.id === business) || null;
}

// The persona as an injectable block — same text no matter which model drafts.
export function personaBlock(p: Persona | null): string {
  if (!p) return "";
  return [
    `── BRAND VOICE: ${p.name} ──`,
    `Audience: ${p.audience}`,
    `Tone: ${p.tone}`,
    `Voice rules:\n${p.rules.map((r) => `- ${r}`).join("\n")}`,
    `HARD-BANNED (never use):\n${p.banned.map((b) => `- ${b}`).join("\n")}`,
    `CTA style: ${p.cta}`,
    p.examples ? `Voice samples:\n${p.examples}` : "",
    "── END BRAND VOICE ──",
  ].filter(Boolean).join("\n");
}

// ── agent plumbing ───────────────────────────────────────────────────────────
function marketingAgent(pref?: string): string {
  const s = readSettings().marketing || {};
  const a = pref || s.agent || "claude";
  return (LOOP_CLI_AGENTS as readonly string[]).includes(a) ? a : "claude";
}

// Marketing prompts get: global skills + the marketing module skills (ecommerce-growth
// + strategic-narrative), then ride cliComplete (whose global wrap detects the header
// and skips — so module skills always win here). Claude/others take stdin, no cap.
function skilled(prompt: string): string {
  return withSkills(prompt, "marketing");
}


// ── PLAN: the campaign council ───────────────────────────────────────────────
interface PlanOut { plan: string; items: Array<{ channel: string; platform?: string; title: string; brief: string; scheduledFor?: string }> }

function planPrompt(c: Campaign, persona: Persona | null, textPlatforms: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are the CAMPAIGN PLANNER for ${persona?.name || c.business}. TODAY IS ${today}.`,
    personaBlock(persona),
    "",
    `CAMPAIGN: ${c.title}`,
    `GOAL (what success looks like): ${c.goal}`,
    c.angle ? `ANGLE / CONSTRAINTS FROM THE OWNER: ${c.angle}` : "",
    `CHANNELS IN SCOPE: ${c.channels.join(", ")}`,
    `Active text-post platforms: ${textPlatforms.join(", ")}. Short-video platforms: LinkedIn + YouTube Shorts. Blog is DRAFT-ONLY (no publishing yet).`,
    "",
    "Produce a focused 2-4 week campaign: the strategy in brief, then a dated content calendar.",
    "Fewer, better pieces beat volume. Every item must ladder up to the goal and fit the brand voice.",
    "",
    "Return ONLY a JSON object (no prose, no fences):",
    "{",
    '  "plan": "campaign strategy as tight markdown: the core message, why it works for this audience, the sequencing logic, and how we will know it worked",',
    '  "items": [ 6-14 objects, in calendar order: {',
    '     "channel": "youtube" | "short-video" | "text-post" | "blog",',
    `     "platform": for text-post one of ${JSON.stringify(textPlatforms)}; for short-video "linkedin" or "youtube-shorts"; omit otherwise,`,
    '     "title": "working title, <= 12 words",',
    '     "brief": "2-3 sentences: the job of this piece, the hook, the CTA",',
    '     "scheduledFor": "YYYY-MM-DD"',
    "  } ]",
    "}",
  ].filter(Boolean).join("\n");
}

const CRITIC_PROMPT_HEAD =
  "You are an ADVERSARIAL CAMPAIGN CRITIC. Attack this plan: weak hooks, generic content, wrong channel fit, " +
  "missing sequencing logic, off-brand voice, unrealistic cadence, anything that would make a busy audience scroll past. " +
  "Be specific and constructive. Return ONLY a bullet list of the 3-6 most important fixes (no preamble).";

// Plan a campaign. council=true (default): lead plan → critic (different agent) → revision.
export async function planCampaign(slug: string, signal?: AbortSignal): Promise<Campaign> {
  const c = await readCampaign(slug);
  if (!c) throw new Error("Campaign not found.");
  const s = readSettings().marketing || {};
  const persona = await personaFor(c.business);
  const textPlatforms = s.textPlatforms?.length ? s.textPlatforms : ["linkedin", "x", "facebook"];
  const lead = marketingAgent();

  const base = planPrompt(c, persona, textPlatforms);
  let raw = await cliComplete(lead, skilled(base), { timeoutMs: 300_000, signal });

  if (s.council !== false) {
    const critic = marketingAgent(s.criticAgent || "codex");
    try {
      const critique = await cliComplete(critic, skilled(
        `${CRITIC_PROMPT_HEAD}\n\nTHE CAMPAIGN BRIEF:\n${c.title} — ${c.goal}\nBusiness: ${persona?.name || c.business}\n\nTHE PLAN TO ATTACK:\n${raw.slice(0, 8000)}`
      ), { timeoutMs: 240_000, signal });
      raw = await cliComplete(lead, skilled(
        `${base}\n\nYOUR PREVIOUS DRAFT PLAN:\n${raw.slice(0, 8000)}\n\nAN ADVERSARIAL CRITIC RAISED THESE ISSUES — fix them, keep what already works:\n${critique.slice(0, 3000)}\n\nReturn the full corrected JSON object now.`
      ), { timeoutMs: 300_000, signal });
    } catch { /* council degraded → keep the lead plan rather than failing the whole run */ }
  }

  const parsed = extractJsonObj<PlanOut>(raw);
  if (!parsed || !parsed.plan) throw new Error("The planner returned nothing usable — try again.");
  const validChannels = new Set(c.channels);
  c.plan = String(parsed.plan).slice(0, 12_000);
  c.items = (Array.isArray(parsed.items) ? parsed.items : [])
    .filter((it) => it && it.title && validChannels.has(it.channel as Channel))
    .slice(0, 20)
    .map((it, i) => ({
      id: `${c.slug}-${Date.now().toString(36)}-${i}`,
      channel: it.channel as Channel,
      platform: it.platform ? String(it.platform).slice(0, 30) : undefined,
      title: String(it.title).slice(0, 140),
      brief: String(it.brief || "").slice(0, 600),
      status: "idea" as ItemStatus,
      scheduledFor: /^\d{4}-\d{2}-\d{2}$/.test(String(it.scheduledFor || "")) ? it.scheduledFor : undefined,
    }));
  c.status = "planned";
  await writeCampaign(c);
  return c;
}

// ── PRODUCE: persona-injected drafting per channel ───────────────────────────
const FORMAT_GUIDES: Record<Channel, string> = {
  "youtube": "Deliverable: a YouTube video PACKAGE as markdown — ## Title options (3), ## Hook (first 15 seconds, word-for-word), ## Outline (timestamped beats), ## Description (with keywords, no hashtag spam), ## Tags (10).",
  "short-video": "Deliverable: a short-video SCRIPT PACKAGE as markdown — ## Hook (first 2 seconds), ## Script (30-45s, one line per beat, spoken language), ## On-screen text cues, ## Caption (platform-native), ## Title.",
  "text-post": "Deliverable: the FINAL POST TEXT, platform-native. LinkedIn: strong first line (it gets truncated), short paragraphs, no hashtag walls (max 3). X: punchy, line breaks, no hashtags. Facebook: conversational, first line earns the click. Output ONLY the post text.",
  "blog": "Deliverable: a complete blog ARTICLE DRAFT as markdown — # Title, meta description (<=155 chars) as a blockquote, then the full article with ## sections, written for humans first with natural keyword use. This is draft-only; no publishing.",
};

export async function draftItem(slug: string, itemId: string, agentPref?: string, feedback?: string, signal?: AbortSignal): Promise<Campaign> {
  const c = await readCampaign(slug);
  if (!c) throw new Error("Campaign not found.");
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item not found.");
  const persona = await personaFor(c.business);
  const agent = marketingAgent(agentPref);

  const prompt = [
    `You are writing marketing content for ${persona?.name || c.business}.`,
    personaBlock(persona),
    "",
    `CAMPAIGN: ${c.title} — goal: ${c.goal}`,
    c.plan ? `CAMPAIGN PLAN (context):\n${c.plan.slice(0, 2500)}` : "",
    "",
    `THE PIECE: [${item.channel}${item.platform ? ` · ${item.platform}` : ""}] ${item.title}`,
    `ITS JOB: ${item.brief}`,
    FORMAT_GUIDES[item.channel],
    item.draft && feedback ? `\nYOUR PREVIOUS DRAFT:\n${item.draft.slice(0, 6000)}\n\nTHE OWNER'S REQUESTED CHANGES — apply them, keep what works:\n${feedback.slice(0, 1500)}` : "",
    "",
    "Follow the brand voice exactly, especially the HARD-BANNED list. Output ONLY the deliverable — no preamble, no commentary.",
  ].filter(Boolean).join("\n");

  const out = (await cliComplete(agent, skilled(prompt), { timeoutMs: 300_000, signal })).trim();
  if (!out) throw new Error(`${agent} returned an empty draft.`);
  item.draft = out.slice(0, 40_000);
  // Standing rule: ANY new draft/revision strips approval — back through the gate.
  item.status = "drafted";
  item.updated = new Date().toISOString();
  await writeCampaign(c);
  return c;
}

// ── DEPLOY gate: approvals + manual publish marking (P1 has no auto-publish) ─
export async function setItemStatus(slug: string, itemId: string, action: "approve" | "unapprove" | "schedule" | "published" | "edit", extra?: { draft?: string; publishedUrl?: string; scheduledFor?: string }): Promise<Campaign> {
  const c = await readCampaign(slug);
  if (!c) throw new Error("Campaign not found.");
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item not found.");

  if (action === "approve") {
    if (!item.draft) throw new Error("Nothing to approve — draft it first.");
    item.status = item.scheduledFor ? "scheduled" : "approved";
  } else if (action === "unapprove") {
    item.status = item.draft ? "drafted" : "idea";
  } else if (action === "schedule") {
    if (extra?.scheduledFor && /^\d{4}-\d{2}-\d{2}$/.test(extra.scheduledFor)) item.scheduledFor = extra.scheduledFor;
  } else if (action === "published") {
    if (item.status !== "approved" && item.status !== "scheduled") throw new Error("Only approved items can be marked published.");
    item.status = "published";
    if (extra?.publishedUrl) item.publishedUrl = String(extra.publishedUrl).slice(0, 400);
    if (c.items.every((i) => i.status === "published")) c.status = "done";
    else c.status = "live";
  } else if (action === "edit") {
    // A manual edit is a revision: the standing rule strips approval.
    if (typeof extra?.draft === "string") { item.draft = extra.draft.slice(0, 40_000); item.status = "drafted"; }
  }
  item.updated = new Date().toISOString();
  await writeCampaign(c);
  return c;
}

// Everything waiting on the human gate, across all campaigns (newest first).
export async function approvalQueue(): Promise<Array<{ campaign: string; slug: string; business: Business; item: ContentItem }>> {
  const cs = await listCampaigns();
  const out: Array<{ campaign: string; slug: string; business: Business; item: ContentItem }> = [];
  for (const c of cs) for (const it of c.items) {
    if (it.status === "drafted") out.push({ campaign: c.title, slug: c.slug, business: c.business, item: it });
  }
  out.sort((a, b) => (b.item.updated || "").localeCompare(a.item.updated || ""));
  return out;
}
