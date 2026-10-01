// Agent Room — a live group chat where each agent is its OWN real model + persona.
// Cloud agents run through the shared OpenRouter key (from the active Hermes
// profile); Free Claude Code runs locally on Ollama ($0). A round is sequential:
// each agent sees what was said before it, so they actually talk to each other.

import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { exileFile } from "@/lib/exileFile";
import path from "node:path";
import os from "node:os";
import { searchNotes, recentNotes, searchOmi, readNote, VAULT_AVAILABLE } from "@/lib/vault";
import { AGENTIC_DIR } from "@/lib/vaultWriter";
import { uniqueSlug, writeItem, type PipelineItem } from "@/lib/pipeline";
import { config, isAgentInstalled } from "@/lib/config";
import { cliComplete, LOOP_CLI_AGENTS } from "@/lib/loopEngine";
import { personaPrompt, type Persona } from "@/lib/personas";
import { ollamaCloudDefaultModel, ollamaCloudHost, ollamaCloudKey } from "@/lib/ollamaCloud";

const HOME = os.homedir();
// Ollama Cloud is reached DIRECTLY over the hosted API (same as /api/ollama/chat) —
// no local daemon required. The room used to post to localhost:11434, so whenever the
// local daemon wasn't running (the normal case here) every Ollama agent failed.
// There is no local daemon on this machine (owner, 2026-09-30), so there is no localhost
// fallback: with no cloud key an Ollama agent fails and says so. Key and host come from
// settings.ollama (the Ollama page's gear), then the environment (lib/ollamaCloud.ts).

// ── Durable group-chat history — saved to the vault so it survives browser clears
// and shows on any device (localStorage in the browser is only a fast cache). ──
const CONVOS_DIR = AGENTIC_DIR ? path.join(AGENTIC_DIR, "Agent Room", "conversations") : "";
export interface RoomMsg { key: number; who: string; name?: string; color?: string; text: string; kind?: string }
export interface RoomConvo { id: string; title: string; ts: number; msgs: RoomMsg[] }
const safeConvoId = (id: string) => String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

export async function saveConversation(convo: RoomConvo): Promise<boolean> {
  if (!CONVOS_DIR) return false;
  const id = safeConvoId(convo?.id || "");
  if (!id || !Array.isArray(convo.msgs) || convo.msgs.length === 0) return false;
  try {
    if (!existsSync(CONVOS_DIR)) await mkdir(CONVOS_DIR, { recursive: true });
    const clean: RoomConvo = { id, title: String(convo.title || "Chat").slice(0, 120), ts: Number(convo.ts) || Date.now(), msgs: convo.msgs.slice(0, 400) };
    await writeFile(path.join(CONVOS_DIR, `${id}.json`), JSON.stringify(clean), "utf8");
    return true;
  } catch { return false; }
}

export async function listConversations(): Promise<RoomConvo[]> {
  if (!CONVOS_DIR || !existsSync(CONVOS_DIR)) return [];
  try {
    const files = (await readdir(CONVOS_DIR)).filter((f) => f.endsWith(".json"));
    const convos: RoomConvo[] = [];
    for (const f of files) {
      try { const c = JSON.parse(await readFile(path.join(CONVOS_DIR, f), "utf8")); if (c?.id && Array.isArray(c.msgs)) convos.push(c); } catch { /* skip bad file */ }
    }
    return convos.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 80);
  } catch { return []; }
}

export async function deleteConversation(id: string): Promise<boolean> {
  if (!CONVOS_DIR) return false;
  // Exiled, never deleted: the thread moves to <convos>/.exile/<stamp>/.
  try { return !!(await exileFile(path.join(CONVOS_DIR, `${safeConvoId(id)}.json`), CONVOS_DIR)); } catch { return false; }
}

export interface RoomAgent {
  id: string; name: string; color: string;
  // No "openrouter": provider routing is CLI / Ollama Cloud / an explicit OpenAI-compatible
  // endpoint only (owner, 2026-09-29). A config override naming openrouter is ignored.
  provider: "ollama" | "openai" | "cli";
  model: string;
  persona: string;
  noReasoning?: boolean;  // snappy chat agents (GLM 5.2) skip chain-of-thought so a short reply is never starved
  baseUrl?: string;       // provider:"openai" → any OpenAI-compatible endpoint (z.ai, Sakana, a local server…)
  apiKeyEnv?: string;     // provider:"openai" → env var (or active Hermes profile .env key) holding the API key
}

