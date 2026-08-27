# Agent OS V2 — Master Plan

Status: PLANNING (created 2026-08-27). Prereqs done: full docs read, cheatsheet at `_design/agentos-v2/DOCS-CHEATSHEET.md`.
Scope: Yoshi's 12 requested workstreams + additions. This is borderline a new build — phased so the live app keeps working throughout (Rule 12: never restart the server ourselves; Yoshi rebuilds).

---

## 0. Ground rules for the whole build

- **In-app configurability** (AGENTS.md rule 16): every module ships a gear/settings surface backed by `src/lib/settings.ts` runtime store. No config-file-only options.
- **Model-agnostic personas/data** (rule 17): personas, harnesses, tool definitions, memory content are editable data injected at runtime — never baked into provider-specific prompt code.
- **Provider routing** (rule 11): everything that calls a model goes through the existing provider picker (Ollama Cloud / CLI agents / MiniMax); fail loudly, no silent fallback.
- **Windows-first**: all spawns through `spawnEnv.ts` sanitizer; CLI shims via shell-out per the resolved matrix.
- **Append-never-destroy**: memory and scratchpad writes are additive; contradictions become temporal chains (invalidAt), deletions are exiles.
- Each phase ends with: `tsc` clean, `npm run build` pass (Yoshi runs it), and a scripted smoke test.

---

## 1. Foundations (Phase F) — shared plumbing everything else sits on

**F1. Data layer decision + setup.**
- Add SQLite via `better-sqlite3` as the V2 system store: `~/.agentic-os/agentos.db` (outside repo, survives rebuilds). (Correction: `kanbanDb.ts` actually uses built-in `node:sqlite`; better-sqlite3 is a NEW dep, chosen for sqlite-vec extension loading — see ultraplan/CONVENTIONS.md §1.)
- Add `sqlite-vec` extension for vector columns (embeddings via existing Ollama embed model). Fallback: brute-force cosine in JS if the native ext fights Windows — measure first.
- Schema owner: `src/lib/v2/db.ts` (migrations table, versioned DDL).
- DECISION (Yoshi): SQLite (recommended — zero infra, local, matches our stack) vs adding Postgres+pgvector container on the .99 box. Plan assumes SQLite.

**F2. Event bus + job scheduler.**
- `src/lib/v2/events.ts` — in-process typed event bus (task.created, memory.ingested, trigger.fired, agent.status, note.captured...). Persisted event log table for the Homepage feed.
- `src/lib/v2/scheduler.ts` — RRULE-based scheduler (reuse/extend `normalizeSchedule` work from the cron fix; use `rrule` npm). Drives recurring tasks, integration polling, newsletter editions. Survives restarts by rehydrating from DB.

**F3. Capability layer ("gateway-lite").**
- Formalize what we already have (runner.ts, ptySessions.ts, terminal API) into slots per the gateway docs: `coding`, `exec`, `browser`, `files`, each with a manifest, allow/deny patterns (`Bash(<glob>)` style), and folder scopes stored in settings.
- This is what Tasks sessions, Jarvis tools, and WebMCP-built tools all call. One choke point = one security review.

**F4. Internal MCP server (`/api/mcp`).**
- Single MCP endpoint exposing Agent OS itself: memory tools, task tools, capability slots, integration actions — with `?source=` tagging and on-demand tool loading (`get_actions(intent)` → 1-3 schemas → `execute_action`).
- This is both how Jarvis "does anything inside the OS" and the first customer of the WebMCP Engine.

---

## 2. Workstream tasklist

### A. Memory V2 — episodic temporal knowledge graph (docs: memory/*)
Highest-leverage; nearly everything else reads/writes it. Replaces/absorbs memsearch + jarvisMemory over time.

