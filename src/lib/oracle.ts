// THE ORACLE — a wise old sage you consult for counsel: questions of judgment,
// direction and foresight (advice + predictions, NOT hard-fact lookups). Unlike the
// Radar (which needs Grok/xAI OAuth), the Oracle runs one of your OWN CLI agents
// autonomously — so it can quietly research with its real tools (web search, etc.)
// and then answer in a measured, philosophical, wise-old-sage voice. Default: Claude
// (always authed on this machine, has web search). No API key.

import { run, type AgentName } from "@/lib/runner";
import { config } from "@/lib/config";
import { claudeModel } from "@/lib/claudeModel";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withSkills, SKILL_ARG_SAFE_CHARS } from "@/lib/platformSkills";

// The CLI agents wired for autonomous "consult" runs (same set as Loop). Claude first —
// it's the reliable default and has web search available in print mode.
export const ORACLE_AGENTS = ["claude", "codex", "cursor", "pi", "hermes"] as const;

const ORACLE_DIR = path.join(os.homedir(), ".agentic-os", "oracle");
const LOG = path.join(ORACLE_DIR, "log.json");

export interface Consultation { at: string; question: string; answer: string; agent: string; }

// Autonomous invocation per agent — tools ENABLED so the sage can research if it helps.
// Mirrors the "CLI agent with its own tools" pattern used for lead research.
function sageArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude": return { args: ["-p", "--model", claudeModel(), "--output-format", "text", "--dangerously-skip-permissions"], input: prompt };
    case "codex":  return { args: ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor": return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "pi":     return { args: ["-p", prompt, "--mode", "text", "--no-session"] };
    case "hermes": return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:       return { args: ["-p", prompt] };
  }
}

function sagePrompt(question: string): string {
  const who = config.userName && config.userName !== "You" ? config.userName : "the seeker";
  return [
    `You are THE ORACLE — a wise old sage whom ${who} consults for counsel.`,
    "The seeker brings questions of judgment, direction and foresight — matters of advice and prediction,",
    "NOT lookups of hard current facts. You may quietly use your tools to research (search the web, check what is",
    "known) when it genuinely sharpens your counsel — but the seeker wants WISDOM, not a news report. Never mention",
    "your tools, your searching, or that you are an AI.",
    "",
    "YOUR VOICE: an old sage with a philosophical bent — measured, warm, unhurried. You draw on Stoic, Taoist and",
    "classical thought where it truly illuminates, in plain and timeless language. Never corporate, never a",
    "hollow fortune-cookie. Beneath the poetry there is ALWAYS concrete, usable counsel: a clear read of the",
    "situation, the tension at its heart, and what you would actually do. If there is a hard truth, speak it kindly.",
    "",
    "THE SEEKER ASKS:",
    question.trim(),
    "",
    "Answer as the sage:",
    "- Open by naming what the question is really about — reframe it truthfully.",
    "- Give your counsel: the considerations that matter, your reading of where this leads, and a concrete",
    "  recommendation. Be specific and honest.",
    "- Close with a single short aphorism, on its own final line, that distills it all.",
    "",
    "Write 2-4 short paragraphs of flowing prose, then the closing aphorism. Speak directly to the seeker (\"you\").",
    "No headings, no bullet lists, no markdown fences, no preamble like \"Here is\" — begin with the counsel itself.",
  ].join("\n");
}

// Consult the sage. Runs the chosen CLI agent autonomously and returns its prose counsel.
// (run() has its own timeout; it takes no AbortSignal, so the route just relies on that.)
export async function consultOracle(question: string, agent?: string): Promise<string> {
  const a = (agent && (ORACLE_AGENTS as readonly string[]).includes(agent)) ? agent : "claude";
  const { args, input } = sageArgs(a, withSkills(sagePrompt(question), "oracle", SKILL_ARG_SAFE_CHARS));
  const res = await run(a as AgentName, args, { timeoutMs: 240_000, input });
  let out = (res.stdout || "").trim();
  // strip any stray fences / "Oracle:" label a model might add
  out = out.replace(/^```[a-z]*\s*|\s*```$/gi, "").replace(/^(the\s+)?oracle\s*:\s*/i, "").trim();
  if (!out) {
    const se = (res.stderr || "").trim();
    throw new Error(se.slice(-220) || `${a} returned nothing — is it signed in?`);
  }
  return out;
}

// ── persistence: a rolling log of past consultations (newest first) ──
export async function readConsultations(): Promise<Consultation[]> {
  try {
    const j = JSON.parse(await readFile(LOG, "utf8"));
    return Array.isArray(j?.items) ? j.items : [];
  } catch { return []; }
}

export async function saveConsultation(c: Consultation): Promise<void> {
  try {
    const items = [c, ...(await readConsultations())].slice(0, 60);
    await mkdir(ORACLE_DIR, { recursive: true });
    await writeFile(LOG, JSON.stringify({ items }, null, 2), "utf8");
  } catch { /* best effort — a failed log write must not break the answer */ }
}
