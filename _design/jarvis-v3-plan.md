# Jarvis v3, Mission Control, per-module skills, memory off Honcho

Requested 2026-09-28 by the owner, in five messages the same evening, with reference
screenshots (a "Jarvis v2" HUD with Claude/Astra faces, an "Agentic OS v2" glass
dashboard, a "Your skills" picker) and a third-party prompt pack (NEXORA, diffed in
`_design/nexora-diff.md`). The screenshots and the pack are references, not specs
(global rule 27): the owner's words below are the spec.

## Owner's words, condensed

1. Info cards across the OS get a glass-neumorphism look over the existing floating
   particle background. Nail it in Jarvis first, then extrapolate.
2. Agent faces with state animation. Jarvis = the "mind map" / starfield plexus (the
   green Claude image) but PURPLE when idle and ELECTRIC BLUE when replying, in-between
   shades for the other states. Oracle = the white galaxy swirl (Astra). News Radar gets
   its own unique face.
3. Move Oracle, News Radar and Outreach from the Hermes module into Jarvis.
4. New Jarvis tabs: Sessions (resume past conversations); MCP (installed, available,
   click-through install wizard); Control Room (statuses, workflows, skills, plugins,
   insights and ALL settings for ALL agents and modules; view WSP, see which are
   active, activate/deactivate per module, add new); Goal Mode (like Hermes Goal Mode,
   but models and subagents of his choice, Jarvis fans out subagents per the agent
   orchestration skill, max 50 turns each, own scratch dir).
5. Mission Control (home) reconfigured like the glass dashboard reference: information
   on first load, organised, several views; the giant scratchpad no longer in the way.
6. VERY IMPORTANT: activate/deactivate Skills and Workflows on every module
   individually, by a pop-up on each module or via Jarvis.
7. Honcho is down for good. Move the memory system or tweak it.
8. Diff against NEXORA and implement what we lack, selectively, plus its aesthetics.

## Decisions taken without asking (reversible, stated so they can be overruled)

- **Faces are one three.js component, three variants.** `AgentFace` with
  `variant: "constellation" | "galaxy" | "radar"` and `state: idle | listening |
  thinking | working | speaking | error`. Colour and motion come from state, never
  from a timer: a face only animates "working" while a real request is in flight.
- **Jarvis palette ramp:** idle violet `#8b5cf6` -> listening indigo `#6366f1` ->
  thinking `#4f7cff` -> working `#3b9bff` -> speaking electric blue `#22d3ff`; error red.
- **"Workflows" are a new first-class thing:** a saved, runnable recipe (name, prompt
  template, optional input, agent) shown as a one-click button, like the reference's
  Plan Today / Inbox Brief. "Skills" stay the existing SKILL.md files
  (`~/.agentic-os/skills`, `settings.skills`). Both get per-module activation in
  settings; a module's popup shows only what is REAL: a module whose routes never call
  `withSkills` is labelled "skills not wired here" rather than showing a toggle that
  does nothing.
- **The per-module popup mounts once, in the Shell,** keyed to the current route, so
  every module gets it without 48 edits. Jarvis gets a `module_skills` tool for voice.
- **MCP tab manages Jarvis's own MCP servers** (`settings.jarvis.mcpServers`), passed to
  the SDK brain. Installed servers default DISABLED and are marked ungated, because
  anything they do bypasses the Human-Gate and taint rules that Jarvis's own tools obey.
  Claude Code's and Hermes's MCP servers are shown read-only for reference.
- **Goal Mode spawns CLI agents** (claude -p, codex exec, hermes chat, agy -p) in
  `~/.agentic-os/jarvis-goals/<goal>/<seat>/`, each capped at 50 turns where the CLI
  has a turn flag, and says plainly which CLIs have no turn cap. A planner step splits
  the goal into seat briefs first; the owner sees and can edit the plan before launch.