- A1. Schema: episodes (verbatim body, timestamp, source, channel, sessionId, endUserId), entities (11 types), statements (12 aspects, subject/predicate/object nullable for voice aspects, validAt/invalidAt), edges, labels, embeddings tables per namespace (ENTITY, STATEMENT, EPISODE, COMPACTED_SESSION, LABEL, ASPECT).
- A2. Ingestion pipeline (`src/lib/v2/memory/ingest.ts`): episode → entity extraction+dedupe (name normalization + ENTITY vector sim) → statement extraction+aspect classification (LLM, provider-routed) → storage split (voice whole / graph SPO) → embeddings. Queue with statuses (pending/processing/completed/failed) + logs UI.
- A3. Contradiction handling: temporal chains, `invalidAt`, "currently X, previously Y" rendering.
- A4. Search V2 (`src/lib/v2/memory/search.ts`): router (label vector match + LLM extractAspects returning the documented JSON shape, confidence gate 0.2) → 6 handlers (aspect_query, entity_lookup attr/broad, temporal, temporal_facets, exploratory, relationship) → merge/dedupe/token-budget. Optional Ollama reranker later.
- A5. Session compaction after N exchanges; compacted sessions searchable (exploratory handler).
- A6. Persona document generator: aspect-based living summary (Identity/Preference/Directive/Decision/Goal...) regenerated on a schedule; consumed by Jarvis on every page.
- A7. API + MCP tools: `memory_search`, `memory_ingest`, `memory_about_user`; REST mirrors (`/api/v2/memory/*`).
- A8. Memory page UI overhaul: episode browser, entity graph view, aspect filters, labels manager (name/color/description), ingestion logs, manual upload.
- A9. Migration: one-shot importer for `.memsearch/memory/*.md`, `.remember/*`, jarvisMemory into episodes (labeled `legacy`). Old stores stay read-only until confidence, then retired.
- A10. MemOS (MemTensor) evaluation checkpoint: before freezing Memory V2 APIs, review MemOS's memory-scheduling/MemCube model vs our episodic system; adopt only what beats aspects/labels/temporal-chains on our workloads. Not a blocker.
- Verify: golden-query test set (aspect/entity/temporal/relationship queries) + ingest→search round-trip script.

