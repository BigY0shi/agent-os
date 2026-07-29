// Brainstorm Council — a three-seat ideation panel: Claude (CLI), ChatGPT (codex
// CLI), and the newest Kimi chat model on Ollama Cloud. The user brings a topic,
// idea, or goal; the council diverges (independent concepts), critiques
// (cross-examines each other's proposals), and the chair (Claude) synthesises a
// workable project brief. Follow-up messages run steer rounds against the same
// session.
//
// Deliberately self-contained: no vault grounding, no MiniMax, no OpenRouter.
// Claude/codex ride the user's own CLI subscriptions via cliComplete(); Kimi is
// the one HTTP call (Ollama Cloud), resolved live from /api/tags against the
// user's model policy (kimi-k2.6 for chat/agentic; settings-overridable).

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cliComplete } from "./loopEngine";

export type CouncilSeat = "claude" | "codex" | "kimi";
export const COUNCIL_SEATS: CouncilSeat[] = ["claude", "codex", "kimi"];

export interface CouncilMsg {
  agent: CouncilSeat | "user" | "chair";
  /** diverge | critique | steer | brief | user */
  phase: string;
  text: string;
  ts: number;
}

export interface BrainstormSession {
  id: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  msgs: CouncilMsg[];
  /** The latest synthesised project brief — the council's working output. */
  brief: string | null;
  /** Which model actually filled the Kimi seat (resolved live). */
  kimiModel?: string;
}

const DIR = path.join(os.homedir(), ".agentic-os", "brainstorm");

async function ensureDir() { await mkdir(DIR, { recursive: true }).catch(() => {}); }

export async function loadSession(id: string): Promise<BrainstormSession | null> {
  try { return JSON.parse(await readFile(path.join(DIR, `${id}.json`), "utf8")) as BrainstormSession; }
  catch { return null; }
}

export async function saveSession(s: BrainstormSession): Promise<void> {
  await ensureDir();
  s.updatedAt = Date.now();
  s.msgs = s.msgs.slice(-200);
  await writeFile(path.join(DIR, `${s.id}.json`), JSON.stringify(s, null, 1), "utf8");
}

export async function listSessions(): Promise<Pick<BrainstormSession, "id" | "topic" | "createdAt" | "updatedAt" | "brief">[]> {
  await ensureDir();
  const out: BrainstormSession[] = [];
  for (const f of (await readdir(DIR).catch(() => [] as string[]))) {
    if (!f.endsWith(".json")) continue;
    const s = await loadSession(f.slice(0, -5));
    if (s) out.push(s);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, 60).map(({ id, topic, createdAt, updatedAt, brief }) => ({ id, topic, createdAt, updatedAt, brief }));
}

// ── Kimi seat (Ollama Cloud) ────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_CLOUD_HOST || "https://ollama.com";
function ollamaKey(): string | null {
  return process.env.OLLAMA_API_KEY || process.env.OLLAMA_CLOUD_KEY || null;
}

let kimiCache: { key: string; model: string; at: number } | null = null;

/**
 * Resolve the Kimi seat's model on Ollama Cloud, honouring the user's model
 * policy (2026-07-28 correction): chat/agentic work rides Kimi K2.6, coding
 * rides K2.7 Code — NOT a "newest kimi" guess (the old k3-first preference
 * grabbed kimi-k3 the moment it shipped, which was wrong).
 *
 * `preferred` (from each module's settings menu) wins when it matches an
 * available tag; otherwise fall back k2.6 → other k2.x chat → any non-code kimi.
 */
export async function resolveKimiModel(preferred?: string): Promise<string> {
  const cacheKey = preferred || "_default";
  if (kimiCache && kimiCache.key === cacheKey && Date.now() - kimiCache.at < 10 * 60_000) return kimiCache.model;
  const key = ollamaKey();
  if (!key) throw new Error("No Ollama Cloud key (set OLLAMA_API_KEY in .env.local)");
  const r = await fetch(`${OLLAMA_HOST}/api/tags`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Ollama Cloud /api/tags ${r.status}`);
  const j = await r.json() as { models?: { name?: string; model?: string }[] };
  const names = (j.models || []).map((m) => m.model || m.name || "").filter(Boolean);

  if (preferred?.trim()) {
    const want = preferred.trim().toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === want) ?? names.find((n) => n.toLowerCase().startsWith(want));
    if (hit) { kimiCache = { key: cacheKey, model: hit, at: Date.now() }; return hit; }
    // A configured model that doesn't exist should be loud, not silently swapped.
    throw new Error(`Configured Kimi model "${preferred}" not found on Ollama Cloud`);
  }

  const prefs = [/kimi[-\s]?k?2\.6/i, /kimi[-\s]?k?2\.\d+(?!.*code)/i, /kimi(?!.*code)/i, /kimi/i];
  for (const re of prefs) {
    const hit = names.find((n) => re.test(n));
    if (hit) { kimiCache = { key: cacheKey, model: hit, at: Date.now() }; return hit; }
  }
  throw new Error("No Kimi model found on Ollama Cloud");
}

async function kimiComplete(prompt: string, model: string): Promise<string> {
  const key = ollamaKey();
  if (!key) throw new Error("No Ollama Cloud key");
  const r = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, stream: false, think: false,
      messages: [{ role: "user", content: prompt }],
      options: { num_predict: 1000 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama Cloud chat ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json() as { message?: { content?: string } };
  const text = j.message?.content?.trim();
  if (!text) throw new Error("Kimi returned nothing");
  return text;
}

// ── Seat dispatch ───────────────────────────────────────────────────────────────

export async function seatComplete(seat: CouncilSeat, prompt: string, kimiModel: string): Promise<string> {
  if (seat === "kimi") return kimiComplete(prompt, kimiModel);
  // claude + codex go through the shared CLI helper (subscription auth, no keys).
  const text = await cliComplete(seat, prompt, { timeoutMs: 240_000 });
  const t = text.trim();
  if (!t) throw new Error(`${seat} returned nothing`);
  return t;
}

// ── Prompts ─────────────────────────────────────────────────────────────────────

const VOICE: Record<CouncilSeat, string> = {
  claude: "You favour depth: second-order effects, what makes an idea durable, where the real leverage is.",
  codex: "You favour execution: what ships fastest, what the MVP is, what to cut. Be concrete about tooling and effort.",
  kimi: "You favour the contrarian angle: the overlooked market, the weird combination, the assumption everyone else missed.",
};

export function divergePrompt(seat: CouncilSeat, topic: string): string {
  return (
    "You are one seat on a three-model brainstorming council (Claude, ChatGPT, Kimi). " +
    VOICE[seat] + "\n\n" +
    `The operator's input (topic / idea / goal):\n${topic}\n\n` +
    "Independently propose exactly 3 distinct, workable project concepts that develop this input. For each: a name, " +
    "2-3 sentences on what it is, one sentence on why it could win, and the biggest risk. " +
    "Number them 1-3. Plain text, no markdown headers, under 250 words total. Do not hedge with 'it depends'."
  );
}

