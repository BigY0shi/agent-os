// Loop Engine — the core of the /loop section.
// Implements the loop-engineering cycle: a BUILDER model acts, the Fusion council
// (panel of models + judge) verifies adversarially, and we loop until the verifier
// passes or progress stalls. The builder never grades its own homework — Fusion does.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { run, type AgentName } from "./runner";
import { CLAUDE_MODEL } from "./config";
import { ORCHESTRATION_DIRECTIVE, claudeBuilderArgs } from "./agentPowers";
import { withSkills } from "@/lib/platformSkills";

const OR = "https://openrouter.ai/api/v1/chat/completions";

// CLI-agent loop backend. A worker/judge id of "cli:<agent>" runs the user's real CLI
// agent one-shot (no API key) — print mode → stdout. The HTML extractor (builder) and
// JSON verdict parser (judge) both tolerate any preamble, so noisy CLI output still works.
// Only agents with an established non-interactive invocation are wired.
export const LOOP_CLI_AGENTS = ["claude", "codex", "cursor", "pi", "hermes", "antigravity"] as const;

// Prompts longer than this can't ride on the command line (the OS/arg limit), and
// silently dropping them made the loop spin with no instructions. Anything bigger
// goes over stdin, which every one of these CLIs accepts.
const ARG_PROMPT_LIMIT = 30_000;

/**
 * INCOGNITO — run a CLI agent with no personal context: no user/project memory
 * (CLAUDE.md, AGENTS.md, rules), no MCP servers, no session persistence, and a
 * neutral scratch cwd so nothing project-local is discovered.
 *
 * Coverage differs per CLI, and this is what each one ACTUALLY supports (verified
 * against `--help` + a live probe on 2026-07-25 — do not add flags unverified):
 *   claude      FULL    --setting-sources= --strict-mcp-config
 *                       --no-session-persistence --system-prompt <generic>
 *                       (NOTE the equals form. "--setting-sources" followed by a
 *                        separate "" arg does NOT work here: runner.ts safeArg()
 *                        drops zero-length args, so claude then read the NEXT flag
 *                        as the value → "Invalid setting source: --strict-mcp-config".)
 *                       (probe: normal run quoted the user's Learned Rules; with
 *                        these flags it reported no memory loaded)
 *   hermes      FULL    --ignore-user-config --ignore-rules
 *   codex       FULL    --ignore-user-config (already passed in every run)
 *   pi          PARTIAL --system-prompt replaces its default coding prompt
 *   cursor      CWD-ONLY no documented config/memory flag
 *   antigravity CWD-ONLY no documented config/memory flag
 */
export const INCOGNITO_COVERAGE: Record<string, "full" | "partial" | "cwd-only"> = {
  claude: "full", hermes: "full", codex: "full",
  pi: "partial", cursor: "cwd-only", antigravity: "cwd-only",
};

// A neutral working directory so no project CLAUDE.md/AGENTS.md is discovered.
function scratchCwd(): string {
  const dir = path.join(os.tmpdir(), "agent-os-incognito");
  try { mkdirSync(dir, { recursive: true }); } catch { /* fall back to tmpdir */ }
  return dir;
}

const INCOGNITO_SYS = "You are a participant in a group conversation. Follow the instructions given in the message.";

