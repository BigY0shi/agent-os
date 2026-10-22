// Loop Engine — the core of the /loop section.
// Implements the loop-engineering cycle: a BUILDER acts, a separate JUDGE verifies
// adversarially, and we loop until the judge passes or progress stalls. The builder
// never grades its own homework. CLI only (owner, 2026-09-29): builders are CLI agents,
// judges are CLI agents or the local Ollama model; see ./loopModels for the lists.
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { run, type AgentName } from "./runner";
import { claudeModel } from "./claudeModel";
import { ollamaCloudHost, ollamaCloudKey } from "./ollamaCloud";
import { ORCHESTRATION_DIRECTIVE, claudeBuilderArgs } from "./agentPowers";
import { withSkills } from "@/lib/platformSkills";
import { isLoopBuilder, isLoopJudge } from "./loopModels";

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
    case "claude":  args = ["-p", "--model", claudeModel(), "--output-format", "text"]; input = prompt; break;
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

// MiniMax's chat endpoint. The Loop no longer calls it (CLI only); kept exported because
// v2/memory/llm.ts uses it for its own owner-chosen "minimax" memory provider.
export const MINIMAX_CHAT = "https://api.minimax.io/v1/chat/completions";

// STEP 3 — ACT. The builder produces / revises the work toward the goal, fixing the
// exact issues the verifier raised last round. CLI agents only.
export async function workerAct(goal: string, prev: string, issues: string[], worker: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  if (!isLoopBuilder(worker)) throw new Error(`The Loop runs CLI agents only, and "${worker}" is not one. Pick a CLI agent for the builder.`);
  const sys = "You are the BUILDER in a self-running loop. Produce the best possible version of the work toward the definition of done. A separate adversarial judge will grade it — so genuinely meet the goal, don't just look plausible. "
    + "If the work is a web page, app, game or tool, output ONE complete self-contained HTML file (all CSS + JS inline, no external dependencies or CDNs, works offline by double-clicking) that is BEAUTIFUL and actually functional. Design bar: a modern dark theme with depth (layered backgrounds, soft radial glows, never flat #000), a refined accent colour with subtle gradients, real typography hierarchy (a strong display weight for headings, comfortable body size, good line-height), generous spacing and padding, rounded cards with soft shadows + 1px light borders, smooth micro-interactions (hover states, transitions, a tasteful entrance animation), and fully responsive layout. Make numbers/results big and legible. It should look like a polished premium product, not a prototype. "
    + "Output ONLY the work itself (the raw file/text) — no preamble, no explanation, no markdown fences.";
  const fb = issues.length ? `\n\nThe judge REJECTED the last version. Fix exactly these and change nothing else that already works:\n- ${issues.join("\n- ")}` : "";
  const base = prev ? `\n\n--- YOUR LAST VERSION (revise it) ---\n${prev}\n--- END ---` : "\n\n(No draft yet — create the first version from scratch.)";
  const user = `DEFINITION OF DONE:\n${goal}${base}${fb}\n\nReturn the full improved work now.`;
  // CLI agent (the user's real subscription, no API key) — one-shot print mode.
  return cliComplete(worker.slice(4), `${sys}\n\n${user}`, { timeoutMs: opts.timeoutMs ?? 240_000, signal: opts.signal });
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

// Ollama Cloud judge. There is no local Ollama on this machine (owner, 2026-09-30: "it needs
// to hit ollama cloud or no fallback"), so this goes to https://ollama.com with OLLAMA_API_KEY.
// It is used when the owner picks it as the judge, or as the fallback judge when the Loop
// gear says so. format:"json" forces a parseable verdict. Every failure throws its reason.
// Host and key: settings.ollama (the Ollama page's gear), then the environment, per call.

/** The Ollama Cloud model to judge with: the Loop gear's choice, else picked from the
 *  account's own model list by the owner's model policy (judging is analytical, so the
 *  agentic models first). No model tag is written into the code. */
async function cloudJudgeModel(chosen: string | undefined, key: string, signal?: AbortSignal): Promise<string> {
  if (chosen && chosen.trim()) return chosen.trim();
  const r = await fetch(`${ollamaCloudHost()}/api/tags`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!r.ok) throw new Error(`Ollama Cloud /api/tags answered HTTP ${r.status}`);
  const j = await r.json();
  const names: string[] = ((j?.models as { name?: string }[]) || []).map((m) => m?.name || "").filter(Boolean);
  if (!names.length) throw new Error("Ollama Cloud listed no models for this account");
  for (const re of [/kimi.*k2\.6/i, /minimax.*m3/i, /glm-?5\.2/i, /kimi/i, /glm/i, /coder|code/i, /qwen|llama|mistral/i]) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return names[0];
}

async function ollamaCloudJudge(goal: string, artifact: string, model: string | undefined, signal?: AbortSignal): Promise<Verdict> {
  const key = ollamaCloudKey();
  if (!key) throw new Error("no Ollama Cloud key (add it in the Ollama page's gear, or set OLLAMA_API_KEY); there is no local Ollama");
  const m = await cloudJudgeModel(model, key, signal);
  const r = await fetch(`${ollamaCloudHost()}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: m,
      messages: [{ role: "system", content: JUDGE_SYS }, { role: "user", content: judgeUser(goal, artifact) }],
      stream: false, format: "json", think: false, options: { temperature: 0.2 },
    }), signal,
  });
  if (!r.ok) throw new Error(`Ollama Cloud ${r.status} for "${m}": ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const j = await r.json();
  const v = parseVerdict(j?.message?.content ?? "");
  if (!v) throw new Error(`Ollama Cloud (${m}) returned no parseable verdict`);
  return { ...v, judgedBy: `ollama-cloud:${m}` };
}

export interface VerdictOpts {
  signal?: AbortSignal;
  /** Time limit for a CLI judge (Loop gear: judgeTimeoutSec). */
  timeoutMs?: number;
  /** Who grades when a CLI judge returns nothing usable (Loop gear: judgeFallback). */
  fallback?: "none" | "ollama-cloud";
  /** Ollama Cloud model (Loop gear: ollamaModel; blank = picked by the model policy). */
  ollamaModel?: string;
  /** Test seam: the CLI runner (default cliComplete), so a smoke can exercise the fallback
   *  without launching a real, billed CLI agent. */
  cliRunner?: typeof cliComplete;
}

// STEP 4+5 — GATHER FEEDBACK + VERIFY. A judge grades the work adversarially against
// the definition of done:
//   "cli:<agent>"  → a CLI agent (default: Claude CLI)
//   "ollama-cloud" → Ollama Cloud (model from the Loop gear)
// Anything else is refused. When a CLI judge returns nothing usable, another judge grades
// only if the owner chose one in the Loop gear (rule 20), and the verdict says so.
export async function verdict(goal: string, artifact: string, judge: string, opts: VerdictOpts = {}): Promise<Verdict> {
  if (!isLoopJudge(judge)) throw new Error(`The Loop runs CLI agents (or the Ollama Cloud judge) only, and "${judge}" is not one. Pick a CLI agent for the judge.`);
  const { signal } = opts;
  if (judge === "ollama-cloud") {
    try { return await ollamaCloudJudge(goal, artifact, opts.ollamaModel, signal); }
    catch (e) {
      const msg = (e as Error)?.message || String(e);
      return { pass: false, score: 0, issues: [`Ollama Cloud judge failed: ${msg}`], summary: "no verdict", judgedBy: "none", judgeError: msg };
    }
  }

  let raw = "";
  let judgeError = "";
  try {
    raw = await (opts.cliRunner ?? cliComplete)(judge.slice(4), `${JUDGE_SYS}\n\n${judgeUser(goal, artifact)}`, { timeoutMs: opts.timeoutMs ?? 180_000, signal });
  } catch (e) {
    // Keep the real cause; it used to be swallowed into a generic "no parseable verdict".
    judgeError = (e as Error)?.message || String(e);
  }
  const v = parseVerdict(raw);
  if (v) return { ...v, judgedBy: judge };

  const why = judgeError || "returned no parseable verdict";
  if (opts.fallback === "ollama-cloud") {
    try {
      const fb = await ollamaCloudJudge(goal, artifact, opts.ollamaModel, signal);
      return {
        ...fb,
        judgedBy: `${fb.judgedBy} (fallback)`,
        fellBackFrom: judge,
        judgeError: why,
        issues: [`⚠ Graded by the Ollama Cloud fallback judge (your Loop setting), not "${judge}" (${why}).`, ...fb.issues],
      };
    } catch (e) {
      const fbWhy = (e as Error)?.message || String(e);
      return { pass: false, score: 0, issues: [`Judge "${judge}" failed: ${why}. The Ollama Cloud fallback failed too: ${fbWhy}.`], summary: raw.slice(0, 180) || "no verdict", judgedBy: "none", judgeError: why };
    }
  }
  return {
    pass: false,
    score: 0,
    issues: [`Judge "${judge}" failed: ${why}. No fallback judge is set (Loop gear, Judge fallback).`],
    summary: raw.slice(0, 180) || "no verdict",
    judgedBy: "none",
    judgeError: judgeError || undefined,
  };
}

// The Builder/Judge menus live in ./loopModels (no node: imports) so the client UI
// can share the exact same lists instead of hand-duplicating them.
export { WORKERS, JUDGES, DEFAULT_WORKER, DEFAULT_JUDGE } from "./loopModels";