export function critiquePrompt(seat: CouncilSeat, topic: string, proposals: { seat: CouncilSeat; text: string }[]): string {
  const others = proposals.map((p) => `── ${p.seat.toUpperCase()} proposed ──\n${p.text}`).join("\n\n");
  return (
    "You are one seat on a three-model brainstorming council. " + VOICE[seat] + "\n\n" +
    `Operator's input: ${topic}\n\nAll proposals on the table (including your own):\n\n${others}\n\n` +
    "Now converge: name the single strongest concept on the table (yours or not), say in 2-3 sentences why it beats the rest, " +
    "give your sharpest criticism of it, and propose one concrete improvement that fixes that criticism. " +
    "Plain text, under 150 words. Be direct — politeness wastes the operator's time."
  );
}

export function synthesisPrompt(topic: string, critiques: { seat: CouncilSeat; text: string }[]): string {
  const c = critiques.map((p) => `── ${p.seat.toUpperCase()} ──\n${p.text}`).join("\n\n");
  return (
    "You chair a three-model brainstorming council. The diverge and critique rounds are done; your job is the synthesis " +
    "the operator will actually act on.\n\n" +
    `Operator's input: ${topic}\n\nThe council's convergence round:\n\n${c}\n\n` +
    "Write the working project brief. Use EXACTLY these plain-text section labels, each on its own line followed by content:\n" +
    "CONCEPT: (2-3 sentences — the chosen idea, sharpened)\n" +
    "WHY IT WORKS: (2-3 sentences)\n" +
    "MVP SCOPE: (3-5 short bullet lines, each starting with '- ')\n" +
    "BUILD PLAN: (numbered steps, one line each, max 6)\n" +
    "RISKS: (2-3 bullet lines)\n" +
    "FIRST ACTION: (one sentence — what the operator should do today)\n" +
    "Under 350 words. Take the council's best thinking; where they disagreed, decide."
  );
}

export function steerPrompt(seat: CouncilSeat, session: BrainstormSession, message: string): string {
  const recent = session.msgs.slice(-8).filter((m) => m.agent === "user" || m.agent === "chair")
    .map((m) => `${m.agent === "user" ? "OPERATOR" : "CHAIR"}: ${m.text.slice(0, 600)}`).join("\n\n");
  return (
    "You are one seat on a three-model brainstorming council mid-session. " + VOICE[seat] + "\n\n" +
    `Original input: ${session.topic}\n\n` +
    (session.brief ? `Current working brief:\n${session.brief.slice(0, 1500)}\n\n` : "") +
    (recent ? `Recent exchange:\n${recent}\n\n` : "") +
    `The operator now says:\n${message}\n\n` +
    "Respond to the operator's steer directly: how it changes (or shouldn't change) the working concept, and your concrete recommendation. " +
    "Plain text, under 140 words."
  );
}

export function resynthesisPrompt(session: BrainstormSession, message: string, replies: { seat: CouncilSeat; text: string }[]): string {
  const r = replies.map((p) => `── ${p.seat.toUpperCase()} ──\n${p.text}`).join("\n\n");
  return (
    "You chair a three-model brainstorming council mid-session.\n\n" +
    `Original input: ${session.topic}\n\n` +
    (session.brief ? `Current working brief:\n${session.brief}\n\n` : "") +
    `The operator's new steer:\n${message}\n\nThe council's responses:\n\n${r}\n\n` +
    "Rewrite the working project brief incorporating the steer and the council's best points. Same format as before — " +
    "CONCEPT / WHY IT WORKS / MVP SCOPE / BUILD PLAN / RISKS / FIRST ACTION, plain text, under 350 words."
  );
}