// Each agent is authentically itself. The CLI agents run on the user's real CLI
// subscriptions (no API key); openclaw/ollama/fcc run on Ollama Cloud.
export const ROOM_AGENTS: RoomAgent[] = [
  { id: "claude", name: "Claude", color: "#d97757", provider: "cli", model: "",
    persona: "You are Claude — thoughtful, careful, balanced. You weigh trade-offs, bring nuance, and give a calm, precise take. You gently flag risks others miss." },
  { id: "codex", name: "Codex", color: "#22c55e", provider: "cli", model: "",
    persona: "You are Codex — OpenAI's coding agent. Pragmatic, implementation-first. You think in systems and concrete steps, and you sketch the how." },
  { id: "cursor", name: "Cursor", color: "#cbd5e1", provider: "cli", model: "",
    persona: "You are Cursor — a fast, pragmatic coding agent. You think in concrete edits and working code, and you push for the simplest thing that ships." },
  { id: "pi", name: "Pi", color: "#fbbf24", provider: "cli", model: "",
    persona: "You are Pi — a sharp, lightweight coding assistant on open models. Resourceful and direct; you favour clean, minimal solutions." },
  { id: "hermes", name: "Hermes", color: "#60a5fa", provider: "cli", model: "",
    persona: "You are Hermes — direct, action-oriented, a little unfiltered. You cut straight to the practical next step and call out fluff. You like momentum." },
  // Antigravity runs on the real `agy` CLI (native exe; verified one-shot here).
  // NOTE: its previous model, "gemini-3-flash-preview", IS a real Ollama model
  // (ollama.com/library/gemini-3-flash-preview) — the breakage was the localhost:11434
  // routing, not the tag. Kept on the CLI because it needs no API key, is verified
  // working, and is genuinely Antigravity rather than the underlying Google model.
  // To go back: provider:"ollama", model:"gemini-3-flash-preview" (now that the
  // Ollama path points at the cloud API, that would work too).
  { id: "antigravity", name: "Antigravity", color: "#7c3aed", provider: "cli", model: "",
    persona: "You are Antigravity — Gemini's successor as a multi-agent harness. Broad knowledge, research-minded, a bit cosmic; you bring data and a wide-angle view." },
  // OpenClaw was provider:"openrouter", which needs a key that isn't valid here — it
  // errored every turn too. Routed to Ollama Cloud, which suits its open-model character.
  { id: "openclaw", name: "OpenClaw", color: "#f472b6", provider: "ollama", model: "auto",
    persona: "You are OpenClaw — open-source, bold, a little cheeky. You challenge assumptions and champion the scrappy, independent path." },
  { id: "ollama", name: "Ollama", color: "#6CA8FF", provider: "ollama", model: "auto",
    persona: "You are Ollama — open models running on the user's own machine/cloud. Private, free, no-nonsense; you champion the local-first path." },
  { id: "fcc", name: "Free Claude Code", color: "#10b981", provider: "ollama", model: "auto",
    persona: "You are Free Claude Code — scrappy and resourceful, running locally for free. You love the clever low-cost solution and remind everyone it doesn't have to be expensive." },
];

// Power users can repoint any room agent WITHOUT editing source — set "roomAgents"
// in ~/.agentic-os/config.json, keyed by agent id. e.g. route GLM to your z.ai key:
//   "roomAgents": { "glm": { "provider": "openai", "baseUrl": "https://api.z.ai/api/paas/v4",
//                            "apiKeyEnv": "GLM_API_KEY", "model": "glm-4.6" },
//                   "gemini": { "model": "google/gemini-3-pro-preview" },
//                   "codex": { "provider": "ollama" } }
function applyOverride(a: RoomAgent): RoomAgent {
  const o = (config.roomAgents ?? {})[a.id];
  const explicitModel = !!(o && typeof o.model === "string" && o.model);
  const m: RoomAgent = o ? {
    ...a,
    ...(explicitModel ? { model: o.model as string } : {}),
    ...(o.provider === "ollama" || o.provider === "openai" ? { provider: o.provider } : {}),
    ...(typeof o.baseUrl === "string" && o.baseUrl ? { baseUrl: o.baseUrl } : {}),
    ...(typeof o.apiKeyEnv === "string" && o.apiKeyEnv ? { apiKeyEnv: o.apiKeyEnv } : {}),
    ...(typeof o.noReasoning === "boolean" ? { noReasoning: o.noReasoning } : {}),
  } : a;
  return m;
}
export function roomAgents(): RoomAgent[] {
  return ROOM_AGENTS.map(applyOverride);
}
export function getAgent(id: string): RoomAgent | undefined {
  return roomAgents().find((a) => a.id === id);
}