### B. Tasks page + Scratchpad (docs: concepts/tasks, concepts/scratchpad, tasks.json)
- B1. Task model: title, status, scheduledDate, RRULE recurrence, spec (my words), plan (agent-drafted, approval-gated — reuse Human Gate pattern from Pipeline), subtasks, sessions[], activity log, dedicated chat thread (thread = conversation scoped to taskId, ingested to memory).
- B2. Task execution engine: on claim → gather context (memory + integrations) → draft plan → await approval (configurable auto-approve per category) → execute via capability layer (spawn coding session / drive browser / run exec) → deliver + ingest. Blocker escalation = one tight question to the chat thread + attention flag to Homepage.
- B3. Recurring tasks: seed with adapted tasks.json patterns (Morning Brief, End-of-Day Wrap-up, Sunday Planning, Weekly Retro scaffold) — all with idempotency guards and append-only scratchpad writes.
- B4. Page layout (top→bottom, per Yoshi's spec):
  1. Task list (one-time + repeating, date-settable) beside a compact month calendar;
  2. Large Kanban board (Todo / In Progress / Waiting / Done; drag-drop; reuse KanbanView patterns);
  3. **Agents section**: compact cards for active/recent/upcoming agents, current + upcoming tasks per agent, **color-coded status bands** (green running / blue idle / amber waiting-on-me / red error / gray offline) readable at a glance.
- B5. Scratchpad: daily page at `/today` (also feeds Homepage). Block editor — recommend TipTap (+ Yjs later if multi-device editing matters; start with single-client autosave). `[ ]` → real task binding with badge + display id; `@jarvis` mention → inline comment reply on the paragraph, processed-once tracking.
- B6. Every task chat/action ingested into Memory V2 with task label.
- Verify: create/recur/execute/approve/spawn-session E2E script + Playwright UI pass.

### C. Omnipresent Jarvis (docs: concepts/meta-agent)
- C1. Extract Jarvis from `/jarvis` page into a **global provider** mounted in root layout: `JarvisOmnipresence` (floating orb + push-to-talk overlay + transcript drawer) available on every route.
- C2. **F13 hotkey — OS-GLOBAL (decided 2026-08-27)**: a tiny always-running helper (AutoHotkey v2 script installed as a startup task, or node `uiohook-napi` daemon) captures F13 system-wide, brings the Agent OS window forward (or spawns a compact always-on-top overlay window), and signals the app (localhost endpoint `/api/jarvis/hotkey`) to open the chatbox. Configurable key in settings; in-app `keydown` listener as the degraded path when the helper isn't running.
- C2b. **Chatbox-first capture (decided 2026-08-27 — fixes current annoyance):** F13 opens a **chat input box**, not a fire-and-forget recorder. Voice transcribes LIVE into the editable text field; releasing the key STOPS RECORDING but does NOT send. Yoshi can then re-record/append, edit the text, type additions, and sends explicitly (Enter or Send button; Esc discards). A settings toggle `voice.autoSend` exists for anyone who wants the old instant-send behavior, default OFF. Retrofit this same review-before-send flow onto the existing `/jarvis` page voice (JarvisRealtime/KimiVoice) — current auto-send-on-release is explicitly unwanted.
- C3. Voice loop: reuse JarvisRealtime/KimiVoice/GeminiLive plumbing behind one interface feeding the C2b chatbox (streaming transcript → editable buffer); provider-agnostic per rule 17; settings gear for voice/model/persona/hotkey/autoSend.
- C4. Brain: meta-agent loop per docs — load persona doc (A6) + page context (route, selected entity) → gather_context (memory explorer / integration explorer / web) → take_action (internal MCP F4) → respond → auto-ingest exchange.
- C5. Page-context injection: each module registers a lightweight context descriptor (what page, what's on screen) so Jarvis answers "this page" questions.
- C6. Jarvis can spawn: coding session, browser session, task creation — all via F3/F4.
- Verify: same memory recalled on 3 different pages; F13 works everywhere; action round-trip ("create a task...", "what's on my pipeline?").

### D. WebMCP Engine (docs: toolkit integration contract, mcp-hub-guide)
- D1. New page `/webmcp`: build, test, version, and deploy MCP tool packages.
- D2. Package model = the documented integration contract: spec (name/key/auth/schedule/mcp type), tools (zod schema → JSON Schema), handlers (SETUP/SYNC/PROCESS/GET_TOOLS/CALL_TOOL). Stored as data + generated TS, editable in-app (Monaco editor pane).
- D3. Builder UX: form-driven spec → tool designer (name/description/input schema/implementation) → sandbox test runner (call tool with sample args, see result) → publish to the internal MCP hub (F4) or export as standalone stdio/http server package for client onboarding.
- D4. First deliverable: **AgentOS self-tools** package (tasks CRUD, pipeline ops, marketing ops, memory, navigation) — the thing that lets Jarvis drive the OS.
- D5. Later: client-onboarding mode (multi-tenant specs, OAuth credential placeholders `${config:*}`).
- Verify: build a toy tool in-app, call it from Jarvis and from Claude Code via `/api/mcp`.

### E. Browser (docs: gateway/browser)
- E1. Playwright-driven dedicated browser, separate from Opera: **profiles** (persistent auth dirs under `~/.agentic-os/browser-profiles`, max ~5) + **sessions** (task→profile bindings). Reuse learnings from Crawlee/patchright work (never block CSS/JS, real-Chrome option).
- E2. `/browser` page: session list, live view (CDP screencast into the page), headed-handoff button ("let me log in"), close/kill controls.
- E3. Browser tools on the capability layer: navigate/snapshot(ARIA)/click/fill/type/screenshot/evaluate/wait — callable by any agent, Jarvis, and Tasks.
- E4. Safety: agent-driven sessions never touch Yoshi's Opera profile; per-session allowlist of domains optional.
- Verify: agent logs into a test site once headed, then completes a headless authenticated flow; live view streams.

### F. Agents page (new lifecycle dashboard)
- F1. Replace/extend `/agents` (AgentsView + agentsRuntime/Store/Triggers already exist) with full lifecycle: **ideation → forge (build) → test → deploy → observe**.
- F2. Hero section: live visualization of every agent — where it is (page/module/gateway), what it's working on (current task), animated status. Nav items: **Deploy Agent**, **Forge Agent**, **Forge Harness**, plus Registry & Runs.
- F3. Agent record: name, persona (model-agnostic data), harness (selected from harness library — ralph/fable/feat-loop style definitions stored as data), tools (from WebMCP registry), connectors/integrations (from G), model/provider, schedule/triggers, status.
- F4. Creation wizard: **harness selection + tool selection + connector selection** are first-class steps (Yoshi's explicit requirement).
- F5. Compact info cards lower on page → click → tabbed agent detail: Overview / Runs & Sessions / Tasks / Tools & Connectors / Memory (endUserId-scoped view) / Settings.
- F6. Status feeds from event bus; same status-band component shared with Tasks page Agents section (B4).
- Verify: forge a trivial agent end-to-end, deploy on a schedule, watch it in the hero viz.

### G. Integrations (docs: toolkit/*, integrations/*)
- G1. `/integrations` page: card grid of connectors, connect/disconnect, per-connector settings + **user rules** (natural-language ingestion filters), trigger toggles.
- G2. Connector runtime honoring the docs contract: OAuth2 or API-key auth, schedule-based SYNC (via F2 scheduler, incremental state) or webhook PROCESS (`/api/hooks/[slug]`), activities → Memory V2 episodes with sourceURL.
- G3. Wave 1 connectors (leverage what we have): Gmail (Gmail-MCP exists), Notion, GitHub, Google Calendar, Slack, Buzz (bridge exists). Wave 2: ClickUp, Linear, Todoist, addy.io (for K), YouTube.
- G4. Each connector exposes MCP tools through F4 (on-demand loading) + optional **widgets** (H2) + optional **triggers** feeding automations.
- G5. Automations: plain-English `When [trigger] if [conditions] then [actions]` rules page (start with a structured builder; NL parsing later).
- Verify: connect Notion, sync pages into memory, ask Jarvis about them; trigger→action round trip.

### H. Homepage bolster + Widgets framework (docs: concepts/widgets)
- H1. Rework Overview/Mission Control into the **daily page**: today's scratchpad surface (B5) + widget grid.
- H2. Widget framework: registry of widget components (start in-repo, not remote bundles), each with config schema → auto-rendered config form, per-cell config, drag/resize grid, layout persisted in settings.
- H3. Launch widgets: Newsletter latest edition (K), Tasks new/upcoming/in-progress, AnyNotes recent + replies (I), Attention/needs-me (blockers, waiting approvals, failed runs from event bus), Agent status strip (F6), Calendar, Pipeline/Deal Desk stats.
- H4. "Needs my attention" is the hero: aggregates approval gates, blocked tasks, errored agents, unread important items.
- Verify: layout persists; each widget live-updates from event bus.

### I. AnyNotes (save-anything inbox)
- I1. Model: note {url, type (tweet/article/video/screenshot/text), title, capturedAt, content snapshot, tags/labels, status (inbox/kept/archived), thread of replies/annotations}.
- I2. Capture paths: paste-a-URL box (server fetches + extracts: oEmbed for tweets/YT, readability for articles), screenshot drop/paste, share-from-phone later. Optional Opera bookmarklet (no extension build yet).
- I3. `/anynotes` page: masonry/grid inbox, filters by type/label, note detail with reply thread (replies can @jarvis — surfaces on Homepage per Yoshi's spec).
- I4. Every note ingested into Memory V2 (labeled) so Jarvis can recall "that tweet about X".
- Verify: capture tweet + article + YT video + screenshot; recall each via Jarvis.

### J. Marketing Hub upgrades (blueprint at `_design/marketing-hub-blueprint.md`)
- J1. **Campaign** becomes the first-class object; subpages/tabs per campaign (Yoshi's spec).
- J2. Per-campaign tabs: Overview (goal, audience, status) / Calendar (reuse month grid, campaign-scoped) / Mini-Kanban (idea → drafting → approval → scheduled → posted) / Assets / Metrics (surfaceable stats: post counts, platform metrics where APIs allow, manual entry otherwise).
- J3. Cross-campaign roll-up view (all calendars merged, color per campaign).
- J4. Wire existing Ideate chat + persona records into campaign context; humanizer pass stays mandatory pre-ship.
- Verify: create campaign, move a post through the mini-kanban to scheduled, see it on both calendars.

### K. Newsletter page (daily deduped "newspaper")
- K1. Accounts: the agent Gmail account already exists — connect it via OAuth/App-password. addy.io aliases via REST API; **key stored at `~/.agentic-os/newsletter/config.json`** (delivered 2026-08-27; never commit to repo, surface in settings UI as "configured ✓" only) — create alias per subscription topic.
- K2. Subscription manager: directory of newsletters (name, alias used, cadence), one-click "subscribe with alias" helper (opens signup with alias copied).
- K3. Ingest: poll the Gmail account (G-wave-1 connector, dedicated account scope), parse newsletters (strip boilerplate, extract items/links), **dedupe stories across sources** (embedding similarity + URL canonicalization).
- K4. **Edition builder**: daily job (F2) compiles a "newspaper" — sections by topic, each story with sources-that-covered-it list; `/newsletter` page shows today's edition + archive; edition widget on Homepage (H3).
- Verify: 3+ newsletters in, overlapping story deduped into one item with 2 source chips.

### L. Hermes 3D (lukethedev 3D office)
- L1. UNBLOCKED: Synty source at `E:\Game Assets\SyntyStudio\Unreal\POLYGON_Office_SourceFiles_v4.zip` (42 MB — note the SPACE in "Game Assets", quote all shell-outs). Pipeline: extract FBX → FBX2glTF --draco → glTF/GLB. One manual Blender pass required (scene assembly + Mixamo retarget) — human checkpoint. lukethedev office source still welcome as reference.
- L2. New page `/hermes-3d`: three.js (r3f) scene — office environment, Hermes avatar at a desk,状态-driven animation (idle/thinking/talking synced to Hermes activity from event bus), click-to-talk hooking into Hermes chat/Oracle.
- L3. Asset pipeline doc + a `public/hermes3d/` budget (<15MB target, KTX2 textures).
- Verify: 60fps on Yoshi's machine, Hermes state changes reflect live.

---

## 3. My additions (beyond the asked list)

1. **Foundations phase (F1-F4)** — none of the 12 items stand without shared DB/events/scheduler/capability layer; building them per-feature would fork the codebase.
2. **Scratchpad** (B5) — not explicitly on the list but referenced by the docs Yoshi pointed at (tasks + scratchpad) and load-bearing for Homepage and Tasks.
3. **Skills-as-policies** — port the docs' "personal lens" concept: a Skills area where lenses (email importance, account research, money categorization) are data consumed by tasks; wires into existing platformSkills work.
4. **Automations rules page** (G5) — trigger/condition/action; the docs make this the glue between integrations and tasks.
5. **Persona document generator** (A6) — what makes Jarvis feel continuous everywhere.
6. **Attention aggregator** (H4) — single "needs me" feed; every workstream reports into it.
7. **Migration + retirement plan** (A9) — memsearch/.remember/jarvisMemory converge into Memory V2 instead of a fourth memory system.
8. **Per-phase smoke-test scripts** committed under `scripts/v2/` so regressions surface at build time, not in use.

## 4. Build order (dependency-driven)

```
Phase 0  F1 DB → F2 events/scheduler → F3 capability layer → F4 internal MCP
Phase 1  A Memory V2 (pipeline+search) → A6 persona → A9 migration
Phase 2  B Tasks + Scratchpad (uses F2, A) 
Phase 3  C1-C2 (omnipresence + capture UI) ∥ D1-D2 (WebMCP core), then C3 brain   ← first "wow" milestone
Phase 4  D3-D5 WebMCP builder UI + self-tools (deepens C)
Phase 5  G Integrations wave 1 + G5 automations
Phase 6  H Homepage + widgets (uses B, G, events)
Phase 7  E Browser · F Agents page (parallel; both on F3/F4)
Phase 8  I AnyNotes → K Newsletter (I shares extraction infra with K)
Phase 9  J Marketing upgrades · L Hermes 3D (independent, anytime after assets arrive)
```

Rationale: Memory before everything (all features write to it); Jarvis before WebMCP so the self-tools have a consumer to test against; Homepage after Tasks+Integrations so widgets have real data; AnyNotes before Newsletter (shared content-extraction code).

## 5. Decisions (resolved 2026-08-27)

1. **Storage:** SQLite + sqlite-vec locally, **with scheduled backup to the .99 homelab box** (add a backup job to F2: nightly DB snapshot pushed to .99 — mind Rule 19: env changes there need `--force-recreate`, not restart).
2. **F13 scope: RESOLVED — OS-global** via AutoHotkey v2 helper + in-app degraded path, chatbox-first capture (see §2.C2/C2b and SPEC-C).
3. **Reference repo delivered:** `github.com/BigY0shi/AgentOSCore`, cloned to `..\AgentOSCore` (sibling of agent-os). See §6 code map. **Synty source confirmed:** `E:\Game Assets\SyntyStudio\Unreal\POLYGON_Office_SourceFiles_v4.zip` (42 MB) — unblocks Hermes 3D asset pipeline (extract → FBX → glTF/GLB + draco). Still wanted: lukethedev Hermes 3D office source.
4. **Newsletter Gmail:** an agent Gmail account already exists — use it. (The account-creation boundary is on the assistant side, not a Yoshi preference; moot now since the account exists.)
5. **"/u" = Ultraplan** — to be run once the repo is fully ready; this plan + cheatsheet + §6 code map are its inputs.
6. **MemOS (MemTensor):** added as A10 — evaluate MemOS against the episodic system before Memory V2 is frozen. Working assumption: build the episodic system per docs (we have full reference source); MemOS review is a checkpoint, not a blocker — adopt ideas (e.g. memory scheduling/MemCube) only if they beat aspects/labels/temporal-chains on our workloads.

## 6. Reference code map (AgentOSCore @ ..\AgentOSCore)

pnpm/turbo monorepo — the actual implementation behind the docs. Read-only reference; we port patterns, not wholesale files (Remix → our Next.js).

> **Canonical reference = the GitHub clone at `..\AgentOSCore`** (Yoshi's call, 2026-08-27). A second snapshot, `agentos-main.zip` (extracted to `..\_reference-agentos-main\agentos-main`), is the same codebase v0.7.20 **rebranded to AGENTOS naming** (~1,994 files touched, sampled deltas are branding-level). TODO (deferred): full diff of the two snapshots to catch any real logic changes hiding among the renames.

| Our workstream | Reference source |
|---|---|
| A Memory pipeline | `apps/webapp/app/services/search-v2/` (router.ts, handlers.ts), `services/aspectStore.server.ts`, `services/knowledgeGraph.server.ts`, `services/episodeChunker/Differ/Facts/Versioning.server.ts`, `packages/types/src/graph/` (aspect + entity enums), `packages/providers/` (vector/graph provider abstraction — swap in sqlite-vec here) |
| A2 ingestion queue | `services/ingestionLogs.server.ts`, `services/ingestionRule.server.ts`, `app/bullmq/`, `app/jobs/`, `app/trigger/` |
| A6 persona | `components/personality/`, persona generation in `services/agent/` |
| B Tasks engine | `services/tasks/`, `services/coding-task.server.ts`, `components/tasks/`, `services/morning-brief.ts` |
| B5 Scratchpad | `services/hocuspocus/` (Yjs collab server), `components/editor/`, `components/daily/`, `services/butler-comment.server.ts` (@mention comment replies), `services/butler-activity.server.ts` |
| C Meta-agent | `services/agent/`, `services/agent-prompts.ts`, `services/prompts/`, `services/conversation.server.ts` + `conversation-pubsub`, `components/voice/` |
| D WebMCP contract | `packages/sdk/` (IntegrationCLI), `packages/mcp-proxy/`, `services/mcp.server.ts`, `components/mcp/` |
| E Browser | `services/browser/`, `components/browser/`, `packages/gateway-protocol/` |
| F3 gateway-lite | `packages/gateway-protocol/README.md` + src, `services/gateway.server.ts`, `services/folder.server.ts`, `packages/cli/` (gateway impl), `components/gateway/` |
| G Integrations | `integrations/*` — 38 packages incl. notion, gmail, github, linear, slack, google-calendar, jira, ghost, stripe, elevenlabs; `services/integrations/`, `services/integrationAccount/Definition.server.ts`, `services/oauth/` + `oauth2.server.ts` |
| H Widgets/Homepage | `services/widgets/`, `components/overview/`, `components/daily/` |
| Skills | `components/skills/` |
| Channels (later) | `services/channels/`, `packages/emails/` |
| K Newsletter parsing | gmail integration package + `services/email.server.ts` |
| Auth/keys | `services/apiAuth/byok/billing.server.ts`, `packages/database/` (Prisma schema — mine for our SQLite DDL) |
