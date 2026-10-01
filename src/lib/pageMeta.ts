// Route → chapter metadata for the TopBar (Midnight Aubergine design system):
// a Roman numeral, a small-caps chapter label, the page title, and a one-line
// standfirst. See globals.css `.eyebrow` / `.page-title` / `.page-subtitle`.
//
// Deliberately plain data with no React imports, so the route table can be
// checked by a smoke without pulling in the component tree — the bug this file
// exists to prevent is exactly the kind that hides until someone opens a page.

export interface PageMeta { numeral: string; label: string; title: string; sub: string; }

// Roman numeral + chapter label per route (Midnight Aubergine design system).
// numeral renders in Caveat gold, label in small-caps UI face (--font-sans). See globals.css `.eyebrow`.
export const TITLES: Record<string, PageMeta> = {
  "/":            { numeral: "I.",    label: "Mission Control",    title: "Mission Control",         sub: "Status of every agent, every memory, every signal." },
  "/claude":      { numeral: "II.",   label: "Agent · Claude",     title: "Claude",                  sub: "Direct streaming channel to your Claude Code CLI. Voice in, auto-logged to Obsidian." },
  "/openclaw":    { numeral: "III.",  label: "Agent · OpenClaw",   title: "OpenClaw",                sub: "Chat one-shot or open the control room. Logged to your vault." },
  "/hermes":      { numeral: "IV.",   label: "Agent · Hermes",     title: "Hermes",                  sub: "Nous Research agent. Sessions, skills, kanban — and a chat line." },
  "/antigravity": { numeral: "V.",    label: "Agent · Antigravity",title: "Antigravity",             sub: "Gemini CLI's successor. Go-based, multi-agent harness, plugins, async workflows." },
  "/codex":       { numeral: "VII.",  label: "Agent · Codex",      title: "Codex",                   sub: "OpenAI's coding agent. Chat, set long-running goals, preview anything it builds." },
  "/cursor":      { numeral: "VII.",  label: "Agent · Cursor",     title: "Cursor",                  sub: "Cursor's agent CLI, signed in on your subscription. Chat, write code, build — no API key." },
  "/pi":          { numeral: "VIII.", label: "Agent · Pi",         title: "Pi",                      sub: "A local coding-assistant CLI wired to your Ollama Cloud model (glm-5.2). Chat and build — no API key." },
  "/freeclaude":  { numeral: "VIII.", label: "Agent · Free Claude Code", title: "Free Claude Code",  sub: "Open-source proxy. Same Claude CLI, routed through OpenRouter / Owl Alpha." },
  "/fusion":      { numeral: "VIII.", label: "Agent · Fusion",     title: "Fusion Boardroom",        sub: "OpenRouter Fusion — a panel of models deliberates with web search, then a judge writes the verdict. For the calls where being wrong is expensive." },
  "/sakana":      { numeral: "VIII.", label: "Agent · Sakana",     title: "Sakana Fugu",             sub: "A vendor-agnostic council — a panel of models deliberates in parallel with web search, then a judge weighs it all and writes the verdict. Collective intelligence, not one model's guess." },
  "/local":       { numeral: "VIII.", label: "Agent · Local",      title: "Local",                   sub: "Whatever model you've pinned warm in Ollama, running 100% on your machine — offline, free, instant. Build with your voice, preview live." },
  "/engine":      { numeral: "VIII.", label: "Agent · Local Engine", title: "The Local Hermes Engine", sub: "A real agent on your machine — Hermes's local profile, fully offline. Give it a task by voice or text; it runs commands and builds files, and you watch what it makes appear live. Free, private, nothing leaves the machine." },
  "/agent-kanban":{ numeral: "VIII.", label: "Agent · Kanban",       title: "Agent Kanban",            sub: "A team of local offline agents works a live board: the Planner breaks your goal into cards, the Builder builds each one, the Reviewer checks it really landed — and every Done card previews live. 100% on your machine." },
  "/room":        { numeral: "IX.",   label: "Self · Mastermind",  title: "AI Agent Mastermind",     sub: "A live group chat with all your agents — each one a different real model. They read your vault, reply in turn, riff off each other, and can save notes or start projects. Tag one with @claude." },
  "/pipeline":    { numeral: "X.",    label: "Self · Pipeline",    title: "From Inbox to Shipped",   sub: "Capture an idea → agents classify, route + plan it → you approve once → a PM + subagents build it. Lives in your vault." },
  "/loop":        { numeral: "X.",    label: "Self · Loop",        title: "Loop Engineering",        sub: "Define what 'done' looks like. A CLI builder acts, a separate CLI judge verifies it adversarially, and it loops until the gate passes — you stop being the loop." },
  "/goals":       { numeral: "X.",    label: "Self · Goals",       title: "Goals",                   sub: "Set targets. Tick them off. Watch the bar fill. Saved to Goals.md." },
  "/seo":         { numeral: "X.",    label: "Self · SEO Pipeline",title: "SEO Content Pipeline",    sub: "Pick a keyword + transcript. Generate 5 unique articles. Deploy to your Netlify funnel." },
  "/radar":       { numeral: "X.",    label: "Self · Radar",       title: "The Radar",               sub: "A 24/7 watcher on AI news + X. Hermes searches X live (Grok OAuth), ranks what's actually trending, and hands you the post-it-today story — with the source tweet, your angle and a ready hook. Sweeps every morning, logs to Obsidian." },
  "/opendesign":  { numeral: "X.",    label: "Self · Open Design", title: "Open Design",             sub: "The local-first, open-source Claude Design alternative — embedded right here. Generate prototypes, dashboards, decks, images and motion graphics on your own machine, driving your own agents." },
  "/games":       { numeral: "XI.",   label: "Workflow · Game Agent", title: "Game Studio",        sub: "The Coding Video Game Agent — describe a game, it builds it, you play it on the shelf." },
  "/studio":      { numeral: "XI.",   label: "Self · Studio",      title: "Studio",                  sub: "Generate images, videos and speech with Hermes. Voice in, preview inline, save to vault." },
  "/thumbnails":  { numeral: "XI.",   label: "Self · Thumbnails",  title: "Thumbnail Studio",        sub: "Upload a thumbnail + say what to improve → gpt-image-2 makes better versions. Every round is logged to your vault so it learns your style." },
  "/notebook":    { numeral: "XII.",  label: "Self · Notebook",    title: "Notebook",                sub: "Your NotebookLM notebooks, audio overviews and chats — all in one place, synced to Obsidian." },
  "/hermes3d":    { numeral: "XI.",   label: "Self · Hermes 3D",   title: "Hermes 3D",               sub: "The baked Synty office in three.js. Seats are anchored; agents in them is the next slice." },
  "/openmontage": { numeral: "XI.",   label: "Self · OpenMontage", title: "OpenMontage",             sub: "Your checkout of the agentic video production system. Pick a pipeline, give it a brief, and your CLI agent produces the video while the tray shows every step." },
  "/kanban":      { numeral: "XIII.", label: "Self · Kanban",      title: "Kanban",                  sub: "Hermes Agent multi-agent board. Drop a prompt into triage, watch the orchestrator decompose + assign." },
  "/journal":     { numeral: "XIV.",  label: "Self · Journal",     title: "Journal",                 sub: "Daily entries with voice or text. One markdown file per day." },
  "/memory":      { numeral: "XV.",   label: "Self · Memory",      title: "Memory",                  sub: "Search 1261 Omi memories + your Obsidian vault." },
  "/guide":       { numeral: "XVI.",  label: "Build · Your Own",   title: "Build Your Own",          sub: "Step-by-step guide. Anyone can follow it. Share with your community." },

  // ── V2 (CORE) + the modules added after this map was first written ────────
  // Every route below used to fall through to Mission Control, because the
  // lookup was exact-match with TITLES["/"] as the fallback. See metaFor().

  // Workspace
  "/integrations":  { numeral: "I.",    label: "Workspace · Integrations", title: "Integrations",   sub: "Gmail, Calendar, Notion, GitHub, Slack and Buzz — accounts, tools, activity, and the rules that decide what reaches memory." },
  "/automations":   { numeral: "I.",    label: "Workspace · Automations",  title: "Automations",    sub: "When [trigger], if [conditions], then [actions]. Deterministic by design: whitelisted conditions and template substitution, never arbitrary code." },
  "/anynotes":      { numeral: "I.",    label: "Workspace · AnyNotes",     title: "AnyNotes",       sub: "Capture anything — a tweet, an article, a video, a screenshot, a thought — then talk to Jarvis about it in the note's own thread." },
  "/newsletter":    { numeral: "I.",    label: "Workspace · Newsletter",   title: "Newsletter",     sub: "Every newsletter gets its own alias. Stories several of them ran show up once, with a chip per source." },

  // Agents — the OS's core primitive
  "/agents":        { numeral: "II.",   label: "Agents · Fleet",           title: "Agents",         sub: "Reusable background agents — your tools, your subscriptions, your machine. Runs pause for approval before anything leaves the box." },

  // Agent Orchestration
  "/paperclip":     { numeral: "III.",  label: "Orchestration · Paperclip",   title: "Paperclip",      sub: "The agent company, running beside the dashboard on its own port." },
  "/deals":         { numeral: "III.",  label: "Orchestration · Deal Desk",   title: "Deal Desk",      sub: "Scraped gigs in, scored and researched, out as a pitch you can send. The action queue is the point." },
  "/hire":          { numeral: "III.",  label: "Orchestration · Hire Engine", title: "Hire Engine",    sub: "The Deal Desk pipeline, pointed at salaried postings instead of gigs." },
  "/marketing":     { numeral: "III.",  label: "Orchestration · Marketing",   title: "Marketing Hub",  sub: "The command center for YouTube, short-form and blog across your properties — approval-gated before anything deploys." },
  "/audit":         { numeral: "III.",  label: "Orchestration · Audit",       title: "Audit Console",  sub: "Run a business audit end to end and watch the chain work, live." },
  "/brainstorm":    { numeral: "III.",  label: "Orchestration · Brainstorm",  title: "Brainstorm",     sub: "A three-seat ideation council — Claude, ChatGPT and Kimi. Topic in, project brief out." },
  "/idea-engine":   { numeral: "III.",  label: "Orchestration · Idea Engine", title: "Idea Engine",    sub: "Trend surfacing, then evidence-first validation, then a dossier worth acting on." },
  "/jarvis":        { numeral: "III.",  label: "Orchestration · Jarvis",      title: "Jarvis",         sub: "The voice butler — standalone, with a persona you edit as data rather than as prompt code." },
  "/browser":       { numeral: "III.",  label: "Orchestration · Browser",     title: "Agent Browser",  sub: "Isolated Chromium sessions an agent can drive, a live view you can watch, and a headed handoff when you want the keys back." },

  // CLI Agents
  "/ollama":        { numeral: "VIII.", label: "Agent · Ollama Cloud",     title: "Ollama Cloud",   sub: "Your Ollama Cloud models on tap — no vendor key, no local GPU." },

  // Self
  "/tasks":         { numeral: "X.",    label: "Self · Tasks",             title: "Tasks",          sub: "List, calendar and board over one task engine — subtasks, recurrence, and approval gates before an agent acts." },
  "/today":         { numeral: "X.",    label: "Self · Today",             title: "Today",          sub: "The daily page. Tick a checkbox and it becomes a task; mention @jarvis and it answers in place." },
  "/webmcp":        { numeral: "X.",    label: "Self · WebMCP",            title: "WebMCP Engine",  sub: "Build, test, version and publish MCP tool packages. The exporter embeds no secrets, by construction." },
  "/skills":        { numeral: "X.",    label: "Self · Skills",            title: "Skills",         sub: "Standing policies injected into task plans, task steps and Jarvis — model-agnostic, applied in order." },
  "/leads":         { numeral: "X.",    label: "Self · Leads",             title: "Leads",          sub: "The scraped-and-scored list the Deal Desk and Hire Engine both draw from." },
  "/content-engine":{ numeral: "XI.",   label: "Self · Content Engine",    title: "Content Engine", sub: "Calendar to materials to metrics, as one loop." },
  "/video":         { numeral: "XI.",   label: "Self · Video",             title: "Video Studio",   sub: "Script, generate and assemble video without leaving the OS." },
  "/music":         { numeral: "XI.",   label: "Self · Music",             title: "Music Studio",   sub: "Generate tracks and build out an album." },
  "/terminal":      { numeral: "XII.",  label: "Self · Terminal",          title: "Terminal",       sub: "A real shell in the dashboard — PTY-backed, streamed over SSE." },
  "/seo-guide":     { numeral: "XII.",  label: "Build · SEO Guide",        title: "SEO Guide",      sub: "The written playbook behind the SEO pipeline." },
};

/**
 * Route → chapter metadata.
 *
 * This was `TITLES[pathname] ?? TITLES["/"]`, which meant any route missing from
 * the map claimed to BE Mission Control — silently, and on every module added
 * after the map was written. Three steps now, in descending confidence:
 *
 *   1. the exact route
 *   2. its parent, so /agents/<id> reads as Agents instead of as the homepage
 *   3. the route's own name, title-cased from the path
 *
 * Step 3 is the one that matters: an unlisted module should read as unfinished,
 * never as a different page. Only "/" itself resolves to Mission Control.
 */
export function metaFor(pathname: string): PageMeta {
  const exact = TITLES[pathname];
  if (exact) return exact;

  const segments = pathname.split("/").filter(Boolean);
  const fromParent = TITLES[`/${segments[0] ?? ""}`];
  if (fromParent) return fromParent;

  const slug = segments[0];
  if (!slug) return TITLES["/"];
  const named = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { numeral: "", label: named, title: named, sub: "" };
}
