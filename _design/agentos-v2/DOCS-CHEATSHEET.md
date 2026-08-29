# AgentOS Docs Cheatsheet (from docs_agentos.zip, read in full 2026-08-27)

Reference distillation of the upstream "AgentOS" (open-source personal AI OS) docs. Use this when implementing V2 features so we stay faithful to the documented architecture without re-reading 180 files.

---

## 1. Core mental model

- **One brain, many surfaces.** A single Agent ("butler"/meta-agent) with one memory graph, reachable via web dashboard, voice, scratchpad, email, WhatsApp/Slack/Telegram, and any MCP-compatible tool. Same persona + memory everywhere.
- **Five pillars:** Memory (temporal knowledge graph) · Tasks (units of delegated work) · Toolkit/Integrations (actions in connected apps via one MCP endpoint) · Skills (personal policies/lenses, not runnable tasks) · Gateway (local capability server: browser, coding agents, exec, files).
- **Two paths in:** user messages, and automated triggers (webhooks/schedules). Triggers go through a **CASE decision agent** that builds an ActionPlan (what to do, tone, whether to message) before the main Agent acts.

## 2. Meta-Agent (concepts/meta-agent)

Loop per message:
1. **Load context** — conversation history + **persona document** (living summary of preferences/directives/decisions generated from memory).
2. **Understand intent.**
3. **Gather or act** — two core tools:
   - `gather_context` (READ) → routes to 3 explorers: Memory Explorer (graph), Integration Explorer (live app data), Web Explorer (search).
   - `take_action` (WRITE) → executes via Integration Explorer.
   - Gateways (coding/browser/exec) invoked when needed.
4. **Respond & remember** — every conversation is auto-ingested back into memory (`memory_ingest`).

Can spawn sub-agents (Claude Code/Codex session, browser session) from any channel. Supports scheduled/recurring actions that run the full workflow (memory rules → context → actions), not just notifications.

## 3. Memory system (memory/*)

**Primitives**
- `Episode` — atomic ingested content (one conversation/email/sync); raw text preserved verbatim; metadata: timestamp, source, channel, labels, optional `sessionId`, optional `endUserId` (counterparty scoping).
- `Entity` — node; **11 types**: Person, Organization, Place, Event, Project, Task, Technology, Product, Standard, Concept, Predicate (Predicate = edge label, not a node).
- `Statement` — atomic fact from an episode, classified into **12 aspects**.
- `Label` — flat workspace-scoped tag with embedding; the **primary scoping mechanism** for search.

**12 aspects, split into two stores**
- **Voice aspects** (stored WHOLE in Aspects Store): Directive, Preference, Habit, Belief, Goal, Task.
- **Graph aspects** (decomposed to Subject-Predicate-Object triples in graph DB): Identity, Knowledge, Decision, Event, Problem, Relationship.
- Aspect combos by activity: coding → Preference+Directive+Knowledge; debugging → Problem+Knowledge+Decision; planning → Goal+Decision+Directive; etc.

**Ingestion pipeline (5 stages)**
Episode created (verbatim) → Entity extraction (dedupe: name normalization + vector similarity in ENTITY namespace) → Statement extraction (classify into aspect) → Storage split (voice→Aspects Store, graph→SPO triples) → Embeddings written.
- **Conflicts:** never overwrite — old statement gets `invalidAt` timestamp, new becomes current (temporal chain). "Currently prefers X (as of date), previously Y."
- Entry points: integration syncs, butler conversations (auto), dashboard upload, MCP `memory_ingest`.

**6 vector namespaces:** ENTITY, STATEMENT, EPISODE, COMPACTED_SESSION, LABEL, ASPECT (`voice_aspect`).