// ── keys / models ─────────────────────────────────────────────────────────────
function activeProfile(): string {
  try { const p = readFileSync(path.join(HOME, ".hermes", "active_profile"), "utf8").trim(); if (p) return p; } catch {}
  return process.env.HERMES_PROFILE || "main";
}
// Resolve a named API key: the active Hermes profile .env first, then process.env.
// (Generalises the old OpenRouter-only reader so a room agent can use any key, e.g.
// GLM_API_KEY for z.ai, when routed to a native OpenAI-compatible endpoint.)
function profileEnvKey(name: string): string | null {
  const f = path.join(HOME, ".hermes", "profiles", activeProfile(), ".env");
  if (existsSync(f)) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(name + "="));
      if (line) { const v = line.slice(name.length + 1).replace(/^["']|["']$/g, "").trim(); if (v) return v; }
    } catch {}
  }
  return process.env[name]?.trim() || null;
}
// Room agents with model "auto" pick a model by the kind of task in play: a coder for
// coding talk, a strong generalist otherwise. These used to be hardcoded to
// minimax-m3 / kimi-k2.6 — MiniMax isn't provisioned here, and a hardcoded tag breaks
// the moment the account's model list changes. Now resolved from the account's REAL
// model list (ollama.com /api/tags), cached for the process lifetime.
// Ordered by the user's stated model policy (all served via Ollama Cloud):
//   coding                     → GLM 5.2, then Kimi K2.7 Code
//   non-coding / agentic       → Kimi K2.6 (#1), then MiniMax M3 (#2)
// NOTE: "MiniMax M3" here means the `minimax-m3:cloud` model on Ollama Cloud, which
// the user DOES use. That is distinct from the MiniMax *direct* API
// (api.minimax.io + a minimax-oauth token), which is NOT provisioned on this machine
// and was deliberately removed from the Jarvis path. Don't conflate the two.
const CODE_PREFS = [/glm-?5\.2/i, /kimi.*k2\.7.*code/i, /kimi.*code/i, /glm/i, /qwen.*coder/i, /coder/i, /code/i, /deepseek/i];
const CHAT_PREFS = [/kimi.*k2\.6/i, /minimax.*m3/i, /kimi(?!.*code)/i, /minimax/i, /glm/i, /qwen3(?!-coder)/i, /llama/i];
const ROOM_CODING_RE = /\b(cod(e|ing|er)|function|debug|bug|stack ?trace|api|endpoint|compile|refactor|typescript|javascript|python|rust|golang|css|html|react|next\.?js|sql|regex|npm|docker|kubernetes|shader|webgl|database|schema|backend|frontend|repo|deploy|script|algorithm|async|runtime)\b/i;

let _models: string[] | null = null;
async function availableModels(): Promise<string[]> {
  if (_models) return _models;
  const key = ollamaCloudKey();
  if (!key) return []; // not cached: a key added later is picked up on the next call
  try {
    const r = await fetch(`${ollamaCloudHost()}/api/tags`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!r.ok) return (_models = []);
    const j = await r.json();
    _models = ((j?.models as { name?: string }[]) || []).map((m) => m?.name || "").filter(Boolean);
  } catch { _models = []; }
  return _models;
}

async function roomTaskModel(transcript: RoomTurn[]): Promise<string> {
  const text = transcript.slice(-6).map((t) => t.text).join(" ");
  const prefs = ROOM_CODING_RE.test(text) ? CODE_PREFS : CHAT_PREFS;
  const models = await availableModels();
  for (const re of prefs) {
    const hit = models.find((m) => re.test(m));
    if (hit) return hit;
  }
  // Nothing matched: the default model from settings.ollama (or OLLAMA_CLOUD_MODEL), then the
  // first model the account really has. No model tag is written into the code as a last resort.
  const pick = ollamaCloudDefaultModel() || models[0];
  if (!pick) throw new Error("Ollama Cloud listed no models for this account (or /api/tags failed), so there is no model to use.");
  return pick;
}

