# Dev Journal — 2026-07-28

## Brainstorm — Accept brief (persistence is a button, not a conversation)

**Commit:** `ce9fdbc` · **Rollback:** `git revert ce9fdbc` (accepted notes in the
vault survive harmlessly).

User report: the council's chair offered to push the brief to Honcho/the vault,
but saying "yes" just ran a steer round — the offer was the claude seat reading
the operator's global context and improvising an ability the module doesn't
have. Fix: synthesis/resynthesis prompts now forbid offering persistence, and
the brief panel has a real **Accept brief** button → `/api/brainstorm/accept`
writes `Agentic OS/Project Briefs/<date> <topic>.md` to the Obsidian vault
(root verified live: `~/.agentic-os/agentos`), marks the session accepted, and
logs to the daily memory stream. Re-accept after steering saves a fresh note.

Also this evening: documented the Agent OS estate in the Launchworks war-room
archive (BusinessAuditEngine repo `4158316` + `d9bf843` — new
`05_current-state/agent-os-and-modules.md` inventory, Briefing-A §2b,
Compendium-B PART VII).

---

## Model policy correction + per-module model settings menus

**Commit:** `48d70a0` · **Rollback:** `git revert 48d70a0` (settings.json values
survive harmlessly).

User correction: "all the Kimi K3's need to be Kimi K2.6 (chat/agentic) and
K2.7 (coding)" — the k3-first resolver violated the standing model policy.
`resolveKimiModel(preferred?)` now errors loudly on a configured-but-missing
tag and falls back k2.6-first; both policy tags live-verified on Ollama Cloud.
New shared `ModelSettings` menu (on the existing ConfigMenu/useSettings
foundation) in Brainstorm, Jarvis, Content Engine, Agents (fast/standard/deep
dial), and Hire Engine (triage/brief models). Settings are read at request
time — model changes apply to the next call with no rebuild.

---

## Hire Engine — two-stage funnel (triage everything, full-brief the pursue pile)

**Commit:** `7628d6f` · **Rollback:** `git revert 7628d6f` (triage verdicts in
`hire-state.json` survive harmlessly).

Iterated with the user in-session: first "drain the whole board" (every card
gets the full monty), then refined to a funnel — analyse ALL cards cheaply,
spend the expensive analysis only where it's warranted. Stage 1: batched haiku
triage (12 postings/call) stamps every un-judged card pursue/skip + one-line
reason. Stage 2: opus full brief for the pursue pile, best-composite first.
Skip cards keep the verdict visible (chip + drawer line) and are overruled with
the per-card Generate brief. Also this hour: verified the first live batch runs
(20/20 then 35/35, 0 failures → 81/81 leads briefed via API-driven passes), and
fixed the "Cannot GET /" on 3737 — `set PORT=3737` persisted in the cmd window,
handing Paperclip the dashboard's port on a second bat run (`d21fa98` clears it).

---

## Audit Console: client creation + brief editor (parity with the standalone console)

The /audit module can now onboard clients, not just run them. Contract kept: agent-os
NEVER writes engine files — everything goes through the engine's new `cli.mjs intake`
surface (engine commit 6eb1c8b).

- `auditEngine.ts` + `engineQueryStdin()` — pipes the intake JSON to
  `cli.mjs intake <slug> --set` on stdin, so validation is the engine's own.
- `POST /api/audit` — create a client (shells `cli.mjs new`; create-or-open semantics).
- `GET/POST /api/audit/intake` — brief read (includes BRIEF_FIELDS so the form renders
  from the engine contract, zero drift) and save-with-verdict.
- `AuditBrief.tsx` — same editor behavior as the standalone console: lists one-per-line,
  funnel_metrics/channel_history as JSON with live parse feedback, save never blocks,
  missing/vague fields outlined amber with the run-gate verdict, audit_passes +
  optional_modules (1A/3A/3B) exposed.
- `AuditConsole.tsx` — "+ New client" (create -> brief opens) and a "Brief" button per
  row; simple view toggle, no route change.

`npx tsc --noEmit` exit 0. Live click-through pends the next rebuild. Design hook's
recurring side-tab findings remain classified intentional (house status idiom).

Rollback: revert this commit; the engine's intake command stays (it is also the
standalone console's dependency-free path).

---

## Hire Engine — auto-brief at scan, auto-pitch after enrich

