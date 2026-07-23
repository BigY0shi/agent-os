// NEWS RADAR — multi-agent, multi-source news gathering (manager → workers pattern).
//
// Instead of one Claude call reading X via Grok, we fan out RESEARCH SCOUTS: each
// installed CLI agent (Codex / Cursor / Hermes / Claude) runs autonomously with its OWN
// web tools on a bounded "beat" (a distinct slice of sources), in parallel. A MANAGER
// then merges + dedupes + ranks their findings into the final 6 signals. Ollama can't
// browse, so it isn't a scout — it can serve as the free local MERGER instead.
//
// This is the /multi-agent-mcp-orchestration technique applied at runtime: bounded
// subtasks, isolated worker contexts, output contracts, and a manager-owned merge.

import { run, type AgentName } from "@/lib/runner";
import { config, CLAUDE_MODEL } from "@/lib/config";
import { cliComplete } from "@/lib/loopEngine";
import { ollamaModels } from "@/lib/pipeline";

// Research-capable CLI agents — they have web/agentic tools. (Ollama excluded: no browsing.)
const RESEARCH_AGENTS: AgentName[] = ["claude", "codex", "cursor", "hermes"];

// Source beats — each scout owns exactly one, so the six stories come from a wide spread.
const BEATS = [
  { key: "Labs", sources: "official AI lab blogs, changelogs & release notes — OpenAI, Anthropic, Google / DeepMind, xAI, Meta AI, Mistral, DeepSeek, Alibaba Qwen, Z.ai / GLM" },
  { key: "Press", sources: "the tech press — TechCrunch, The Verge, VentureBeat, Ars Technica, Wired, The Information, Semafor Tech, Bloomberg Tech" },
  { key: "Community", sources: "aggregators & community — Techmeme, Hacker News (news.ycombinator.com), Reddit (r/LocalLLaMA, r/MachineLearning, r/artificial), Product Hunt" },
  { key: "Research", sources: "research & release hubs — arXiv (cs.AI / cs.CL), Hugging Face (trending models & papers), GitHub Trending, Simon Willison's blog, and AI newsletters (Import AI, TLDR AI)" },
];

export interface RawStory { headline: string; url: string; source: string; why_now: string; posted: string; category: string; }
export interface GatherResult { rawJson: string; scouts: string[]; merger: string; found: number; }

// Autonomous invocation per agent — tools ENABLED so the scout can actually browse.
function researchArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude": return { args: ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", "--dangerously-skip-permissions"], input: prompt };
    case "codex":  return { args: ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor": return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "hermes": return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:       return { args: ["-p", prompt] };
  }
}

function whoLabel(): string {
  return config.userName && config.userName !== "You" ? config.userName : "a creator/founder building with AI agents";
}