const ROOM_SYSTEM =
  "You are in a fast, live group chat with the user and a few other AI agents. " +
  "Keep every message SHORT and conversational — 1 to 3 sentences, like a real chat. " +
  "Stay fully in your own character. You can agree, disagree, build on, or tease the other agents by name. " +
  "Don't repeat what someone already said. Be genuinely useful and real. No preamble, no name prefix — just your message.\n" +
  "You can take REAL actions in the user's vault, but ONLY when they clearly ask for it:\n" +
  "• To SAVE your point as a note in their vault, add a final line exactly: NOTE:: <a short title>\n" +
  "• To ADD an idea to their project pipeline, add a final line exactly: PIPELINE:: <one-line idea>\n" +
  "Use these sparingly — only when asked to save/note/remember something or add a project/idea. Write your normal chat message first, then the directive on its own final line. Never mention this directive syntax in your visible message.";

// Incognito variant: no vault, no saved actions, no reference to "the user's"
// anything. The mode exists to generate opinions and ideas from a clean room, so
// anything that pulls the model back toward personalisation is removed — including
// the NOTE::/PIPELINE:: directives, which would be incoherent with no vault context.
const ROOM_SYSTEM_INCOGNITO =
  "You are in a fast, live group conversation with several other participants. " +
  "Keep every message SHORT and conversational — 1 to 3 sentences, like a real chat. " +
  "Stay fully in your own character. You can agree, disagree, build on, or tease the others by name. " +
  "Don't repeat what someone already said. Think independently and say what you actually believe — " +
  "this is for generating genuine opinions and ideas, not for coding tasks or personal admin. " +
  "You have no access to anyone's files, notes or history, and you should not pretend otherwise. " +
  "No preamble, no name prefix — just your message.";

export interface RoomTurn { speaker: string; text: string; }

// Generic OpenAI-compatible chat completion — works for OpenRouter, z.ai, Sakana,
// a local LM Studio/vLLM server, etc. (anything that speaks /chat/completions).
async function openaiChat(baseUrl: string, model: string, sys: string, user: string, key: string, signal?: AbortSignal, opts?: { noReasoning?: boolean }): Promise<string> {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const r = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal,
    // Reasoning models (Claude 5 / Fable) spend tokens thinking before the
    // visible reply — a tight cap returns empty content, so give headroom.
    // Agents flagged noReasoning (e.g. GLM 5.2) opt out of hidden chain-of-thought
    // so a short chat reply is never starved by reasoning tokens.
    body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.75, ...(opts?.noReasoning ? { reasoning: { enabled: false } } : {}), messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}