**Commit:** `0b28805` · **Rollback:** `git revert 0b28805`.

User report: cards had scoring/visuals but "no proposal pitches, no summaries,
no crash course." Root cause: all of it existed but only behind per-card drawer
buttons — Deal Desk briefs at ingest, the Hire Engine never got that half.
Fix mirrors deals' `briefBatch`: generation extracted to `lib/hireBrief.ts`
(prompts verbatim), `lib/hireBatch.ts` runs two background jobs — every scan
auto-briefs the best-scoring un-analysed leads; "Enrich approved" chains a pitch
pass over what it just enriched (firmographics decide pitch framing). New
`/api/hire/brief-batch` for polling/manual re-runs; scan/enrich notes show live
progress. `tsc` clean; behavior verified structurally against the deals flow —
first real pass lands with the user's next scan after rebuild.

Also diagnosed this morning: post-rebuild "server doesn't come up" was a stale
broken `.next` (start bat skips rebuilding when `.next` exists); a clean build
fixed it — verified live boot + gate on a test port. Content Engine "Cannot GET"
report: dashboard verified healthy end-to-end through the login gate
(`/content-engine` 200, list API ok) — "Cannot GET" is an Express 404 string,
i.e. a request that hit Paperclip's port, not Next.

---

## Agents module — Phases 2–4: curator, triggers, direct-HTTP tier

**Commits:** `64981ab` (curator) · `b1544ce` (triggers) · `823a9b4` (HTTP tier)
**Rollback:** revert in reverse order; `~/.agentic-os/agents/` data survives.

- **Phase 2 — Curator (Tier 1 learning).** After every successful task run and on
  user feedback (thumbs + comment → feedback route), a bounded curator run
  maintains the agent's own files: dated journal entries with multi-resolution
  compaction, durable facts, conservative `system.md` refinements. Hard
  allowlist gate (read only inside the agent dir; write only `system.md`,
  `skills/*.md`, `memory/*.md` — regex verified against 7 path cases; no shell,
  no MCP). Every `system.md` change is line-diffed into the run events +
  `curator-log.md` — no silent drift.
- **Phase 3 — Triggers.** One 60s scheduler loop booted by `src/instrumentation.ts`
  at server start. `gmail` = interval check-run with agent-side seen-list and
  NOTHING-NEW early exit (min 10m; each check is a model call); `webwatch` =
  server-side fetch + normalized sha256, fires only on change; `filewatch` =
  mtime scan (poll-based — fs.watch is unreliable on Windows); `schedule` =
  croner (due-check semantics verified live). Change-cursors only advance when a
  run actually starts → busy agents re-fire next tick, no dropped events.
  Webhooks: `POST /api/agents/hook/<id>`, timing-safe `x-agent-secret`; the path
  is exempt from the LAN gate because the secret IS the auth. Drawer grew a
  triggers editor. New dep: `croner`.
- **Phase 4 — Direct-HTTP tier.** Generic `http_request` tool (in-process SDK MCP
  server) + per-service skill docs (`skills/apis/*.md`, template seeded at agent
  creation). Secrets ride as `{{secret:NAME}}` placeholders resolved server-side
  from `~/.agentic-os/secrets.json`/env — never in prompts or transcripts. Gate:
  mutating calls to send/pay endpoints are constitution-gated in every mode;
  other mutating HTTP queues in gated mode. Prompt switched to generator form
  (custom SDK tools require streaming input).

**Verified live:** curator path-allowlist regex (7/7 cases); croner due-check;
`mcpServers` option MERGES with the settings fleet (31 = 30 user servers +
`http`); model called `mcp__http__http_request` through the gate; real GET → 200.
All four phases `tsc --noEmit` clean. Full UI click-through pends the next
rebuild — after restart the scheduler boots via instrumentation, so pollers run
without the dashboard open.

---

## Agents module — Phase 1 core runtime (the local Tasklet)

**Commit:** `cde17ba` · **Rollback:** `git revert cde17ba` (agent data lives outside
the repo in `~/.agentic-os/agents/` and survives a revert).

**What:** New top-level module "Agents" — reusable background agents à la Tasklet,
running locally on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.220,
subscription-billed via CLI OAuth, no API key). Spec hammered out and approved
first: `_specs/agents-module.md` (design session + the Perplexity "Cloning
Tasklet" blueprint reconciled — two-tier curator/runner design adopted;
Docker/LiteLLM/pgvector deliberately skipped).