export async function cliComplete(
  agent: string,
  prompt: string,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    incognito?: boolean;
    /** Let the agent actually use its tools — see agentPowers.ts. */
    fullAccess?: boolean;
    /** Push it to delegate via the multi-agent-mcp-orchestration skill. */
    orchestrate?: boolean;
    /** Root the agent somewhere real, so it can read the files it reasons about. */
    cwd?: string;
    /** S14: the calling module's key. Its skills (global + module, from settings.skills)
     *  are prepended, so per-module toggles in the Skills & Workflows pop-up take effect.
     *  Omitted = no skills (JSON extractors stay clean). Ignored when incognito. */
    module?: string;
  },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 240_000;
  const incog = !!opts?.incognito;
  // Incognito is the exact opposite posture — a clean-room opinion with no memory,
  // no tools and no project context. If both are somehow set, incognito wins.
  const orchestrate = !incog && !!opts?.orchestrate;
  const fullAccess = !incog && (!!opts?.fullAccess || orchestrate);

  // claude takes the directive as a system-prompt APPEND, which keeps it out of the
  // visible conversation. No other CLI here has a verified equivalent flag, so they
  // get it inlined ahead of the prompt.
  let text = opts?.module && !incog ? withSkills(prompt, opts.module) : prompt;
  if (orchestrate && agent !== "claude") text = `${ORCHESTRATION_DIRECTIVE}\n\n---\n\n${text}`;

  // The loop embeds the previous artifact in the prompt, so by iteration 2 this is
  // routinely >30k chars — stdin is the only safe channel.
  const viaStdin = text.length > ARG_PROMPT_LIMIT;
  prompt = text;
  let args: string[];
  let input: string | undefined;
  switch (agent) {
    case "claude":  args = ["-p", "--model", CLAUDE_MODEL, "--output-format", "text"]; input = prompt; break;
    case "codex":   args = viaStdin ? ["exec", "--skip-git-repo-check", "--ignore-user-config", "-"] : ["exec", "--skip-git-repo-check", "--ignore-user-config", prompt]; break;
    case "cursor":  args = viaStdin ? ["-p", "--output-format", "text", "--force", "--trust"] : ["-p", prompt, "--output-format", "text", "--force", "--trust"]; break;
    case "pi":      args = viaStdin ? ["-p", "--mode", "text", "--no-session", "--no-context-files"] : ["-p", prompt, "--mode", "text", "--no-session", "--no-context-files"]; break;
    case "hermes":  args = viaStdin ? ["-z", "-", "--yolo", "--accept-hooks"] : ["-z", prompt, "--yolo", "--accept-hooks"]; break;
    // Antigravity (Google lineage) — native agy.exe, verified one-shot: `agy -p "<prompt>"`.
    case "antigravity": args = ["-p", prompt]; break;
    default: throw new Error(`${agent} isn't wired for Loop yet — use Claude, Codex, Cursor, Pi or Hermes.`);
  }
  if (viaStdin && input === undefined) input = prompt;

  // Layer the per-CLI incognito flags on top (see INCOGNITO_COVERAGE above).
  if (incog) {
    switch (agent) {
      case "claude":
        args = [...args, "--setting-sources=", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", INCOGNITO_SYS];
        break;
      case "hermes":
        args = [...args, "--ignore-user-config", "--ignore-rules"];
        break;
      case "pi":
        args = [...args, "--system-prompt", INCOGNITO_SYS];
        break;
      // codex already passes --ignore-user-config; cursor/antigravity get cwd isolation only.
    }
  }

  // Builder powers. Claude-only for now: the other CLIs' bypass flags aren't
  // verified on this machine, and hermes already runs --yolo.
  if (fullAccess && agent === "claude") {
    args = [...args, ...claudeBuilderArgs({ orchestrate })];
  }

  const res = await run(agent as AgentName, args, {
    timeoutMs, input, signal: opts?.signal,
    // Incognito's scratch cwd is what makes it clean-room, so it outranks a caller's cwd.
    ...(incog ? { cwd: scratchCwd() } : opts?.cwd ? { cwd: opts.cwd } : {}),
  });
  const out = (res.stdout || "").trim();
  if (!out) throw new Error((res.stderr || `${agent} returned no output (exit ${res.code}).`).slice(-220));
  return out;
}

function activeProfile(): string {
  try { const p = readFileSync(path.join(os.homedir(), ".hermes", "active_profile"), "utf8").trim(); if (p) return p; } catch {}
  return process.env.HERMES_PROFILE || "main";
}

// Read the OpenRouter key: env → active profile → fusion profile → global hermes.
export function orKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const files = [
    path.join(os.homedir(), ".hermes", "profiles", activeProfile(), ".env"),
    path.join(os.homedir(), ".hermes", "profiles", "fusion", ".env"),
    path.join(os.homedir(), ".hermes", ".env"),
  ];
  for (const f of files) {
    try { const m = readFileSync(f, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); } catch { /* next */ }
  }
  return null;
}

interface Msg { role: string; content: string }