**Search V2 pipeline (3 stages)**
1. **Router:** `searchLabels()` (vector vs LABEL namespace, threshold env `SEARCH_LABEL_VECTOR_THRESHOLD`) → `extractAspects()` (structured LLM call returning `{aspects, queryType, temporal, shouldSearch, entityHints, selectedLabels, lookupMode, attributeHint, facets, confidence}`). Short-circuit when `shouldSearch=false` or confidence < 0.2.
2. **Handler dispatch by queryType (6 types):**
   - `aspect_query` — facts of a given aspect ("my coding preferences"). Graph scoped by labels+aspects, + entity-hint path, + episode-vector fallback only when no label match.
   - `entity_lookup` — modes `attribute` (returns entity field via attributeHint) / `broad` (episodes mentioning entity). Entity hints resolved via ENTITY vector search.
   - `temporal` — time-bounded episodes; temporal filter `{type: recent|range|before|after|all, days, startDate, endDate}`.
   - `temporal_facets` — aggregates (counts) over `topics|entities|aspects`, no episodes.
   - `exploratory` — broad recall; queries compacted-session documents scoped by labels + fallbacks.
   - `relationship` — needs ≥2 entityHints; graph traversal for connecting statements.
3. **Post:** merge+dedupe → optional Cohere rerank → token-budget trim.
- Labels are the fast path; vector-on-episodes is the recall safety net. Session compaction after ~3 exchanges keeps long chats cheap; compacted sessions are searchable.
- `memory_search` accepts optional `labelIds` (force scope, bypass router) and `endUserIds` (hard filter, applied in both vector WHERE and graph WHERE).

**MCP memory tools:** `memory_search`, `memory_ingest`, `memory_about_user` (profile).

**Upstream stack (for reference, we adapt):** Postgres + pgvector (vectors), Neo4j (graph), Redis (cache/queues), providers pluggable (`GRAPH_PROVIDER`, `VECTOR_PROVIDER`). pgvector migration made retrieval ~26x faster than graph-stored embeddings.

## 4. Tasks (concepts/tasks)

Task = unit of delegated work:
- **Anatomy:** title, status (Todo/In Progress/Done), scheduled date, description (spec), **Plan** (drafted by the agent, presented for approval, editable), subtasks, **Sessions** (coding/browser/terminal spawned for the work), activity log, **dedicated chat thread**.
- **Sources:** Scratchpad `[ ]`, chat, messaging channels, automations (triggers), recurring schedule (cron/RRULE).
- **Run loop:** created → context loaded from memory+apps → plan drafted for approval → executes (direct actions / gateway sessions / skills fire by context) → blockers resolved or escalated with one tight question → result delivered + everything logged to memory.
- Recurring tasks re-gather fresh context on every cycle.

## 5. Scratchpad (concepts/scratchpad)

- **One page per day**, local timezone. Collaborative block editor (paragraphs, headings, lists, tasks, code, tables) backed by **Yjs** — autosaves, no save button.
- **`[ ]` checkbox line** → creates a real Task row (`source: "daily"`) bound to the line. Title syncs as you type; badge shows next run; picked up within ~2-3 min. Click display id (T-142) → full task page. Check=Done, uncheck=Todo. Deleting the line cleans up the task unless it has content/context.
- **`@butler` mention** → after idle pause, agent reads the paragraph, runs the request, replies as a **comment attached to that paragraph**. Each mention processed once (tracked per paragraph).
- **Widgets:** dockable side panel (own layout, persisted per workspace) + inline `/` slash-menu widget blocks with per-block config.
- Philosophy: fresh page daily = small, current reasoning surface; yesterday stays searchable in memory.

## 6. Widgets (concepts/widgets)

- Small embeddable UIs **shipped by each integration**, rendered inside the OS (Overview grid, Scratchpad panel, inline blocks) but fetching live data from the connected service.
- Loaded at runtime from the integration's widget bundle URL (cached); rendered with a context object = widget config + credentials. No separate install/auth.
- Config declared by schema; the OS renders the config form; config stored per cell/block, so same widget can appear multiple times with different scopes.
- Overview grid: drag to size/arrange, layout workspace-scoped, autosaves. Widgets = visual surface; Toolkit = action surface — same connection powers both, always in sync.

## 7. Toolkit / Integrations (concepts/toolkit, toolkit/*, integrations/*)