Phase 1 ships: agent CRUD (per-agent dir under `~/.agentic-os/agents/<id>/` with
`agent.json`, `system.md`, `memory/`, `runs/*.jsonl`, `workspace/`), SDK runner
with a polled event stream into the UI, permission dial **bypass / gated / ask**
plus a code-enforced **constitution** (outbound send, public post, financial,
credential grant, deletion → approval in every mode; shell deletions hard-deny
with exile guidance), a global approvals inbox that parks runs mid-flight
(unresolved `canUseTool` promise) and resumes on Approve, per-run kill switch,
and MCP fleet inheritance with per-server health. Sidebar: "Agents" is its own
top-level section; the model CLI group was renamed "CLI Agents" to free the name.

**Verified (live evidence, scratchpad `smoke-agent-sdk.mjs`):**
- Subscription auth: `query()` succeeded with no `ANTHROPIC_API_KEY` in env.
- **Gate hole found by testing:** in default permission mode the CLI auto-allowed
  Bash with **0** `canUseTool` calls — a callback-only permission design would
  have silently skipped the constitution. Fix: a `PreToolUse` hook fires on every
  tool call; `deny` blocks, `ask` escalates. Chain proven live:
  `[hook] PreToolUse: Bash` → `[gate] canUseTool fired: Bash` → `SMOKE-OK`.
- MCP inheritance via `settingSources: ["user"]`: 30 servers with real statuses
  (Gmail/Upwork/Indeed connected; Slack/Notion needs-auth; fleet failed).
- Intelligence-dial model ids resolve on the CLI: `claude-sonnet-5` (standard),
  `claude-haiku-4-5` (fast); deep = pinned `CLAUDE_MODEL`.
- `npx tsc --noEmit` exit 0.

**Known limits (in spec):** pending approvals die with the server process; no
triggers yet (Phase 3); curator learning is Phase 2; UI click-through pends the
next rebuild.

Also this morning: `326d81e` checkpointed the memsearch memory journals
(07-25 → 07-28). Left untracked on purpose: `nul` (stray redirect artifact),
`.memsearch/.index.pid` (runtime PID).

---

## Audit Console module (feat-004 of the Business Audit Engine harness)

New sidebar module under **Agent Orchestration**: start and watch Business Audit Engine
runs from the dashboard. The engine stays standalone at `C:\Users\Yoshi\Documents\
BusinessAuditEngine` (override with `AUDIT_ENGINE_DIR`); Agent OS shells to its CLI and
**never writes audit state** — job bookkeeping lives on `globalThis`, in memory only.

- `src/lib/auditEngine.ts` — the bridge. `engineQuery()` for fast reads (`cli.mjs list`,
  `status`) parsing the CLI's JSON; `startAuditJob()` spawns `node cli.mjs run|distill|
  warroom` fire-and-forget with a tail buffer, mirroring the Deal Desk scrape job. A CLI
  failure is surfaced with its last stderr lines, never as an empty response.
- `src/app/api/audit/route.ts` — GET: clients + current job (one poll target).
- `src/app/api/audit/run/route.ts` — POST starts (409 if busy) and returns immediately;
  GET reports the job heartbeat plus the engine's own per-agent/per-pass status.
- `src/app/api/audit/warroom/route.ts` — GET serves `clients/<slug>/war-room.html`
  straight from the engine (served, never copied).
- `src/components/AuditConsole.tsx` + `/audit` page — client table (state, stage, brief
  readiness), ensemble-passes selector (default 3), Audit/Distill/War Room/View actions,
  live job panel with per-agent chips, per-pass chips and a log tail. The poller
  re-attaches on mount, so a reload during a multi-minute run resumes watching.
- `Sidebar.tsx` — `/audit` ("Audit Console", Radar icon, emerald) added to NAV and to
  `ORCHESTRATION_ROUTES` (membership is what places it under Agent Orchestration).

Verified: `npx tsc --noEmit` exit 0. Live click-through pending the next rebuild.
Design hook: the two side-accent status borders kept deliberately — same idiom as the
HireEngine/Deal Desk cards, and the color is the status signal.

Rollback: delete `src/lib/auditEngine.ts`, `src/app/api/audit/`, `src/app/audit/`,
`src/components/AuditConsole.tsx`; revert the two Sidebar.tsx lines.
