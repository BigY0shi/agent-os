# Dev Journal — 2026-07-28

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