- **Memory hub = Agent OS Memory V2**, already self-hosted (SQLite + local Ollama
  embeddings), exposed to Claude Code and Hermes over the existing `/api/mcp` endpoint
  as memory_search / memory_ingest. The Honcho plugin is disabled only after the
  replacement is verified.

## Art direction (skill: build-awwwards-quality-sites + blue-laser-clean-glass-layout)

Owner asked for the awwwards skill on 2026-09-28. That skill targets marketing sites;
its art-direction, motion and WebGL-hygiene rules apply here, its page structure does not.

- **Visual thesis:** a quiet observatory. Dark glass instruments float over a field of
  drifting light, and each agent is a distinct celestial body whose motion says what it
  is doing. The face is always the focal asset; everything else is instrument panel.
- **Type (redesigned 2026-09-28, owner: NEXORA looks "eerily similar", redo all typography):**
  display = Unbounded (wide geometric, light, nearly untracked) for page titles and agent
  names; UI and body = Geist; data and code = Geist Mono with tabular figures. All three
  self-hosted by next/font (Bricolage, Manrope and JetBrains Mono dropped from the Google
  Fonts link; only Caveat still loads from Google). Eyebrows move off wide-tracked mono
  (NEXORA's signature) to semibold UI face at 0.07em. Tokens: `--font-display`,
  `--font-sans`, `--font-mono`; classes `.type-display`, `.type-figure`; every h1 is display.
- **Colour:** near-black base with a blue undertone; neutral dark-glass surfaces. Colour
  is reserved for meaning: Jarvis's violet-to-electric-blue state ramp and active
  indicators, the Oracle's white, News Radar's amber. The pale frosted tile
  (`.glass-frost`) is the owner's reference for KPI stats, used there only; the glass
  skill's "no white cards" rule is overruled by the owner's reference, narrowly.
- **Motion:** GSAP is the choreography layer for new surfaces (tab entrance: face
  settles, cards rise with a short stagger; page title word reveal). CSS handles hover
  and focus. framer-motion stays where it already lives. Under reduced motion every
  final state renders immediately.
- **Smooth scroll: none.** Lenis and Locomotive were evaluated and rejected: this is an
  app shell with independently scrolling panels, and a scroll-jacking engine would fight
  them and Jarvis's screen-control bridge. Deliberate deviation from the skill.
- **Three.js:** justified for the faces only, one canvas one responsibility, plus the
  existing global particle field. DPR capped, paused when hidden or offscreen, no
  per-frame allocation, context loss handled, static CSS poster when WebGL is missing.
- **Assets:** no raster imagery; faces are procedural shader art. Icons stay lucide-react
  for consistency with the ~48 existing modules (deviation from the skill's Solar/Iconify,
  which would also reach an external API at runtime unless bundled).
- **Glass restraint:** cards, tab bars and the chat well get glass; text, rows and chips
  do not.

## Slices, in build order

| Slice | What | Depends on |
|---|---|---|
| S11 | Glass-neumorphism card tokens + working `GlassCard`; `AgentFace` (3 variants, 6 states) | - |
| S12 | Jarvis tab shell; Console tab with the Jarvis face on real phase; Oracle, News Radar, Outreach moved in from Hermes with their faces | S11 |
| S13 | Sessions tab: search, resume, rename, archive, restore | S12 |
| S14 | Per-module Skills + Workflows: store, `/api/skills`, popup in Shell, Jarvis tool, honest "not wired" labels | S11 |
| S15 | Control Room tab: service health, agents, runs, WSP matrix, insights, settings for every module | S14 |
| S16 | MCP tab: installed / available / wizard for Jarvis's own servers | S12 |
| S17 | Goal Mode as NEXORA-style Missions (owner's screenshots 2026-09-28, "essentially a dedicated Goal Mode"). Create-a-mission wizard: (1) brief: name, objective (deliverable + what success looks like), priority, optional target date; (2) team: "Jarvis picks the team" (recommended; you approve the team and plan before anything runs) or "I'll choose" from the crew with each agent's model/CLI; (3) review and launch: time limit (15 min to 8 h), maximum steps, report length, and what happens at the end ("send me the result to review first" or deliver). Page: headline count of decisions waiting on you; stats (waiting on you, cycle time, on-time %, agents at work, all measured); IN FOCUS mission with its steps, crew rationale and a time-limit ring; YOUR DESK (approve plan / accept result / send back with a note); four stage columns BRIEFING / IN PROGRESS / REVIEW / DELIVERED. Each seat runs its CLI in its own scratch dir capped at 50 turns (`claude -p --max-turns 50`, `hermes chat --max-turns 50`; codex/agy have no turn flag and are bounded by the time limit, said so in the UI). Plan and results persist; STOP works. Mission detail keeps the history of the agents' work (owner, 2026-09-28): steps with a LIVE marker and dependencies ("Data waits for Research"), team rationale, guardrails, and a WHAT HAPPENED, IN ORDER timeline of real events: launched, plan ready, you approved, Jarvis -> agent hand-off with THE BRIEF IT WAS SENT (expandable), waiting on a dependency, picked up, last heard N s ago (from the child's actual output), finished / failed. Append-only event log per mission. | S12 |
| S18 | Mission Control home: glass overview with real data, views, scratchpad moved down. Owner likes the NEXORA cockpit telemetry (screenshots 2026-09-28): a ring gauge of total runs, success-rate sparkline, average execution time, host CPU / RAM / disk bars with a plain status word, an orchestration tree (Jarvis over each agent with its load), mission states (queued / running / retrying / parked), per-agent load bars. Every number from a real source (moduleRuns, agent runs, goal stores, `os` + `fs.statfs` for the host); a metric with no source is left out, not faked. Adds the host-health endpoint NEXORA has and we lack, with a NEXORA-style "System pulse" view: processor / memory / disk / network gauges, what is holding the machine (top processes by CPU and RAM), and a diagnostics checklist (N of M checks clear: disk, memory headroom, CPU load, each local service, each agent's model reachable). | S11, S14 |
| S19 | Memory off Honcho: Agent OS memory over MCP for Claude Code + Hermes | - |
| S22 | Voice Mode with a per-agent roster (owner's NEXORA screenshots, 2026-09-28): pick who you are talking to (Jarvis, Oracle, Hermes, each crew agent) from a selection dial, the elliptical rotating card carousel from NEXORA's "Hand mode", driven by mouse/keyboard/voice, NOT by camera hand-tracking (owner: "I don't care about the camera->hand control"). The chosen agent's face fills the stage; conversation panel beside it; suggested prompts. Reuses Parakeet STT + Kokoro TTS + the overlay ask lane. | S11, S21 |
| S23 | Mission board (NEXORA "4 decisions need you"): left column WAITING ON YOU (plans to approve, results to read; from Goal Mode plans + the v2 approvals queue), a centre ring of live missions segmented IN FLIGHT / REVIEW / BLOCKED / DELIVERED with real counts, right column DELIVERED, and a detail panel with brief, crew, steps and result. | S17 |
| S24 | Crew archive (NEXORA "Crew archive"): one searchable, filterable wall of every document the agents produced (goal outputs, Oracle consultations, News Radar digests, Deal/Hire proposals, Jarvis conversations), each card with source, author agent, word count and date; reader pane with metadata sidebar. Read-only index over the existing stores, no copies. | S17 |
| S25 | AI Agent Mastermind as the crew chat (NEXORA "Chat", "a line to every specialist"): left roster of every agent with a real status word (working now / active today / ready / unreachable), one persistent conversation pane per agent, header counts (N specialists, M working now). Restyle of the existing Mastermind module in the S11 system, not a new module. | S21 |
| S26 | Standing orders (NEXORA "Schedule", "Nothing runs behind your back"): every recurring job any agent scheduled, one card each with owner agent, cadence, prompt, last run, result, runs, delivered by, model, and Run it now / Hold it / Let it run / Take it off; header counts on the books / live / next one. Over the existing scheduler + v2 automations; nothing hidden. | S11 |
| S27 | Health page (NEXORA "Health"): a plain-words headline ("the machine is quiet and well" only when every check passes), host facts (host, OS, kernel, cores, storage, uptime), 1/5/15-min load bars, overall ring (N of M checks), four live sparklines over the last samples (processor, memory, disk, network) each labelled by shape (spiky / steady / flat / bursty, computed), per-core bars, memory in use vs free, storage per partition, the busiest processes as tiles with an Everything / Agents-only filter, and the diagnostics checklist. Server samples every few seconds in memory; Windows-correct (this box is Windows: wmic/Get-Counter or `os` + `systeminformation`-free code). Shares the endpoint with S18's System pulse. | S11 |
| S28 | Files (NEXORA "Files", owner: "more importantly"): view and EDIT agent files in the OS. Left: every agent; middle: its files grouped IDENTITY (persona / SOUL.md, USER.md), MEMORY (MEMORY.md, memory notes), CONFIGURATION (config.yaml, settings block); right: editor. Sources are real files only: Hermes profiles under ~/.hermes/profiles/<name>/, Agent OS agent personas, Jarvis persona, ~/.agentic-os/skills/*/SKILL.md. Sensitive files open read-only behind a "this file shapes <agent>" gate ("I understand, let me edit" / "Just read it"). Every save keeps the previous version (exile-style copy, never overwritten), refuses if the file changed since it was read (mtime + hash), and never writes outside the allow-listed roots (path containment asserted in code). Header counts: agents, editable files, last changed, versions kept. | S11 |
| S29 | Guide (owner: "every module, every tab, and every action inside of each needs to be documented in a wiki"; NEXORA "Guide" as the reference shape): an in-app wiki at /guide. Hero with a tile per module; a sticky contents rail (Start here, Around every page, one entry per module, How it works); each module section says what it is for, then a two-column table of every tab and every control (name -> what it shows / what happens when you use it), with an "Open <module>" link. Search across all of it. Source of truth: one markdown file per module under `docs/modules/` (closes the backlog item "~33 module docs unwritten"), written FROM THE CODE (each control named as it appears in the UI, each claim traceable to a component), rendered by the page; a smoke fails when a sidebar module has no doc or a doc names a route that does not exist. Written last, after the other slices land, so it documents what actually shipped. The same `docs/modules/*.md` are the repo's GitHub docs (owner, 2026-09-28): README gets an index linking each module doc. | all |
| S21 | Crew view (owner's NEXORA "Agent City" screenshots, 2026-09-28): roster header with real counts (agents, working now, messages 7 days, average reply, agent time this month), a 4-step "Deploy agent" wizard (pick a prepared role whose instructions are already written, or write your own; name + one-line role; model; review, confirm), and a 3D city of the agents built on the Hermes 3D scene. Agent City detail (owner, 2026-09-28): the orchestrator is a tall tower in the centre, every configured agent gets its own procedurally generated building (form seeded from the agent id, so it is stable), buildings pulse by real state (blue working, warm idle, red unreachable), roads/links carry LIVE TRANSFERS when one agent hands work to another, clicking a building opens a messenger-style chat drawer for that agent, a hover card shows sessions / tokens / average reply. Below the city: the roster carousel with per-agent counts, WHEN THE CREW SPEAKS (a GitHub-style heatmap of agent replies and owner messages per hour, 24 h and 7-day views, from real message timestamps), and RECENT ACTIVITY (agent, what happened, source, messages, when). Also the "Talk to the crew" ring: Jarvis as orchestrator in the centre, each configured agent a selectable outer segment; choosing one opens a live conversation panel with it. Extends `lib/agentsStore.ts` + `lib/v2/agents`. | S11 |
| S20+ | NEXORA adoptions chosen from the diff | diff |

Each slice: smoke, journal entry, version bump, commit, roadmap tick.
