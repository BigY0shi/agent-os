// NEWS DIGEST — ask "what's new in <anything>" and get a briefing.
//
// You type a topic (AI, Nvidia, F1, your city, a company, a hobby — anything). We fan out
// research SCOUTS (your installed CLI agents — Claude / Codex / Cursor / Hermes — each with
// its own web tools) to search recent coverage from different angles, in parallel. A MANAGER
// then distills it into a punchy "here's the hot news" overview + the key stories with links.
//
// Same manager→worker fan-out as the old radar, but topic-driven and output as a readable
// digest instead of content "signals". Ollama can't browse, so it's only ever the MANAGER.

import { run, type AgentName } from "@/lib/runner";
import { config, CLAUDE_MODEL } from "@/lib/config";
import { cliComplete } from "@/lib/loopEngine";
import { ollamaModels } from "@/lib/pipeline";

const RESEARCH_AGENTS: AgentName[] = ["claude", "codex", "cursor", "hermes"];

// Topic-relative angles for the specialist scouts, so it works for ANY subject.
const ANGLES = [
  "breaking news, announcements and headlines",
  "expert analysis, commentary & community discussion — Reddit, forums, blogs, newsletters, YouTube",
  "primary & official sources — the organizations or people involved, official releases, and any data or papers",
];

export interface DigestStory { headline: string; url: string; source: string; why_now: string; posted: string; }
export interface DigestItem { headline: string; summary: string; url: string; source: string; posted: string; }
export interface DigestResult { overview: string; items: DigestItem[]; scouts: string[]; merger: string; found: number; }

function researchArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude": return { args: ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", "--dangerously-skip-permissions"], input: prompt };
    case "codex":  return { args: ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor": return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "hermes": return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:       return { args: ["-p", prompt] };
  }
}

