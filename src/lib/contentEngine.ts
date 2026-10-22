// Content Engine — plan a posting calendar, generate the materials for each slot,
// then track how posts actually performed and let the AI read the numbers.
//
// Three loops, one state file (~/.agentic-os/content-engine/state.json):
//   PLAN     — goals + channels + cadence → Claude drafts a dated calendar.
//   GENERATE — per item: post copy, hashtags, image prompt, script when video.
//   MONITOR  — the operator logs real metrics per posted item (no platform OAuth
//              exists in this stack — honest manual entry beats fake telemetry),
//              and an insights pass reads the corpus and says what to double down on.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Types + CHANNELS live in contentEngineTypes.ts (client-safe — the component
// imports the value; this module's node:fs must not reach the client bundle).
import type { Channel, ContentItem, EngineState } from "./contentEngineTypes";
export { CHANNELS } from "./contentEngineTypes";
export type { Channel, ContentItem, EngineState, ItemStatus, Metrics, Materials } from "./contentEngineTypes";
import { seatComplete, type CouncilSeat, type SeatOpts } from "./brainstorm";

// ── Multi-model mandate (per /multi-agent-mcp-orchestration) ────────────────────
// Claude is the MANAGER (plans the calendar, owns the merge) but must not be the
// only model working. Generation rotates across lineages per item — codex
// (OpenAI) → kimi (Ollama Cloud) → claude (Anthropic) — and insights run on
// codex so the model grading the content is never the one that planned it.
// A failed seat falls back to Claude and the artifact records who actually made it.

const GEN_ROTATION: CouncilSeat[] = ["codex", "kimi", "claude"];

/** Stable seat per item — hash of the id, so regenerate hits the same seat. */
export function seatForItem(id: string): CouncilSeat {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GEN_ROTATION[h % GEN_ROTATION.length];
}

/**
 * Run a prompt on the preferred seat, falling back to Claude if it fails.
 * Returns the text and which seat ACTUALLY answered — never claim codex wrote
 * something Claude had to rescue.
 */
export async function multiModelComplete(
  preferred: CouncilSeat,
  prompt: string,
  opts: SeatOpts & {
    /** Launch guardrail "No fallback to Claude" (S3): a failed seat fails the run. */
    noFallback?: boolean;
  } = {},
): Promise<{ text: string; by: CouncilSeat }> {
  // The Kimi seat honours the Content Engine's own settings dial (default
  // kimi-k2.6 — chat/agentic tier per the user's model policy).
  const { resolveKimiModel } = await import("./brainstorm");
  const { readSettings } = await import("./settings");
  const seatOpts: SeatOpts = { signal: opts.signal, timeoutMs: opts.timeoutMs };
  try {
    const kimiModel = preferred === "kimi" ? await resolveKimiModel(readSettings().contentEngine.kimiModel) : "";
    const text = await seatComplete(preferred, prompt, kimiModel, seatOpts);
    return { text, by: preferred };
  } catch (e) {
    // STOP is never something to recover from: the owner ended the run.
    if (opts.signal?.aborted) throw e;
    if (preferred === "claude") throw new Error(`claude seat failed: ${(e as Error).message}`);
    if (opts.noFallback) throw new Error(`${preferred} seat failed and the launch said no fallback: ${(e as Error).message}`);
    const text = await seatComplete("claude", prompt, "", seatOpts);
    return { text, by: "claude" };
  }
}

const DIR = path.join(os.homedir(), ".agentic-os", "content-engine");
const FILE = path.join(DIR, "state.json");

export async function readEngine(): Promise<EngineState> {
  try { return JSON.parse(await readFile(FILE, "utf8")) as EngineState; }
  catch { return { plan: null, items: [], insights: null }; }
}

export async function writeEngine(s: EngineState): Promise<void> {
  await mkdir(DIR, { recursive: true }).catch(() => {});
  await writeFile(FILE, JSON.stringify(s, null, 1), "utf8");
}

export async function patchItem(id: string, fn: (it: ContentItem) => ContentItem): Promise<ContentItem | null> {
  const s = await readEngine();
  const i = s.items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  s.items[i] = { ...fn(s.items[i]), updatedAt: Date.now() };
  await writeEngine(s);
  return s.items[i];
}