- **One MCP endpoint for everything:** `/api/v1/mcp?source=<name>[&integrations=a,b][&no_integrations=true]`. Auth: OAuth (MCP spec) or API key bearer.
- **On-demand tool loading:** agent describes intent (`get_integration_actions("send slack message")`) → gets back only 1-3 relevant tool schemas → `execute_integration_action(...)`. Saves context tokens.
- **Integration package anatomy** (per service):
  - `spec` — name, key, description, icon, auth (`OAuth2 {token_url, authorization_url, scopes}` or API key), `schedule {frequency: cron}` for polling, `mcp` config.
  - `mcp` config types: `http` (URL + headers with `${config:access_token}` placeholders), `stdio` (binary + env placeholders), or `cli` (custom getTools/callTool in the package).
  - **Event handlers:** SETUP (OAuth account create → returns `{accountId, config, settings}`), GET_TOOLS, CALL_TOOL always; SYNC (schedule-based: poll, return `activity` messages + `state` with lastSyncTime); IDENTIFY + PROCESS (webhook-based: extract user id, turn event into `activity`).
  - Activity messages: `{type:'activity', data:{text, sourceURL}}` — descriptive text + deep link; these become memory episodes.
  - Best practices: incremental sync (default window 24h), pagination, return empty on errors (don't throw), rate-limit retry w/ backoff, filter noise.
- **User Rules** (natural language) control what activity gets ingested into memory per integration ("Only add Linear issues assigned to me").
- **Triggers**: each integration also exposes event triggers (e.g. `GITHUB_PR_CREATED`, `GMAIL_MESSAGE_RECEIVED`, `SLACK_REACTION_ADDED`, `HUBSPOT_DEAL_CLOSED_WON`) that wake the Meta Agent for proactive automation.
- **Automations format:** `When [TRIGGER] happens, if [CONDITIONS] are met, then do [ACTIONS]` — written in plain English.
- Catalogued integrations w/ tool lists: GitHub (60+), GitHub Analytics (DORA: deployment freq, lead time, CFR, MTTR + PR merge time/throughput/size, hotfix/revert rates), Gmail (20+ incl. filters/labels/batch), Slack (40+), Discord (20+), Linear (20+), Notion (15+), Google Calendar/Docs/Sheets/Tasks, Todoist, HubSpot (20), Cal.com, Mixpanel, Zoho, Spotify, LinkedIn (dev-app based: post/like/comment).

## 8. Gateway (gateway/*)

- **Local Fastify HTTP+WS server, default port 7787**, bearer-only auth (`gwk_` key, sha256 stored, no localhost bypass). Runs native (launchd/systemd + tunnel), Docker, or Railway.
- **Manifest of capability slots** (disabled slots = routes not registered):
  - **Browser** — Playwright. `browser_navigate/snapshot(ARIA)/click/fill/type/press_key/select_option/screenshot/scroll/back/forward/wait_for/evaluate/create_session/list_sessions/delete_session/close_session/close_all`. **Profiles** (max 5) = persistent identities on disk (cookies/localStorage, `~/.agentosbrain/browser-profiles/<name>`); **Sessions** (max 10) = named task→profile bindings. Login once headed, automate headless forever. Live view in webapp via CDP WebSocket proxy `/api/browser/cdp/:session` (webapp launches headless via `POST /api/browser/launch`). CLI and gateway keep separate session maps — don't open the same session in both (profile dir lock). Recommended browser: Brave.
  - **Coding** — `coding_ask` (agent, dir, prompt, sessionId?, model?, systemPrompt?, worktree+baseBranch+branch), `coding_read_session` (status: initializing/running/completed/failed), `coding_list_sessions` (reads agent's own on-disk transcripts), `coding_search_sessions`, `coding_list_agents`, `coding_close_session/all`. Template-driven agent registry (claude-code, codex-cli); auto-detects binaries on PATH. `worktree:true` → gateway does `git worktree add`, agent runs isolated, cleanup on close. PTY streaming to webapp xterm via WS `/api/coding/coding_xterm_session?session_id=` (frames: raw bytes out; `{kind:'input'|'resize'}` in; `{kind:'exit'}`); `POST /api/coding/spawn` allocates/resumes PTY without a prompt.
  - **Exec** — `exec_command {command, dir, timeout}` validated against 3 layers: built-in deny (rm -rf /, sudo, curl|bash), user deny patterns, user allow patterns (`Bash(<glob>)` format; empty allow = all non-denied). Returns exitCode/stdout/stderr.
  - **Files** — read/write/edit/glob/grep, scoped to registered folders.
  - **Utils** — `sleep`.
- **Folders & scopes:** registered paths with scopes `files|coding|exec`. Zero folders = permissive first-run mode; ≥1 folder = enforced everywhere (`FOLDER_SCOPE_DENIED`, `PATH_OUTSIDE_FOLDER`).
- **Tunnels:** Tailscale Funnel (stable) / ngrok (fast) / bring-your-own URL. Key shown once; rotate by re-registering.
- **LLM subscription proxy:** embedded CLIProxyAPI exposing OpenAI-compatible `/llmproxy/v1` that routes to Claude Max/Codex/Antigravity/xAI subscriptions via OAuth login (`gateway llmproxy --login claude`).

## 9. Skills (skills/*)

Skills = **personal policies/lenses written once, consumed by many tasks** — NOT runnable workflows. "What counts as important email", "how I research an account", "how I categorize money", "how I journal". Created in dashboard (title + policy + short description for load-time matching).
- Pattern: order-of-operations always "memory first, then live sources"; explicit signal weights; output structure; "How this lens is used" section listing consumer tasks; edge cases; ask-once-then-store-in-memory setup questions.
- Notable exemplars: email labelling (priority-ordered labels, max 2, never overwrite manual), notify-policy (senders/customer signals/security+money always win), engineering analytics (DORA thresholds table healthy/worth-a-look/flag), money categorization (email types table, payee→category map in memory, subscription state machine: watching→active→cancel-candidate/possible-cancellation→cancelled, True Expenses w/ monthly slice, per-category notable thresholds), journaling (one question per turn, mirror specifically, stop conditions), weekly learning summary (windowed `temporal_facets` calls w/ load-bearing canonical query string, sensitivity filter, synthesis-not-inventory writing rules).

## 10. tasks.json (stock scheduled tasks — great seeds for our Tasks page)

RRULE-scheduled task definitions with rich HTML descriptions:
- `morning_brief` (daily 7am): parallel GitHub+Calendar+Gmail fetch → Slack brief + scratchpad append with EXACT structure (`<h3>Brief — {date}</h3>` + Carried over / Suggested today / Heads up, cap 5 each, dedupe, append-only, skip if heading exists, no notification for scratchpad).
- `inbox_midday_catchup` (1pm): triage since 9am, push-only Slack, skip if empty.
- `end_of_day_wrapup` (6pm): Shipped/Still open/Blocking, "Quiet day." if empty.
- `weekly_engineering_report` (Fri 5pm), `weekly_retrospective` (Fri 4pm, empty scaffold user fills), `sunday_planning` (Sun 7pm: reads last retro's "what to change", meeting load, top open work, ≥2h deep-work gaps), `weekly_customer_digest` (Mon 9am).
- `money_subscription_identifier` (Sun 9am; bootstrap 90d vs steady-state 7d modes; persistent two-table ledger), `money_weekly_brief` (Mon 8am), `money_true_expense_forecast` (1st of month; bootstrap 12mo).
- `email_management` (every 3h, `silent:true`): label → per-label actions (decline-draft for Trying-to-Sell, auto-draft for Needs-Reply, subtask for Action-Required, 2-day reminder for Awaiting-Reply).
- Recurring-task design patterns: idempotency guards (check for today's heading before writing), append-never-replace, skip-empty-sections, push vs discovery delivery, bootstrap vs steady-state windows, state saved under stable memory keys.

## 11. HTTP API (openapi.json)

- Auth: Bearer (PAT/OAuth2/JWT); full OAuth2 authorization-code + PKCE server built in (`/oauth/authorize|token|userinfo|tokeninfo`), scopes: read, write, mcp, integration, oauth. OAuth client CRUD at `/api/oauth/clients`.
- `POST /api/v1/search` — {query, startTime, endTime, labelIds, limit≤1000, maxBfsDepth≤10, includeInvalidated, entityTypes, scoreThreshold, minResults}.
- `POST /api/v1/add` — ingest {episodeBody, referenceTime, source, metadata, labelIds, sessionId} → {queueId}.
- `POST /api/v1/activity` — {text, source, sourceURL, integrationAccountId, taskId} (integration activity → ingestion + webhooks).
- `GET /api/v1/labels`; `GET /api/v1/episodes/{id}/facts`; ingestion logs CRUD `/api/v1/logs` (+status pending|processing|completed|failed, delete cascades episode/statements/entities); `/api/v1/ingestion-queue/status`; webhooks CRUD `/api/v1/webhooks` (url + optional secret).
- Ingestion rules (user rules) schema: {name, text, source, isActive}.

## 12. Channels (channels/*, access-agentos/*)

- Channel = messaging surface registered per workspace; unified channel system (email/WhatsApp/Slack first-class; Telegram via bot token + auto webhook registration `POST /api/v1/channels`).
- Email via Resend: inbound webhook `/api/v1/channels/email`, sender must be registered user, replies plain text, subject-line threading only.
- Slack: bot + user token scopes, events `app_mention` + `message.im`, signing secret, threads tracked as separate conversations.

## 13. Provider/memory-rules pattern (providers/*)

Every external AI tool gets: (1) the MCP URL with `?source=`, (2) a "memory protocol" always-on rule — mandatory `memory_search` first (semantic full-sentence queries; entity-centric / multi-entity / semantic-question / concept / temporal patterns), `get_integrations` if action needed, respond, then mandatory `memory_ingest` last (incremental timeline `<user>exact text</user><assistant>strategic summary</assistant>`, exclude code blocks/logs, relevance-filtered). Claude Code plugin adds SessionStart hook (fetch persona doc, inject) + Stop hook (extract convo pairs, dedupe, queue ingestion).

## 14. Self-hosting notes (misc)

- Stack: webapp (Remix, port 3033) + Postgres + Neo4j + Redis (+optional Ollama). Queue: Trigger.dev or BullMQ (`QUEUE_PROVIDER`; local embeddings require bullmq).
- Model providers: pluggable chat (`CHAT_PROVIDER` openai/anthropic/google/azure/ollama + any OpenAI-compatible via `OPENAI_BASE_URL` + `OPENAI_API_MODE=chat_completions`) — includes Ollama Cloud pattern we use.
- Embeddings: openai/google/ollama/local (in-process transformers.js ONNX, nomic-embed-text-v1.5 768d, q8). `EMBEDDING_MODEL_SIZE` must match vector column; switching models = re-embed everything. Short vectors zero-padded (degrades), long = error.
- Reranking: `RERANK_PROVIDER` cohere | ollama (dengcao/Qwen3-Reranker) | none, score threshold 0.3.
- Env: SESSION_SECRET/ENCRYPTION_KEY/MAGIC_LINK_SECRET, APP_ORIGIN/LOGIN_ORIGIN (webhooks break if wrong), EXA_API_KEY for web search.

---

## Key takeaways for OUR build (agent-os adaptations)

1. **Memory:** keep the episode/entity/statement/aspect/label model and the router→handler search shape; implement on SQLite + sqlite-vec (or pgvector if we add Postgres) with an edges table instead of Neo4j. Ollama embeddings (existing memsearch infra) instead of OpenAI. Contradiction = temporal chain, never overwrite.
2. **Tasks:** task anatomy (spec/plan/state/sessions/chat thread) + RRULE recurring + the tasks.json seed patterns (idempotent scratchpad appends, bootstrap vs steady-state) map directly onto what Yoshi asked for on the Tasks page.
3. **Gateway:** our equivalents already exist in-repo (runner.ts, ptySessions.ts, terminal API); the docs give us the slot/manifest/folder-scope/allow-deny architecture to formalize them, plus the Playwright profile/session model for the dedicated agent Browser.
4. **Toolkit:** the integration package contract (spec + SETUP/SYNC/PROCESS/GET_TOOLS/CALL_TOOL + activity messages + `${config:*}` placeholders) is the blueprint for both the Integrations page AND the WebMCP Engine's output format.
5. **Widgets:** integration-shipped bundles with config schemas — powers Homepage and Scratchpad panel.
6. **Meta-agent:** gather_context/take_action two-tool shape + persona document + auto-ingest is the blueprint for omnipresent Jarvis.
