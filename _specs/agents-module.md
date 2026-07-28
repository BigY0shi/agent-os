# Agents — Local Tasklet Clone (Spec v1)

Status: APPROVED 2026-07-28 (open questions resolved: file-watch confirmed; standard
intelligence default with per-agent opt-up; webhooks LAN-only in v1).
Sources: design session 2026-07-28 + "Cloning Tasklet: Technical Engineering Blueprint" (Perplexity research doc).

## What we're building

A top-level Agent OS module ("Agents") where the user creates **reusable agents**:
named, long-lived automations that run on triggers, use any tool (MCP / HTTP API /
browser / CLI), learn from their runs, and ride the user's existing Claude
subscription + CLI OAuth. Functionally a local Tasklet with one structural
advantage Tasklet can't have: agents run *as the user* on this machine, so every
authenticated CLI (claude, codex, gh, hermes...) and local file is native.

## Core architecture: two-tier agents (adopted from Tasklet)

- **Tier 2 — Runner (per-run, short-lived).** Spawned per trigger fire or manual
  run. Claude Agent SDK `query()` with the agent's system prompt, skills, and
  tools. Does agentic search over the agent's memory dir (Grep/Read — not
  context-stuffing). Streams progress to the UI. Dies when the task ends.
- **Tier 1 — Curator (per-agent, long-lived logic, not a resident process).**
  After each run (and on explicit user feedback), a separate bounded SDK run
  reviews the transcript + feedback and may edit ONLY that agent's own files:
  `system.md`, `skills/*.md`, `memory/facts.md`. This is the "learns on the job"
  mechanism. Curator edits are diffed and visible in the UI (no silent drift).

## Runtime

- **Claude Agent SDK (TypeScript)** embedded in the Next.js server. Bills the
  subscription via CLI OAuth — no API key. (Known gotcha: settingSources /
  `--setting-sources=` behavior; verify at build time against current SDK docs.)
- One Node child per run; global concurrency cap (default 2); per-agent
  concurrency 1; per-run kill switch; max-turns + wall-clock timeout per run.
- No Docker/Firecracker in v1 (Windows host). Isolation = per-agent workspace
  dir as cwd + permission gates. Sandbox tier can be added later if ever needed.

## Tool access (three tiers, in Tasklet's priority order)

1. **HTTP APIs + skill docs (highest leverage).** A generic `http_request` tool
   + per-service markdown skill files (`skills/apis/<service>.md`) telling the
   agent how to call the API well. Keys referenced from existing config stores
   (`~/.agentic-os/**/config.json`), never inlined in prompts. The curator may
   refine skill docs; only the user adds new credentials.
2. **MCP fleet (inherited).** Runs load the same MCP config as the user's Claude
   Code sessions — all locally-configured servers, OAuth included. Caveat:
   connector-style servers that require interactive auth may be dead in headless
   runs → UI shows per-server health (connected / degraded / needs-auth), never
   assume.
3. **Browser (last resort).** Playwright MCP / patchright with persistent
   profiles, reusing logged-in sessions. Most brittle, most expensive.

CLI passthrough is free by construction: runs execute as the user, so `codex`,
`gh`, `hermes`, etc. work via Bash exactly as in the orchestration skill.

## Memory (file-based, adopted from Tasklet's own pivot)

Per agent, under `~/.agentic-os/agents/<id>/`:

```
agent.json          # definition (below)
system.md           # curator-maintained system prompt
skills/*.md         # curator-refinable instruction docs (APIs, procedures)
memory/facts.md     # durable distilled facts
memory/journal.md   # multi-resolution history: recent runs full-fidelity,
                    # older compressed by the curator (decay summarization)
runs/<runId>.jsonl  # full transcripts (never compressed; source of truth)
workspace/          # the run cwd — scratch + artifacts
cursors.json        # trigger state: poller cursors, seen-ids, hashes
```

No Postgres/pgvector in v1 — the SDK's agentic file search over these files IS
the retrieval mechanism (same conclusion Tasklet reached). Revisit only if an
agent's memory outgrows grep.

## Agent definition (agent.json)

