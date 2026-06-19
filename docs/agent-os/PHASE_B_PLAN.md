# Phase B — Dashboard surfaces

**Status:** In progress (B1 ✅, B2 ✅, B3 ✅, B4.1 audit ✅)  
**Parent plan:** [agent_os_platform plan](/opt/cursor/artifacts/plans/agent_os_platform_9cd73a1d.plan.md) — Phase B section  
**Last updated:** 2026-04-12

Phase A shipped **contracts + schema + minimal UI**. Phase B makes the control plane **operator-complete**: attach memory to the fleet, compose real pipelines, and govern autonomy without curl or SQLite.

---

## Baseline (Phase A — done)

| Area | Already exists |
|------|----------------|
| Memory | `/memory` list/create/retrieve/promote/forget; `agent_id` / `team_id` columns; PATCH promote |
| Pipelines | `/pipelines` multi-step editor, DAG edges, run console, global runs ✅ |
| Governance data | SQLite tables: `tool_proposals`, `tool_releases`, `safety_events`, `agent_goals`, `agent_opinions`; extended `decisions.type` |
| Governance UI | `/governance` — proposals, safety, goals/opinions, model changes ✅; `/approvals` typed filters ✅ |
| Audit | `GET /api/audit` + **`/audit` UI** ✅ |
| Agents | Memory tab ✅; goals/opinions/model provider on Governance tab ✅ |
| Model providers | `model_providers` table + Settings tab + agent assignment ✅ |

---

## Phase B goals (one sentence each)

1. **Memory is fleet-aware** — operators attach entries to agents/teams and see context from the agent side.
2. **Pipelines are composable** — multi-step (and optional DAG) builder with a usable run console.
3. **Governance is actionable** — proposals, goals, safety events, typed elevation requests, **and runtime vs model provider registry** have APIs + UI + audit trail.

---

## Out of scope (Phase B)

- Honcho sync bridge, Hermes bundle push, live gateway heartbeats (→ v1.1 / Phase C)
- Vector embeddings / semantic search backend
- Visual DAG canvas (React Flow) — ordered list + optional edges is enough for B
- Multi-user login UI (roles stay env/API-key based)
- Persisting Settings harness URLs to DB (optional stretch; not a win gate)

---

## Milestone B1 — Memory attach & agent context

**Goal:** Memory OS is the place to curate **who knows what** across the agent fleet.

### Deliverables

| # | Deliverable |
|---|-------------|
| B1.1 | Memory create/edit: **agent picker** + **team/department picker** (from `/api/agents`, department ids) |
| B1.2 | Memory list: filters for `agent_id`, `team_id`, sensitivity badge |
| B1.3 | Memory detail drawer: edit title/content/tags, reassign agent/team |
| B1.4 | **Agents page:** “Memory context” panel on agent detail — fetch `/api/memory?agent_id=` + link to Memory OS filtered view |
| B1.5 | Optional: `memory_links` API stub (`POST /api/memory/:id/links`) for “related memory” (read-only list in UI) |

### Win gates ✅

| Gate | Proof | Status |
|------|--------|--------|
| **W1.1 Attach** | Create a memory entry assigned to agent “Content Agent”; it appears only when filtering by that agent | ✅ UI: agent picker + `agent_only` filter |
| **W1.2 Agent view** | Open agent in `/agents` → see ≥1 attached memory with layer + title; click through to Memory OS | ✅ Memory tab + deep links |
| **W1.3 Promote path** | Promote entry `working → mid → long` from UI; `promoted_at` updates; action visible in audit | ✅ Promote + `/audit` |
| **W1.4 Retrieve scope** | `POST /api/memory/retrieve` with `agent_id` returns agent-scoped + global (null agent) entries | ✅ API + retrieve panel |

**Estimate:** 1 milestone (~3–5 focused tasks)

---

## Milestone B2 — Pipeline builder & run console

**Goal:** Operators compose **multi-step skill pipelines** and inspect runs without editing JSON by hand.

### Deliverables

| # | Deliverable |
|---|-------------|
| B2.1 | Pipeline **editor**: add/remove/reorder nodes; each node = skill dropdown + optional inputs JSON |
| B2.2 | **Edit existing** pipeline `definition_json` (not create-only) |
| B2.3 | Optional **edges** UI: linear default; “advanced” toggle to set `from` / `to` per edge; validate via existing `validatePipelineDefinition` |
| B2.4 | Pipeline status lifecycle: draft → active → archived (UI + PATCH) |
| B2.5 | **Run console**: start run (`POST .../runs`), patch status/output (`PATCH .../runs/:runId`); show timeline, error, input/output JSON |
| B2.6 | Run history **global strip** or tab: recent runs across all pipelines (query `pipeline_runs` with limit) |

### Win gates ✅

| Gate | Proof | Status |
|------|--------|--------|
| **W2.1 Compose** | Build a **3-node** pipeline (3 different skills), save, reload page — definition intact | ✅ Editor + PUT |
| **W2.2 Validate** | Attempt to save a cycle or duplicate node id — UI shows API validation error | ✅ Client + API validate |
| **W2.3 Execute** | Queue a run → mark running → mark succeeded with sample `output_json` — all visible in run console | ✅ Run console + demo |
| **W2.4 Export** | Downloaded pipeline JSON matches SKILL_PIPELINE_SPEC shape | ✅ Export JSON button |

**Estimate:** 1–2 milestones (~5–8 tasks)

---

## Milestone B3 — Governance console + model providers

**Goal:** Autonomy primitives in SQLite become **first-class operator workflows**, with a clear split between **agent runtimes** (Hermes, OpenClaw, CLI harnesses) and **model providers** (Ollama Cloud/local, Anthropic, OpenAI, Google, etc.).