// ── Prompts ─────────────────────────────────────────────────────────────────────

export function planPrompt(goals: string, channels: Channel[], perWeek: number, weeks: number, startISO: string): string {
  return (
    "You are the content strategist for a solo operator (RevOps / automation consultant who builds AI machines and self-hosts a homelab). " +
    "Design a posting calendar.\n\n" +
    `GOALS / NICHE (their words): ${goals}\n` +
    `CHANNELS: ${channels.join(", ")}\n` +
    `CADENCE: about ${perWeek} posts per week across all channels, for ${weeks} weeks, starting ${startISO}.\n\n` +
    "Rules: vary formats per channel (thread/post/article/short/carousel as fits the channel), sequence topics so they build on " +
    "each other, no two posts on the same channel on the same day, every post has a sharp hook (the first line that stops the scroll). " +
    "Dates must be real ISO dates within the window, spread sensibly (not all on Monday).\n\n" +
    "Return ONLY a minified JSON array, no prose, no code fences. Each element EXACTLY:\n" +
    '{"date":"yyyy-mm-dd","channel":"one of the listed channels","format":"...","topic":"...","hook":"..."}'
  );
}

export function materialsPrompt(item: ContentItem, goals: string): string {
  const isVideo = /video|short|reel|youtube|tiktok/i.test(item.format + " " + item.channel);
  return (
    "You write content for a solo operator (RevOps / automation consultant, builds AI machines, runs a homelab). " +
    "Voice: plain, direct, first-person, zero hype, no em dashes, no 'game-changer'. Write like a practitioner, not a marketer.\n\n" +
    `THEIR GOALS: ${goals}\n` +
    `THE SLOT: ${item.channel} · ${item.format} · planned ${item.date}\n` +
    `TOPIC: ${item.topic}\nHOOK: ${item.hook}\n\n` +
    "Return ONLY minified JSON, no code fences, with EXACTLY these keys:\n" +
    '{"copy":"...","hashtags":"...","imagePrompt":"..."' + (isVideo ? ',"videoScript":"..."' : "") + "}\n\n" +
    "copy        — the actual post, sized for the channel (thread = numbered tweets separated by newlines; article = full draft with plain-text section breaks; post = ready to paste).\n" +
    "hashtags    — 3-6, space-separated, only ones that pull discovery on that channel. Empty string if the channel doesn't reward them.\n" +
    "imagePrompt — one sentence a thumbnail/image model could run with. Empty string if the post needs no visual.\n" +
    (isVideo ? "videoScript — a tight shooting script: HOOK / BEATS (numbered) / CTA, with rough timings.\n" : "")
  );
}

export function insightsPrompt(state: EngineState): string {
  const posted = state.items.filter((i) => i.status === "posted" && i.metrics);
  const rows = posted.map((i) =>
    `${i.date} · ${i.channel} · ${i.format} · "${i.topic}" → views:${i.metrics?.views ?? "?"} likes:${i.metrics?.likes ?? "?"} comments:${i.metrics?.comments ?? "?"} shares:${i.metrics?.shares ?? "?"} clicks:${i.metrics?.clicks ?? "?"}`
  ).join("\n");
  const unposted = state.items.filter((i) => i.status !== "posted" && i.status !== "skipped").length;
  return (
    "You are the analyst for a solo operator's content program. Read the performance log and tell them what is actually working.\n\n" +
    `GOALS: ${state.plan?.goals ?? "?"}\n\nPOSTED WITH METRICS (${posted.length}):\n${rows || "none yet"}\n\n` +
    `Still in the pipeline: ${unposted} items.\n\n` +
    "Return plain text, under 250 words, with EXACTLY these section labels on their own lines:\n" +
    "WORKING: (which channels/formats/topics over-performed, with the numbers)\n" +
    "NOT WORKING: (what under-performed and your best guess why)\n" +
    "DOUBLE DOWN: (2-3 concrete next posts to make based on the data)\n" +
    "CHANGE: (one thing to do differently in the next planning cycle)\n" +
    "If there is too little data to say, state that plainly instead of inventing patterns."
  );
}
