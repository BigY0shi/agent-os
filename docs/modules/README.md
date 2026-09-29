# Module docs

One file per module. `cli-agents.md` covers all the CLI agent tabs together, because they differ only in which binary they shell out to.

## How to write one (read before adding a file)

You are an agent. The rule that matters more than the format:

**Read the module before you write about it.** Its routes under `src/app/api/<slug>/`, its lib under `src/lib/` or `src/lib/v2/<slug>/`, and its component. A doc that describes plausible behaviour rather than actual behaviour is worse than no doc, because someone will act on it. If you cannot verify a claim, leave it out or mark it unknown.

Each file covers:

1. **Route, backend, UI** on one line, so a reader can jump straight to the code.
2. **What it actually does** — the mechanism, not the pitch. Where does data come from, where does state live, what survives a restart.
3. **Setup** — what it needs before it works, and what "empty" looks like versus "broken". Most of these modules render an empty shell when a file or key is missing, and that distinction is the single most useful thing you can write down.
4. **Routes** — a table. Mark the one people actually use.
5. **Prompts that work** — real examples, not `<your prompt here>`. For modules with a fixed internal prompt, document what the user CAN steer instead.
6. **Gotchas** — the things that cost someone an hour. Cost, silent failure modes, anything counterintuitive that is deliberate.

Keep it in the project voice: plain, specific, no hype. State costs and limits rather than hiding them.

## Index

All 50 sidebar modules are written against the code (2026-09-29). Each has a controls table (every tab and control, named as it appears on screen) and a "How it works" section. The same files render in the app's Guide at `/guide`; the general pages are in [../guide](../guide/).

| Module | Route | Doc |
|---|---|---|
| Mission Control | `/` | [mission-control.md](mission-control.md) |
| Agent Kanban | `/agent-kanban` | [agent-kanban.md](agent-kanban.md) |
| Agents | `/agents` | [agents-page.md](agents-page.md) |
| AI Agent Mastermind | `/room` | [room.md](room.md) |
| Antigravity | `/antigravity` | [antigravity.md](antigravity.md) |
| AnyNotes | `/anynotes` | [anynotes.md](anynotes.md) |
| Audit Console | `/audit` | [audit.md](audit.md) |
| Automations | `/automations` | [automations.md](automations.md) |
| Brainstorm | `/brainstorm` | [brainstorm.md](brainstorm.md) |
| Browser | `/browser` | [browser.md](browser.md) |
| Claude | `/claude` | [claude-cli.md](claude-cli.md) |
| Codex | `/codex` | [codex.md](codex.md) |
| Content Engine | `/content-engine` | [content-engine.md](content-engine.md) |
| Cursor | `/cursor` | [cursor.md](cursor.md) |
| Deal Desk | `/deals` | [deal-desk.md](deal-desk.md) |
| Free Claude Code | `/freeclaude` | [freeclaude.md](freeclaude.md) |
| Fusion | `/fusion` | [fusion.md](fusion.md) |
| Game Studio | `/games` | [games.md](games.md) |
| Hermes | `/hermes` | [hermes.md](hermes.md) |
| Hermes 3D | `/hermes3d` | [hermes3d.md](hermes3d.md) |
| Hire Engine | `/hire` | [hire.md](hire.md) |
| Idea Engine | `/idea-engine` | [idea-engine.md](idea-engine.md) |
| Integrations | `/integrations` | [integrations.md](integrations.md) |
| Jarvis | `/jarvis` | [jarvis.md](jarvis.md) |
| Kanban | `/kanban` | [kanban.md](kanban.md) |
| Leads | `/leads` | [leads.md](leads.md) |
| Local | `/local` | [local.md](local.md) |
| Local Engine | `/engine` | [engine.md](engine.md) |
| Loop | `/loop` | [loop.md](loop.md) |
| Marketing Hub | `/marketing` | [marketing.md](marketing.md) |
| Memory | `/memory` | [memory.md](memory.md) |
| Music | `/music` | [music.md](music.md) |
| Newsletter | `/newsletter` | [newsletter.md](newsletter.md) |
| Notebook | `/notebook` | [notebook.md](notebook.md) |
| Ollama Cloud | `/ollama` | [ollama.md](ollama.md) |
| Open Design | `/opendesign` | [opendesign.md](opendesign.md) |
| OpenClaw | `/openclaw` | [openclaw.md](openclaw.md) |
| Paperclip | `/paperclip` | [paperclip.md](paperclip.md) |
| Pi | `/pi` | [pi.md](pi.md) |
| Pipeline | `/pipeline` | [pipeline.md](pipeline.md) |
| Rabbit R1 | `/rabbit` | [rabbit.md](rabbit.md) |
| Sakana Fugu | `/sakana` | [sakana.md](sakana.md) |
| SEO | `/seo` | [seo.md](seo.md) |
| Skills | `/skills` | [skills.md](skills.md) |
| Tasks | `/tasks` | [tasks.md](tasks.md) |
| Terminal | `/terminal` | [terminal.md](terminal.md) |
| Thumbnails | `/thumbnails` | [thumbnails.md](thumbnails.md) |
| Today | `/today` | [today.md](today.md) |
| Video | `/video` | [video.md](video.md) |
| WebMCP | `/webmcp` | [webmcp.md](webmcp.md) |

Two files carry a suffix on purpose: `claude-cli.md` and `agents-page.md`. On Windows, filenames ignore case, so a doc named `claude.md` or `agents.md` would be loaded by the agent CLIs as a `CLAUDE.md` / `AGENTS.md` instruction file for anyone working in this folder. `scripts/v2/smoke-guide.mjs` fails if such a name comes back.