export async function orComplete(model: string, messages: Msg[], key: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal; noReasoning?: boolean }): Promise<string> {
  const body: Record<string, unknown> = { model, messages, temperature: opts?.temperature ?? 0.6 };
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts?.noReasoning) body.reasoning = { enabled: false };
  const r = await fetch(OR, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://aiprofitboardroom.com", "X-Title": "Agent OS · Loop" },
    body: JSON.stringify(body), signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `OpenRouter ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}

// ── Nous Portal (free, under your own Nous Portal subscription) ─────────────
// Hermes logs in via `hermes portal` (device-code OAuth) and stores the token in
// ~/.hermes/auth.json under providers.nous. We read it and call the OpenAI-compatible
// Nous inference endpoint directly. Models prefixed "nous:" route here.
export const NOUS_INFERENCE = "https://inference-api.nousresearch.com/v1";

function nousFrom(file: string): string | null {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    const p = d?.providers?.nous;
    if (!p) return null;
    const entry = Array.isArray(p) ? p[0] : p;
    return entry?.access_token || entry?.runtime_api_key || entry?.api_key || entry?.token || null;
  } catch { return null; }
}

// The Nous Portal token lives in the ACTIVE PROFILE's auth.json (e.g. profiles/julian/auth.json),
// not necessarily the global one — check the profile first, then global, then any profile.
export function nousToken(): string | null {
  if (process.env.NOUS_API_KEY) return process.env.NOUS_API_KEY.trim();
  const home = os.homedir();
  for (const f of [path.join(home, ".hermes", "profiles", activeProfile(), "auth.json"), path.join(home, ".hermes", "auth.json")]) {
    const t = nousFrom(f); if (t) return t;
  }
  try { const dir = path.join(home, ".hermes", "profiles"); for (const name of readdirSync(dir)) { const t = nousFrom(path.join(dir, name, "auth.json")); if (t) return t; } } catch { /* ignore */ }
  return null;
}

export async function nousModels(token: string): Promise<string[]> {
  const r = await fetch(`${NOUS_INFERENCE}/models`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Nous /models HTTP ${r.status}`);
  const j = await r.json();
  return ((j?.data as { id: string }[]) || []).map((m) => m.id).filter(Boolean);
}