async function ollamaComplete(model: string, sys: string, user: string, signal?: AbortSignal): Promise<string> {
  const key = ollamaCloudKey();
  if (!key) throw new Error("No Ollama Cloud key: add it in the Ollama page's gear or set OLLAMA_API_KEY (there is no local Ollama to fall back to).");
  const r = await fetch(`${ollamaCloudHost()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    signal,
    // think:false — kimi/minimax are reasoning models; without this they spend the
    // whole token budget in a hidden "thinking" field and return empty content.
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: "30m", options: { num_predict: 400, temperature: 0.75 },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Ollama Cloud ${r.status} for "${model}"${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
  }
  const j = await r.json();
  // Reasoning models (minimax-m3, kimi) can emit a hidden <think> block — strip it.
  return String(j?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Room turn from one of the user's REAL CLI agents (their subscription, no API key) —
// one-shot per turn. Slower than the HTTP agents, but it's genuinely that CLI talking.
async function roomCli(id: string, sys: string, user: string, incognito?: boolean): Promise<string> {
  const prompt = `${sys}\n\n${user}`;
  if ((LOOP_CLI_AGENTS as readonly string[]).includes(id)) {
    return cliComplete(id, prompt, { timeoutMs: 90_000, incognito, module: "room" });
  }
  throw new Error(`No room CLI runner for ${id}`);
}

export interface RoomSource { kind: "profile" | "note" | "memory"; title: string; }

// Pull REAL context from the user's OWN Obsidian vault so the agents answer about
// THEIR world (their business, projects, notes, memories) — not with generic advice.
// Returns the context text + the list of sources it read (for transparency).
// (Add an "About Me.md" note to your vault to give the agents your profile.)
export async function roomContext(query: string): Promise<{ text: string; sources: RoomSource[] }> {
  if (!VAULT_AVAILABLE) return { text: "", sources: [] };
  const parts: string[] = []; const sources: RoomSource[] = [];
  try {
    const a = (await readNote("About Me.md")) ?? (await readNote("04 Resources/About Me.md"));
    if (a?.content) { parts.push("WHO THE USER IS:\n" + a.content.replace(/^---[\s\S]*?---/, "").replace(/[#*>[\]]/g, "").replace(/\n{2,}/g, "\n").trim().slice(0, 1100)); sources.push({ kind: "profile", title: "About Me" }); }
  } catch {}
  try {
    const hits = await searchNotes(query, 5);
    if (hits.length) { parts.push("RELEVANT NOTES FROM THE USER'S VAULT:\n" + hits.map((h) => `• ${h.title} — ${(h.preview || "").replace(/\s+/g, " ").slice(0, 150)}`).join("\n")); hits.forEach((h) => sources.push({ kind: "note", title: h.title })); }
  } catch {}
  try {
    const mem = await searchOmi(query, 6);
    if (mem.length) { parts.push("RELEVANT MEMORIES (things the user has said/done):\n" + mem.map((m) => "• " + m.slice(0, 170)).join("\n")); sources.push({ kind: "memory", title: `${mem.length} memories` }); }
  } catch {}
  try {
    const rec = await recentNotes(8);
    if (rec.length) parts.push("WHAT THE USER IS WORKING ON LATELY: " + rec.map((r) => r.title).join(", "));
  } catch {}
  return { text: parts.join("\n\n").slice(0, 4500), sources };
}

// ── deeper agentic: agents can write a note to the vault or add a pipeline item ─
export interface RoomAction { kind: "note" | "pipeline"; label: string; ok: boolean; path?: string; }

async function saveRoomNote(title: string, body: string): Promise<string | null> {
  if (!AGENTIC_DIR) return null;
  const dir = path.join(AGENTIC_DIR, "Room Notes");
  await mkdir(dir, { recursive: true });
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)) || "room-note";
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dir, `${slug}.md`), `# ${title}\n\n${body}\n\n---\n_Saved from the Agent Room · ${date}_\n`, "utf8");
  return `Agent OS/Room Notes/${slug}.md`;
}

// Parse + run NOTE:: / PIPELINE:: directives from an agent's reply. Returns the
// cleaned message (directives stripped) + the actions actually taken.
export async function executeRoomActions(text: string): Promise<{ clean: string; actions: RoomAction[] }> {
  const actions: RoomAction[] = [];
  const noteM = text.match(/^\s*NOTE::\s*(.+?)\s*$/im);
  const pipeM = text.match(/^\s*PIPELINE::\s*(.+?)\s*$/im);
  const clean = text.replace(/^\s*(?:NOTE|PIPELINE)::.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();

  if (noteM) {
    const title = noteM[1].trim().slice(0, 80) || "Room note";
    const p = await saveRoomNote(title, clean || title);
    actions.push({ kind: "note", label: title, ok: !!p, path: p || undefined });
  }
  if (pipeM) {
    const idea = pipeM[1].trim();
    try {
      const slug = await uniqueSlug(idea);
      const item: PipelineItem = { slug, title: idea.slice(0, 80), stage: "inbox", created: new Date().toISOString(), idea };
      await writeItem(item);
      actions.push({ kind: "pipeline", label: idea.slice(0, 60), ok: true });
    } catch { actions.push({ kind: "pipeline", label: idea.slice(0, 60), ok: false }); }
  }
  return { clean: clean || text, actions };
}

// One agent's reply, given the transcript + the user's vault context. A failure is an
// error that names the agent and the reason; nothing is invented and nothing switches
// provider behind the user's back (AGENTS.md "Fail loudly", rule 20).
export async function roomReply(
  agent: RoomAgent,
  transcript: RoomTurn[],
  context: string,
  signal?: AbortSignal,
  persona?: Persona,
  incognito?: boolean,
): Promise<string> {
  const ctx = context
    ? `\n\n--- THE USER'S REAL CONTEXT (from their Obsidian vault) ---\n${context}\n--- end context ---\nGround your reply in THIS. Reference their actual business, projects, and notes. Be specific to the user — never give generic advice you could give anyone.`
    : "";
  // Personas mode: layer a human character (Nemotron) over the agent's own identity.
  const personaLayer = persona ? `\n\n${personaPrompt(persona)}` : "";
  const base = incognito ? ROOM_SYSTEM_INCOGNITO : ROOM_SYSTEM;
  const sys = `${base}\n\nYou are ${agent.name}. ${agent.persona}${personaLayer}${ctx}`;
  const convo = transcript.slice(-14).map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const user = `${convo}\n\n${agent.name}:`;
  // The user's real CLI agents (cursor/pi/antigravity) — no API key.
  if (agent.provider === "cli") {
    return roomCli(agent.id, sys, user, incognito);
  }
  if (agent.provider === "ollama") {
    if (!ollamaCloudKey()) throw new Error(`${agent.name}: no Ollama Cloud key. Add it in the Ollama page's gear or set OLLAMA_API_KEY (there is no local Ollama to fall back to).`);
    const model = (agent.model === "auto" || !agent.model) ? await roomTaskModel(transcript) : agent.model;
    let out = await ollamaComplete(model, sys, user, signal);
    if (!out && !signal?.aborted) out = await ollamaComplete(model, sys, user, signal);  // cloud model cold-start can return empty
    if (!out) throw new Error(`${agent.name} got an empty reply from Ollama Cloud (${model}), twice.`);
    return out;
  }
  // Native OpenAI-compatible endpoint (config override) — e.g. GLM via your z.ai key.
  if (agent.provider === "openai") {
    const base = agent.baseUrl || "https://api.openai.com/v1";
    const envName = agent.apiKeyEnv || "OPENAI_API_KEY";
    const k = profileEnvKey(envName);
    if (!k) throw new Error(`No API key for ${agent.name} — set ${envName} (env var or your active Hermes profile .env).`);
    return await openaiChat(base, agent.model, sys, user, k, signal, { noReasoning: agent.noReasoning });
  }
  throw new Error(`${agent.name} has no supported provider (CLI, Ollama Cloud or an OpenAI-compatible endpoint).`);
}

// Pull @mentions (e.g. "@claude @gemini") from a message → agent ids, if any.
export function mentionedIds(message: string): string[] {
  const ids = roomAgents().map((a) => a.id);
  const found = (message.toLowerCase().match(/@([a-z]+)/g) || []).map((m) => m.slice(1));
  return ids.filter((id) => found.includes(id));
}

// ── S25 Mastermind: live status per specialist ───────────────────────────────
// working now  = a reply from this agent is in flight in this server process
// unreachable  = what it needs to answer is missing (CLI not installed, no key)
// active today = it spoke in a room or one-on-one conversation saved today
// ready        = none of the above
const g25 = globalThis as unknown as { __agentosRoomWorking?: Map<string, number> };
const working = () => (g25.__agentosRoomWorking ??= new Map());
export function markWorking(id: string, delta: 1 | -1): void {
  const n = Math.max(0, (working().get(id) ?? 0) + delta);
  if (n) working().set(id, n); else working().delete(id);
}
export function isWorking(id: string): boolean { return (working().get(id) ?? 0) > 0; }

export function agentReachability(a: RoomAgent): { ok: boolean; why: string } {
  if (a.provider === "cli") {
    const key = a.id === "antigravity" ? "antigravity" : a.id;
    const known = ["claude", "codex", "cursor", "pi", "hermes", "antigravity", "openclaw", "kimi"] as const;
    const k = known.find((x) => x === key);
    if (!k) return { ok: false, why: `no CLI mapping for ${a.id}` };
    return isAgentInstalled(k) ? { ok: true, why: `${a.id} CLI installed` } : { ok: false, why: `the ${a.id} CLI is not installed` };
  }
  if (a.provider === "ollama") return ollamaCloudKey() ? { ok: true, why: "Ollama Cloud key set" } : { ok: false, why: "no Ollama Cloud key (Ollama page gear, or OLLAMA_API_KEY); there is no local Ollama" };
  if (a.provider === "openai") { const env = a.apiKeyEnv || "OPENAI_API_KEY"; return profileEnvKey(env) ? { ok: true, why: `${env} set` } : { ok: false, why: `${env} is not set` }; }
  return { ok: false, why: "no supported provider (CLI, Ollama Cloud or OpenAI-compatible)" };
}

export async function activeTodayIds(): Promise<Set<string>> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const ids = new Set<string>();
  for (const c of await listConversations()) {
    if ((c.ts || 0) < start.getTime()) continue;
    for (const m of c.msgs) if (m.who && m.who !== "you" && m.who !== "system") ids.add(m.who);
  }
  return ids;
}