```jsonc
{
  "id": "uuid", "name": "Inbox Triage", "createdAt": 0,
  "permissionMode": "gated",        // "bypass" | "gated" | "ask"
  "intelligence": "standard",        // model dial: haiku | standard | opus-tier
  "triggers": [
    { "type": "manual" },
    { "type": "webhook",  "secret": "...", "path": "/api/agents/hook/<id>" },
    { "type": "gmail",    "query": "is:unread -label:agent-seen", "intervalMin": 5 },
    { "type": "webwatch", "url": "https://...", "intervalMin": 30 },  // hash-diff
    { "type": "filewatch","path": "C:/...", "glob": "*.pdf" },
    { "type": "schedule", "cron": "0 8 * * *" }                        // v1.5
  ],
  "tools": { "mcp": "inherit", "http": ["service-names"], "browser": false },
  "enabled": true
}
```

## Permissions: modes + constitution (code-enforced, not prompt text)

Three per-agent modes (Claude Code-style dial), enforced via `canUseTool`:

- **bypass** — everything auto-approved *except constitution actions*.
- **gated** (default) — reads/research/file-work in the agent's workspace run
  free; constitution actions queue for approval.
- **ask** — every tool call queues.

**Constitution (applies in ALL modes, including bypass):** outbound email/DM
send, public posting, financial transactions, credential creation/grant, and
any deletion. Deletions additionally follow the house exile rule (move to
`.exile/`, never rm). Gated calls pause the run mid-flight (unresolved
`canUseTool` promise) and surface as approval cards in the UI + a notification;
approve resumes the same run, deny returns a refusal to the agent so it can
adapt. Timeout after N hours → run parks as "waiting".

## Triggers

- **Manual** — "Run now" with optional one-off instructions appended.
- **Webhook** — `POST /api/agents/hook/<id>` with per-agent secret header;
  this path bypasses the LAN password gate (secret IS the auth). Body is
  passed to the run as trigger payload.
- **Pollers** (one scheduler loop in the server, interval per trigger):
  - *Gmail*: search-query poller via Gmail MCP; seen-ids in cursors.json.
  - *Web watch*: fetch URL, hash content region, fire on change with diff.
  - *File watch*: chokidar on a path/glob; fires with the new file path.
- **Schedule (v1.5)** — cron expressions on the same scheduler loop. Deferred
  only because nothing above depends on it; it's a ~50-line add.
- Poller loop lives in the Next.js server process (matches existing modules'
  lifetime); missed fires while the server is down are NOT replayed in v1
  (documented limitation of the always-on-PC model).

## UI (src/app/agents/, top-level sidebar entry)

- **Agent list** — cards: name, enabled toggle, triggers, last run status,
  permission mode badge.
- **Agent detail** — definition editor; skills/system.md viewer with curator
  diff history; run history; memory viewer; MCP health panel.
- **Run view** — live transcript stream (SDK events), tool-call timeline,
  approval cards inline, kill button, feedback (👍/👎 + comment → curator).
- **Approvals inbox** — global queue of pending gated actions across agents.

## Explicitly skipped (from the blueprint)

- Docker/Firecracker sandbox, Blaxel-style VMs — wrong cost/benefit on a
  personal Windows box; permission gates + workspace scoping instead.
- LiteLLM/Bifrost gateway — subscription-billed SDK is the point; multi-model
  workers remain available *inside* runs via CLI shell-out (codex/hermes).
- Postgres + pgvector — file-based memory (see above).
- HashiCorp Vault — existing config-file stores; single-user machine.
- Multi-user governance / SOC2 concerns — single operator.

## Build phases (each phase ships usable)

1. **Core runtime** — agent CRUD + storage, SDK runner, manual trigger, live
   run view, permission modes + constitution + approvals inbox.
2. **Curator** — post-run reflection, skills/system.md editing with diffs,
   feedback loop, journal compaction.
3. **Triggers** — scheduler loop, webhook route, Gmail poller, web watch,
   file watch. (Schedule/cron rides along here if trivial.)
4. **Skills/API tier** — http_request tool + skill-doc convention + per-service
   docs for the user's actual stack.

## Open questions

1. The third "app-event" source from the design session ("Something else") —
   file-watch has been assumed from the blueprint's trigger list. Confirm or
   name the intended source.
2. Intelligence dial default: standard (sonnet-tier) with opt-up per agent?
3. Webhook exposure beyond LAN (tunnel?) — out of scope v1 unless needed.
