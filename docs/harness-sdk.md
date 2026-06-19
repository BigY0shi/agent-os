# Harness SDK — Agent OS bundles

This document defines how **agent runtimes** (CrewAI, OpenClaw, LangGraph, custom workers) sync with the Agent OS control plane.

## Goals

- **Push**: export portable specs (AGENT.md / SKILL.md / policy) from dashboard data.
- **Pull**: report heartbeats, run logs, costs, and errors back into SQLite via APIs (future dedicated endpoints; today: reuse `/api/tasks`, `/api/costs`, `/api/alerts` patterns).

## Bundle layout (v1)

Recommended directory a harness worker watches:

```text
bundle/
  manifest.json
  agents/
    <slug>/
      AGENT.md
      policy.json        # optional RBAC hints for runtime
  skills/
    <skill-slug>-SKILL.md
  pipelines/
    <pipeline-id>.json   # same shape as DB definition_json
```

**Example bundle:** [docs/examples/bundle/](./examples/bundle/) — copy-ready layout aligned with dashboard exports.

### `manifest.json`

```json
{
  "version": 1,
  "generated_at": "2026-02-01T12:00:00.000Z",
  "source": "agent-os-dashboard",
  "agents": [{ "id": 1, "slug": "content-agent", "path": "agents/content-agent/AGENT.md" }],
  "skills": [{ "id": 1, "slug": "content-writing", "path": "skills/content-writing-SKILL.md" }],
  "pipelines": [{ "id": 1, "path": "pipelines/1.json" }]
}
```

## `AGENT.md` (aligned with dashboard export)

The dashboard already exports AGENT.md from the Agents page. A harness adapter should treat sections as stable contracts:

- **Identity** — name, role, department
- **Goal / Vibe**
- **System prompt**
- **Tools** — resolved from `assigned_tools`
- **Skills** — resolved from `assigned_skills`
- **Config** — JSON blob (timeouts, model hints)

## `SKILL.md` (aligned with Skills page)

Use the existing SKILL.md export from the Skills & Tools page (YAML frontmatter + process steps).

Optional extensions (when columns present in DB):

- **Tags** — `tags` JSON array for discovery
- **IO schema** — `io_schema` JSON for validation in harness
- **Required tools** — `required_tools` JSON list

## Pipelines

Pipeline JSON matches [docs/agent-os/SKILL_PIPELINE_SPEC.md](./agent-os/SKILL_PIPELINE_SPEC.md):

- `nodes[]` with `id`, `skillId`, optional `inputs`
- `edges[]` optional DAG; empty edges = execute nodes in order

Harnesses should:

1. Validate against the same rules as `/api/pipelines` (`lib/pipelineValidate.js`).
2. Emit **run records** via `POST /api/pipelines/:id/runs` and `PATCH /api/pipelines/:id/runs/:runId`.

## Memory bootstrap

Before a run, agents should call:

- `POST /api/memory/retrieve` with `{ "query": "...", "layers": ["long","mid"] }`

and after significant facts are learned:

- `POST /api/memory` to persist with proper `layer` and `sensitivity`.

## v1.1 runtime sync

- **Bundle pull:** `GET /api/harness/bundle` or `?agent_id=1` — manifest + AGENT.md / SKILL.md / pipeline JSON files.
- **Heartbeat:** `POST /api/runtimes/heartbeat` with `{ "agent_id", "runtime_type", "status" }`.
- **Runs:** `POST /api/agent-runs`, `PATCH /api/agent-runs/:id` with `duration_ms`, `cost_usd`.
- **Honcho:** operator `POST /api/honcho/sync` mirrors conclusions into `memory_entries` (`source: honcho`).

See [docs/agent-os/V1_1.md](./agent-os/V1_1.md).

## Authentication

When `AGENT_OS_API_KEYS` is set, harness workers must send `Authorization: Bearer <token>` or `x-api-key: <token>` and use a role of at least **`agent-runtime`** for memory writes and pipeline run mutations.

## Reference ecosystems (patterns)

- [SpharxTeam/AgentOS](https://github.com/SpharxTeam/AgentOS) — layered OS thinking
- [buildermethods/agent-os](https://github.com/buildermethods/agent-os) — packaging inspiration
- [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss) — multi-agent packaging
- [Q00/ouroboros](https://github.com/Q00/ouroboros) — loop / self-referential workflows (treat as design bibliography)

## Versioning

Bump `manifest.version` when breaking changes occur to folder layout or required fields.