See [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md).

### Deliverables

| # | Deliverable |
|---|-------------|
| B3.1 | **APIs** (CRUD + resolve where applicable): |
| | `app/api/tool-proposals/*` — submit, list, approve/reject |
| | `app/api/safety-events/*` — list, mitigate/override |
| | `app/api/agent-goals/*` — CRUD per agent |
| | `app/api/agent-opinions/*` — CRUD; optional link to `evidence_memory_id` |
| B3.2 | **`/governance` page** (or extend `/approvals` with tabs): Proposals · Safety · Goals & opinions · **Model changes** |
| B3.3 | **Approvals upgrade:** filter/badge for `tool_publish`, `infra_change`, `model_change`, `data_access`; severity in details JSON |
| B3.4 | Agent detail: **Goals stack** + **Opinions** + **Runtime & model** (provider dropdown + `model_id`) |
| B3.5 | Tool proposal flow: agent-runtime can POST proposal → operator approves → optional `tool_releases` row on approve |
| B3.6 | All mutations → `appendAuditLog` with consistent `resource_type` |
| B3.7 | **`model_providers` table** + `app/api/model-providers/*` — CRUD; seed Ollama Cloud, Ollama local, Anthropic, OpenAI, Google, openai-compatible |
| B3.8 | **Agents migration:** `model_provider_id`, `model_id`; scaffold/edit forms; AGENT.md export includes runtime + model |
| B3.9 | **Settings → Model providers** — base URL, default model, `api_key_env` name (no secrets in DB); separate from Harness URLs |
| B3.10 | **`model_change` workflow:** decision → approve → update agent model fields → audit |

### Win gates ✅

| Gate | Proof | Status |
|------|--------|--------|
| **W3.1 Proposal** | Submit tool proposal from UI → status `submitted` → operator approves → status `approved`; row in audit log | ✅ |
| **W3.2 Safety** | Create/open safety event → operator marks `mitigated` with note | ✅ |
| **W3.3 Goals** | Add 2 goals to an agent, reorder by priority, mark one `done` — visible on agent + governance page | ✅ |
| **W3.4 Typed decision** | Create decision `type: tool_publish` → appears in approvals filter → approve/reject works | ✅ |
| **W3.5 Auth** | With `AGENT_OS_API_KEYS` set: viewer cannot approve; operator can | ✅ (authz layer) |
| **W3.6 Provider registry** | Add Ollama Cloud provider with base URL + default model; listed in Settings and API | ✅ |
| **W3.7 Agent model assign** | Assign agent: runtime `hermes-workspace` + provider `ollama-cloud` + model `llama3.3`; visible on agent detail + AGENT.md export | ✅ |
| **W3.8 Model change** | Submit `model_change` decision → operator approves → agent `model_id` updates; audit entry | ✅ |

**Estimate:** 2 milestones (~10–14 tasks)

---

## Milestone B4 — Audit explorer & Phase B exit

**Goal:** Every Phase B action is **traceable**; Phase B has a single demo script.

### Deliverables

| # | Deliverable |
|---|-------------|
| B4.1 | **`/audit` page** — paginated `GET /api/audit`; filter by `resource_type`, `action`, date | ✅ Shipped |
| B4.2 | Cross-links: memory/pipeline/governance rows link to filtered audit view |
| B4.3 | **`docs/agent-os/PHASE_B_DEMO.md`** — 10-minute operator walkthrough script |
| B4.4 | README + ROADMAP: mark Phase B complete; list Phase C entry criteria |

### Win gates ✅

| Gate | Proof |
|------|--------|
| **W4.1 Trace** | After W1.3 + W3.1 + W2.3, audit page shows `memory.promote`, `tool_proposal.approve`, `pipeline.run` (or equivalent actions) |
| **W4.2 Build** | `npm run build` passes; no new eslint errors on touched pages |
| **W4.3 Demo** | Another person can follow PHASE_B_DEMO.md on a fresh DB and pass W1–W3 gates without developer help |

**Estimate:** 0.5 milestone (~2–3 tasks)

---

## Recommended order

```text
B1 (memory attach)  →  B4.1 audit (early visibility helps debug)
        ↓
B3 (governance APIs + UI)  — parallel track possible after B1
        ↓
B2 (pipeline builder)  — can start after B1; independent of B3
        ↓
B4 exit (demo doc, ROADMAP)
```

**Suggested first sprint:** B1 + B4.1 (operator-visible memory + audit)  
**Second sprint:** B3 APIs + governance tab  
**Third sprint:** B2 multi-step pipelines + run console  
**Fourth sprint:** B4 demo + polish

---

## Phase B complete — definition of done

Phase B is **done** when **all** of the following are true:

- [ ] Win gates **W1.1–W1.4** (Memory attach) — ✅ done
- [ ] Win gates **W2.1–W2.4** (Pipelines) — ✅ done
- [x] Win gates **W3.1–W3.8** (Governance + model providers) — ✅ done
- [ ] Win gates **W4.1–W4.3** (Audit & demo)
- [ ] `npm run build` green
- [ ] No Phase B scope creep (Honcho bridge / harness push deferred)

---

## Phase C entry criteria (preview)

Start Phase C when Phase B exit is met **and** at least one of:

- SQLite write contention or Pi deploy needs a split memory reader service
- Semantic retrieval requires vector backend
- Agent runtimes need MCP gateway parity with HTTP memory tools

---

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [MEMORY_MODEL.md](./MEMORY_MODEL.md)
- [SKILL_PIPELINE_SPEC.md](./SKILL_PIPELINE_SPEC.md)
- [GOVERNANCE.md](./GOVERNANCE.md)
- [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md)