function parseArray(raw: string): Record<string, unknown>[] {
  let s = (raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("["); const b = s.lastIndexOf("]");
  if (a === -1 || b === -1 || b < a) return [];
  try { const arr = JSON.parse(s.slice(a, b + 1)); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

function parseObj(raw: string): { overview: string; items: DigestItem[] } | null {
  let s = (raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { overview?: unknown; items?: unknown };
    const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]).map((x) => ({
      headline: String(x.headline || "").slice(0, 160),
      summary: String(x.summary || "").slice(0, 400),
      url: String(x.url || "").slice(0, 400),
      source: String(x.source || "").slice(0, 80),
      posted: String(x.posted || "").slice(0, 60),
    })).filter((x) => x.headline) : [];
    return { overview: String(o.overview || "").slice(0, 1600), items };
  } catch { return null; }
}

function generalScoutPrompt(topic: string, today: string): string {
  return [
    `You are a NEWS SCOUT researching what's new about: "${topic}". TODAY IS ${today}.`,
    "Your focus: the biggest recent developments overall, across all reputable sources.",
    "Use your web / browsing tools to find the most RECENT, notable items — ideally the last few days (last 24-48h for fast-moving topics).",
    "Real article URLs only; verify recency; NEVER invent a story, URL, date or outlet. An empty array is fine if nothing is new.",
    "",
    "Return ONLY a JSON array (no prose, no commentary, no markdown fences) of up to 8 objects:",
    '[{"headline":"<=12 words","url":"https:// the real article link","source":"site/outlet name","why_now":"1 sentence — what happened + why it matters","posted":"e.g. \'3h ago\', \'2 days ago\'"}]',
  ].join("\n");
}

function topicScoutPrompt(topic: string, angle: string, today: string): string {
  return [
    `You are a NEWS SCOUT researching what's new about: "${topic}". TODAY IS ${today}.`,
    `Your focus: ${angle}.`,
    "Use your web / browsing tools to find the most RECENT, notable items about this topic from your focus area — ideally the last few days (last 24-48h for fast-moving topics).",
    "Real article URLs only; verify recency; NEVER invent a story, URL, date or outlet. An empty array is fine if nothing is new.",
    "",
    "Return ONLY a JSON array (no prose, no commentary, no markdown fences) of up to 6 objects:",
    '[{"headline":"<=12 words","url":"https:// the real article link","source":"site/outlet name","why_now":"1 sentence — what happened + why it matters","posted":"e.g. \'3h ago\', \'2 days ago\'"}]',
  ].join("\n");
}

async function scout(agent: AgentName, prompt: string): Promise<DigestStory[]> {
  const { args, input } = researchArgs(agent, prompt);
  const res = await run(agent, args, { timeoutMs: 200_000, input });
  return parseArray(res.stdout || "").map((x) => ({
    headline: String(x.headline || "").slice(0, 160),
    url: String(x.url || "").slice(0, 400),
    source: String(x.source || "").slice(0, 80),
    why_now: String(x.why_now || "").slice(0, 400),
    posted: String(x.posted || "").slice(0, 60),
  })).filter((s) => s.headline);
}

const SUMMARY_SYS =
  "You are a sharp, plugged-in news editor writing a punchy 'what's new' briefing for a curious, busy reader. " +
  "You are given recent items gathered by several research scouts on a topic. Distill the hot news RIGHT NOW: what's dominating, " +
  "what actually matters, and the juicy or important details. Be lively and conversational, never corporate or hedgy. " +
  "Merge duplicates, drop anything stale or off-topic, and keep only real items with real links.";

function summaryUser(topic: string, stories: DigestStory[], today: string): string {
  return [
    `TOPIC: "${topic}"`,
    `TODAY IS ${today}.`,
    "RECENT ITEMS FROM THE SCOUTS (JSON):",
    JSON.stringify(stories).slice(0, 20000),
    "",
    "Return ONLY a JSON object (no prose, no markdown fences):",
    "{",
    '  "overview": "2-4 punchy sentences on the big picture — what is the hot story / the vibe right now for this topic",',
    '  "items": [ up to 8 objects, newest & biggest first: {',
    '     "headline": "<=12 words",',
    '     "summary": "1-2 lively sentences — what happened + why it matters / the goss",',
    '     "url": "the real article link",',
    '     "source": "site/outlet name",',
    '     "posted": "relative age, e.g. \'3h ago\', \'2 days ago\'"',
    "  } ]",
    "}",
    "If the scouts returned little, still give your best real briefing on what is genuinely new for this topic. Output ONLY the JSON object.",
  ].join("\n");
}

async function ollamaMerge(sys: string, user: string): Promise<string> {
  const models = await ollamaModels().catch(() => [] as string[]);
  if (!models.length) throw new Error("Ollama has no models installed to summarize with — pick Claude, or pull a model.");
  const model = models.find((m) => /coder|code|qwen|glm|minimax|llama/i.test(m)) || models[0];
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: "30m",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      options: { temperature: 0.4, num_predict: 2200 },
    }),
  });
  if (!r.ok) throw new Error(`Ollama summarize HTTP ${r.status}`);
  const j = await r.json();
  return String(j?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// The full digest: fan out topic scouts, then summarize. `merger` = "claude" | "ollama".
export async function gatherDigest(topic: string, merger: string = "claude"): Promise<DigestResult> {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const workers = RESEARCH_AGENTS.filter((a) => Boolean(config[a as keyof typeof config]));
  if (!workers.length) throw new Error("No research-capable agent is installed (need Claude, Codex, Cursor or Hermes).");

  // Claude (if present) runs a broad general scout; the others each take a topic angle.
  const jobs: { agent: AgentName; prompt: string }[] = [];
  if (workers.includes("claude")) {
    jobs.push({ agent: "claude", prompt: generalScoutPrompt(topic, today) });
    workers.filter((a) => a !== "claude").forEach((a, i) => jobs.push({ agent: a, prompt: topicScoutPrompt(topic, ANGLES[i % ANGLES.length], today) }));
  } else {
    workers.forEach((a, i) => jobs.push({ agent: a, prompt: topicScoutPrompt(topic, ANGLES[i % ANGLES.length], today) }));
  }
  const settled = await Promise.allSettled(jobs.map((j) => scout(j.agent, j.prompt)));

  const stories: DigestStory[] = [];
  const scouts = new Set<string>();
  settled.forEach((r, i) => { if (r.status === "fulfilled" && r.value.length) { stories.push(...r.value); scouts.add(jobs[i].agent); } });

  const user = summaryUser(topic, stories, today);
  const raw = merger === "ollama"
    ? await ollamaMerge(SUMMARY_SYS, user)
    : await cliComplete("claude", `${SUMMARY_SYS}\n\n${user}`, { timeoutMs: 150_000 });

  const parsed = parseObj(raw) || { overview: raw.slice(0, 1200), items: [] };
  // If the manager gave prose but no structured items, fall back to the scouts' raw stories.
  if (!parsed.items.length && stories.length) {
    parsed.items = stories.slice(0, 8).map((s) => ({ headline: s.headline, summary: s.why_now, url: s.url, source: s.source, posted: s.posted }));
  }
  return { overview: parsed.overview, items: parsed.items, scouts: [...scouts], merger: merger === "ollama" ? "ollama" : "claude", found: stories.length };
}