async function nousComplete(model: string, messages: Msg[], token: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string> {
  const body: Record<string, unknown> = { model, messages, temperature: opts?.temperature ?? 0.6 };
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens;
  const r = await fetch(`${NOUS_INFERENCE}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.error?.message || `Nous ${r.status}`);
  return String(j.choices[0].message?.content ?? "").trim();
}

export interface Creds { orKey: string | null; nousToken: string | null; minimaxToken?: string | null }

// ── MiniMax (via the OAuth token Hermes already stores: providers.minimax-oauth) ──
// OpenAI-compatible chat endpoint. MiniMax-M3 is a reasoning model — it emits a
// <think>…</think> block inline in content, which we strip. Reliable (real sub),
// unlike the throttled free tiers. Models prefixed "minimax:" route here.
export const MINIMAX_CHAT = "https://api.minimax.io/v1/chat/completions";
async function minimaxComplete(model: string, messages: Msg[], token: string, opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<string> {
  const r = await fetch(MINIMAX_CHAT, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: opts?.maxTokens ?? 12000, temperature: opts?.temperature ?? 0.6 }),
    signal: opts?.signal,
  });
  const j = await r.json();
  if (!r.ok || !j?.choices?.[0]) throw new Error(j?.base_resp?.status_msg || j?.error?.message || `MiniMax ${r.status}`);
  let c = String(j.choices[0].message?.content ?? "").trim();
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim(); // strip M3 reasoning
  return c;
}

// STEP 3 — ACT. The builder produces / revises the work toward the goal, fixing the
// exact issues the verifier raised last round. Routes to Nous Portal (free) or OpenRouter.
export async function workerAct(goal: string, prev: string, issues: string[], worker: string, creds: Creds, signal?: AbortSignal): Promise<string> {
  const sys = "You are the BUILDER in a self-running loop. Produce the best possible version of the work toward the definition of done. A separate adversarial judge will grade it — so genuinely meet the goal, don't just look plausible. "
    + "If the work is a web page, app, game or tool, output ONE complete self-contained HTML file (all CSS + JS inline, no external dependencies or CDNs, works offline by double-clicking) that is BEAUTIFUL and actually functional. Design bar: a modern dark theme with depth (layered backgrounds, soft radial glows, never flat #000), a refined accent colour with subtle gradients, real typography hierarchy (a strong display weight for headings, comfortable body size, good line-height), generous spacing and padding, rounded cards with soft shadows + 1px light borders, smooth micro-interactions (hover states, transitions, a tasteful entrance animation), and fully responsive layout. Make numbers/results big and legible. It should look like a polished premium product, not a prototype. "
    + "Output ONLY the work itself (the raw file/text) — no preamble, no explanation, no markdown fences.";
  const fb = issues.length ? `\n\nThe judge REJECTED the last version. Fix exactly these and change nothing else that already works:\n- ${issues.join("\n- ")}` : "";
  const base = prev ? `\n\n--- YOUR LAST VERSION (revise it) ---\n${prev}\n--- END ---` : "\n\n(No draft yet — create the first version from scratch.)";
  const user = `DEFINITION OF DONE:\n${goal}${base}${fb}\n\nReturn the full improved work now.`;
  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  // CLI agent (the user's real subscription, no API key) — one-shot print mode.
  if (worker.startsWith("cli:")) {
    return cliComplete(worker.slice(4), `${sys}\n\n${user}`, { timeoutMs: 240_000, signal });
  }
  // N2 + ":free" reasoning models burn the whole budget "thinking" and stream empty
  // unless reasoning is disabled — critical for code/HTML generation.
  const noReasoning = /glm|n2|:free|nex-/i.test(worker);
  if (worker.startsWith("minimax:")) {
    if (!creds.minimaxToken) throw new Error("MiniMax isn't connected — run `hermes auth add minimax-oauth` in your terminal.");
    return minimaxComplete(worker.slice(8) || "MiniMax-M3", messages, creds.minimaxToken, { temperature: 0.6, maxTokens: 16000, signal });
  }
  if (worker.startsWith("nous:")) {
    if (!creds.nousToken) throw new Error("Nous Portal isn't logged in — run `hermes portal` in your terminal, then pick a free Nous model.");
    return nousComplete(worker.slice(5), messages, creds.nousToken, { temperature: 0.6, maxTokens: 8000, signal });
  }
  if (!creds.orKey) throw new Error("No OpenRouter key in the active Hermes profile.");
  return orComplete(worker, messages, creds.orKey, { temperature: 0.6, maxTokens: 8000, noReasoning, signal });
}

export interface Verdict {
  pass: boolean;
  score: number;
  issues: string[];
  summary: string;
  /** Which judge actually produced this verdict (may differ from the one you picked). */
  judgedBy?: string;
  /** Set when the chosen judge failed and a fallback graded instead. */
  fellBackFrom?: string;
  /** Why the chosen judge failed, when it did. */
  judgeError?: string;
}

// The adversarial judging prompt — shared by every verifier backend.
const JUDGE_SYS = "You are the VERIFICATION GATE in a self-running loop. You do NOT improve the work; you judge it adversarially against the definition of done. Be strict — the builder does not grade its own homework, you do. Find the real flaws. Pass only when the work truly, fully meets the goal.";
function judgeUser(goal: string, artifact: string): string {
  return `DEFINITION OF DONE (what the loop must hit):\n${goal}\n\n--- THE WORK TO JUDGE ---\n${artifact}\n--- END ---\n\nJudge it adversarially. Reply with ONLY this JSON object (no other text):\n{"pass": <true only if it fully meets the definition of done>, "score": <0-100>, "issues": ["specific fixable problems; empty array if pass"], "summary": "<one-line verdict>"}`;
}
function parseVerdict(raw: string): Verdict | null {
  const matches = raw.match(/\{[\s\S]*?\}/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(matches[i]) as Partial<Verdict>;
      if (typeof v.pass === "undefined") continue;
      // A model may emit the STRING "false" — `!!"false"` is true, which would record
      // a failing build as passed. Only a real boolean true (or the literal "true")
      // counts as a pass; anything else fails closed.
      const raw = v.pass as unknown;
      const pass = raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "true");
      return { pass, score: Number(v.score) || 0, issues: Array.isArray(v.issues) ? v.issues.map(String).slice(0, 8) : [], summary: String(v.summary || "") };
    } catch { /* try previous */ }
  }
  return null;
}

// Local Ollama judge — totally free, offline, always available. format:"json"
// forces a strictly-parseable verdict. Used as the default-free judge AND as the
// fallback when a free remote endpoint (N2) throttles / returns empty.
const OLLAMA = "http://127.0.0.1:11434/api/chat";

/**
 * Pick a local Ollama model that is actually pulled. The old hardcoded default
 * ("xentriom/gemma-4-12B-...") isn't installed here, so the local judge 404'd and
 * the loop's safety net was silently dead. Ask the daemon what it has.
 */
async function localJudgeModel(signal?: AbortSignal): Promise<string | null> {
  if (process.env.LOCAL_MODEL) return process.env.LOCAL_MODEL;
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal });
    if (!r.ok) return null;
    const j = await r.json();
    const names: string[] = ((j?.models as { name?: string }[]) || []).map((m) => m?.name || "").filter(Boolean);
    if (!names.length) return null;
    // Judging is an analytical (non-coding) task → the user's agentic models first
    // (MiniMax M3, Kimi K2.6 — via Ollama Cloud), then coders, then anything.
    for (const re of [/kimi.*k2\.6/i, /minimax.*m3/i, /glm-?5\.2/i, /kimi/i, /glm/i, /coder|code/i, /qwen|llama|mistral/i]) {
      const hit = names.find((n) => re.test(n));
      if (hit) return hit;
    }
    return names[0];
  } catch { return null; }
}

async function ollamaJudge(goal: string, artifact: string, signal?: AbortSignal): Promise<Verdict | null> {
  try {
    const model = await localJudgeModel(signal);
    if (!model) return null;
    const r = await fetch(OLLAMA, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgeUser(goal, artifact) }],
        stream: false, format: "json", keep_alive: "30m", options: { temperature: 0.2 },
      }), signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return parseVerdict(j?.message?.content ?? "");
  } catch { return null; }
}

// STEP 4+5 — GATHER FEEDBACK + VERIFY. A judge grades the work adversarially against
// the definition of done. The judge is configurable + defaults to FREE models:
//   "local"            → local Ollama (free, offline)
//   "nous:<model>"     → Nous Portal (free under the Portal subscription)
//   "openrouter/fusion"→ the Fusion council (paid, premium)
//   any other id       → an OpenRouter model (e.g. "nex-agi/nex-n2-pro:free" — FREE)
// If a free remote judge returns nothing parseable (N2 throttles / empties), we fall
// back to the local Ollama judge so the loop never stalls on a flaky free endpoint.
export async function verdict(goal: string, artifact: string, judge: string, creds: Creds, signal?: AbortSignal): Promise<Verdict> {
  const messages = [{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgeUser(goal, artifact) }];
  let raw = "";
  let judgeError = "";
  try {
    if (judge === "local") {
      const v = await ollamaJudge(goal, artifact, signal);
      if (v) return { ...v, judgedBy: "local" };
      return { pass: false, score: 0, issues: ["Local judge (Ollama) unreachable — is `ollama serve` running, and is a model pulled?"], summary: "no local judge", judgedBy: "none" };
    } else if (judge.startsWith("cli:")) {
      raw = await cliComplete(judge.slice(4), `${JUDGE_SYS}\n\n${judgeUser(goal, artifact)}`, { timeoutMs: 180_000, signal });
    } else if (judge.startsWith("minimax:")) {
      if (!creds.minimaxToken) throw new Error("MiniMax not connected");
      raw = await minimaxComplete(judge.slice(8) || "MiniMax-M3", messages, creds.minimaxToken, { temperature: 0.2, maxTokens: 2000, signal });
    } else if (judge.startsWith("nous:")) {
      if (!creds.nousToken) throw new Error("Nous Portal not logged in");
      raw = await nousComplete(judge.slice(5), messages, creds.nousToken, { temperature: 0.2, maxTokens: 1200, signal });
    } else {
      if (!creds.orKey) throw new Error("No OpenRouter key");
      // N2 + most ":free" models are reasoning models — disable reasoning or they
      // burn the whole budget thinking and stream empty content.
      const noReasoning = /n2|:free|nex-/i.test(judge);
      raw = await orComplete(judge, messages, creds.orKey, { temperature: 0.2, maxTokens: 1200, noReasoning, signal });
    }
  } catch (e) {
    // Keep the real cause — it used to be swallowed, so a missing key or an auth
    // failure surfaced as the generic "no parseable verdict".
    judgeError = (e as Error)?.message || String(e);
  }

  const v = parseVerdict(raw);
  if (v) return { ...v, judgedBy: judge };

  // The chosen judge failed. Fall back to the local model so the loop keeps moving —
  // but SAY SO, rather than silently passing off a local grade as the chosen judge's.
  const local = await ollamaJudge(goal, artifact, signal);
  if (local) {
    return {
      ...local,
      judgedBy: "local (fallback)",
      fellBackFrom: judge,
      judgeError: judgeError || "returned nothing parseable",
      issues: [
        `⚠ Graded by the LOCAL fallback judge, not "${judge}" (${judgeError || "no parseable verdict"}).`,
        ...local.issues,
      ],
    };
  }
  return {
    pass: false,
    score: 0,
    issues: [`Judge "${judge}" failed: ${judgeError || "returned no parseable verdict"}. Local fallback unavailable (is ollama running with a model pulled?).`],
    summary: raw.slice(0, 180) || "no verdict",
    judgedBy: "none",
    judgeError: judgeError || undefined,
  };
}

// Back-compat: the old Fusion-only entry point now routes through the generic verdict().
export async function fusionVerdict(goal: string, artifact: string, key: string, signal?: AbortSignal): Promise<Verdict> {
  return verdict(goal, artifact, "openrouter/fusion", { orKey: key, nousToken: null }, signal);
}

// The Builder/Judge menus live in ./loopModels (no node: imports) so the client UI
// can share the exact same lists instead of hand-duplicating them.
export { WORKERS, JUDGES, DEFAULT_WORKER, DEFAULT_JUDGE } from "./loopModels";