// Tolerant JSON-array extraction from noisy CLI stdout (agents add preambles / fences).
function parseArray(raw: string): Record<string, unknown>[] {
  let s = (raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("["); const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try { const arr = JSON.parse(s.slice(start, end + 1)); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

function beatPrompt(beat: typeof BEATS[number], today: string): string {
  return [
    `You are a NEWS SCOUT for ${whoLabel()}. TODAY IS ${today}.`,
    `Your ONLY beat is: ${beat.sources}.`,
    "Use your web / browsing tools to find the BIGGEST AI + tech stories from THIS BEAT that broke in the last 24 hours (48h absolute max). Do not cover other beats.",
    "Only include a story if you can point to a REAL article URL from one of these sources AND you can tell it broke in the last 24-48h.",
    "If you cannot verify recency, return fewer — NEVER invent a story, URL, date, or outlet. An empty array is fine if the beat is quiet.",
    "",
    "Return ONLY a JSON array (no prose, no commentary, no markdown fences) of up to 5 objects:",
    '[{"headline":"<=10 words","url":"https:// the real article link","source":"the outlet/site name","why_now":"1 sentence — the real news + who is driving it","posted":"e.g. \'2h ago\', \'this morning\'","category":"Models|Agents|Tools|SEO|Drama|Money"}]',
  ].join("\n");
}

// The LEAD scout (Claude) covers the biggest stories across ALL beats — a reliable baseline
// so coverage never depends on a single weak browser. Specialists then add fresh beat finds.
function generalPrompt(today: string): string {
  return [
    `You are the LEAD NEWS SCOUT for ${whoLabel()}. TODAY IS ${today}.`,
    "Use your web / browsing tools to find the 6 BIGGEST AI + tech stories that broke in the last 24 hours (48h absolute max), drawing across ALL of these source types — do not rely on any single site:",
    "- official AI lab blogs & release notes (OpenAI, Anthropic, Google / DeepMind, xAI, Meta, Mistral, DeepSeek, Qwen, Z.ai)",
    "- the tech press (TechCrunch, The Verge, VentureBeat, Ars Technica, Wired, The Information, Semafor)",
    "- aggregators & community (Techmeme, Hacker News, Reddit r/LocalLLaMA + r/MachineLearning)",
    "- research & releases (arXiv, Hugging Face, GitHub Trending, AI newsletters)",
    "Only include a story with a REAL article URL you can tell broke in the last 24-48h. NEVER invent a story, URL, date, or outlet.",
    "",
    "Return ONLY a JSON array (no prose, no commentary, no markdown fences) of up to 6 objects:",
    '[{"headline":"<=10 words","url":"https:// the real article link","source":"the outlet/site name","why_now":"1 sentence — the real news + who is driving it","posted":"e.g. \'2h ago\', \'this morning\'","category":"Models|Agents|Tools|SEO|Drama|Money"}]',
  ].join("\n");
}

// A scout: one agent researches its assignment autonomously, returns its raw stories (or []).
async function scout(agent: AgentName, prompt: string): Promise<RawStory[]> {
  const { args, input } = researchArgs(agent, prompt);
  const res = await run(agent, args, { timeoutMs: 200_000, input });
  return parseArray(res.stdout || "").map((x) => ({
    headline: String(x.headline || "").slice(0, 160),
    url: String(x.url || "").slice(0, 400),
    source: String(x.source || "").slice(0, 80),
    why_now: String(x.why_now || "").slice(0, 400),
    posted: String(x.posted || "").slice(0, 60),
    category: String(x.category || "Agents").slice(0, 20),
  })).filter((s) => s.headline);
}

const MERGE_SYS =
  "You are THE NEWS RADAR's editor. You are given raw story lists gathered by several research scouts, each covering a different slice of sources. " +
  "MERGE them into the day's most important AI + tech news for a creator/founder building with AI agents (audience: creators, agency owners, founders). " +
  "Remove duplicates (the same story from different outlets → keep the single best source). Drop anything not clearly from the last 24-48h. " +
  "Rank by RECENCY first, then by how big / widely-covered the story is.";

function mergeUser(stories: RawStory[], today: string): string {
  return [
    `TODAY IS ${today}.`,
    "RAW STORIES FROM THE SCOUTS (JSON):",
    JSON.stringify(stories).slice(0, 20000),
    "",
    "Return ONLY a JSON array (no prose, no markdown fences) of EXACTLY 6 objects, newest + biggest first. Each object:",
    "{",
    '  "headline": "<= 8 words naming the story",',
    '  "post_count": "short buzz indicator, e.g. \'widely covered\', \'480 HN pts\', or \'\' if unknown",',
    '  "why_now": "1-2 sentences: the real news + who is driving it",',
    '  "angle": "the user\'s unique content angle / hot take, 1 sentence",',
    '  "format": "Guide" | "Video" | "Short" | "Substack note",',
    '  "heat": integer 1-100,',
    '  "posted": "how long ago it broke, e.g. \'2h ago\', \'this morning\'",',
    '  "freshness": "short relative age, e.g. \'2h ago\', \'today\'",',
    '  "category": "Models" | "Agents" | "Tools" | "SEO" | "Drama" | "Money",',
    '  "handle": "the OUTLET / site name behind the link (no @), e.g. \'TechCrunch\', \'OpenAI Blog\', \'Hacker News\'",',
    '  "url": "the REAL https:// link to the primary article — a reputable outlet, NEVER an X/Twitter search page",',
    '  "sources": ["1-3 outlet names covering it"],',
    '  "hook": "a ready punchy opening line in the user\'s creator voice"',
    "}",
    "If the scouts found fewer than 6 solid stories, fill the rest with the next-biggest AI stories you are confident broke in the last few days, still with real article URLs. Output ONLY the JSON array.",
  ].join("\n");
}

// Minimal local-Ollama chat for the merge (think:false so reasoning models don't return empty).
async function ollamaMerge(sys: string, user: string): Promise<string> {
  const models = await ollamaModels().catch(() => [] as string[]);
  if (!models.length) throw new Error("Ollama has no models installed to merge with — pick Claude as the merger, or pull a model.");
  const model = models.find((m) => /coder|code|qwen|glm|minimax|llama/i.test(m)) || models[0];
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: "30m",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      options: { temperature: 0.3, num_predict: 2000 },
    }),
  });
  if (!r.ok) throw new Error(`Ollama merge HTTP ${r.status}`);
  const j = await r.json();
  return String(j?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// The full sweep: fan out scouts across beats, then merge. `merger` = "claude" | "ollama".
export async function gatherNews(now: Date, merger: string = "claude"): Promise<GatherResult> {
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const workers = RESEARCH_AGENTS.filter((a) => Boolean(config[a as keyof typeof config]));
  if (!workers.length) throw new Error("No research-capable agent is installed (need Claude, Codex, Cursor or Hermes).");

  // Claude (if present) runs a GENERAL scout for a reliable baseline; the other installed
  // agents each take a specialist beat for fresh diversity. No Claude → distribute all beats.
  const jobs: { agent: AgentName; prompt: string }[] = [];
  if (workers.includes("claude")) {
    jobs.push({ agent: "claude", prompt: generalPrompt(today) });
    workers.filter((a) => a !== "claude").forEach((a, i) => jobs.push({ agent: a, prompt: beatPrompt(BEATS[i % BEATS.length], today) }));
  } else {
    workers.forEach((a, i) => jobs.push({ agent: a, prompt: beatPrompt(BEATS[i % BEATS.length], today) }));
  }
  const settled = await Promise.allSettled(jobs.map((j) => scout(j.agent, j.prompt)));

  const stories: RawStory[] = [];
  const scouts = new Set<string>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) { stories.push(...r.value); scouts.add(jobs[i].agent); }
  });

  const user = mergeUser(stories, today);
  let rawJson: string;
  if (merger === "ollama") {
    rawJson = await ollamaMerge(MERGE_SYS, user);
  } else {
    rawJson = await cliComplete("claude", `${MERGE_SYS}\n\n${user}`, { timeoutMs: 150_000 });
  }
  return { rawJson, scouts: [...scouts], merger: merger === "ollama" ? "ollama" : "claude", found: stories.length };
}
