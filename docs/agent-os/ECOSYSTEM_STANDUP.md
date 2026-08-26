# Ecosystem engineering spec & greenfield handoff

**Document type:** Engineering specification · Agent schema · Operator handoff  
**Audience:** Principal engineer, operator (Yoshi), future implementers  
**Assumption:** **Greenfield** — no codebase, no LXCs, no Honcho workspace yet. Build toward a **persistent, ambient, agentic** fleet on a private LAN.

**Version:** 1.0 · April 2026

---

## 1. Vision (one paragraph)

Build a **private, always-on agent fleet** where multiple harnesses (Hermes Workspace, OpenClaw, Claude Code, Codex, Gemini) share **one user model** (Honcho), obey **one governance plane** (Agent OS), and remain **observable, approvable, and auditable** without the operator living in terminals. “Ambient” means: memory and context survive sessions; heartbeats and runs surface on a kiosk dashboard; specs push/pull automatically; elevation (tools, models, infra) requires explicit approval.

---

## 2. Design principles

| Principle | Meaning | Non-goal |
|-----------|---------|----------|
| **Persistent** | Facts, goals, audit, and user model survive process restarts | Replacing Honcho or SQLite with “session-only” chat |
| **Ambient** | Operator glances at dashboard/Pi kiosk; agents run on LXCs 24/7 | Operator must SSH for routine status |
| **Agentic** | Agents propose tools, models, actions; humans/policy approve | Fully autonomous production writes without audit |
| **Harness-agnostic** | Agent OS owns specs; runtimes are adapters | Re-implementing Hermes chat/terminal in Agent OS |
| **Split memory** | Honcho = *who is the user*; Agent OS = *what the fleet must know* | Single flat key-value store for everything |
| **Split inference** | Runtime = *where it runs*; model provider = *who answers* | Conflating Ollama/Honcho/Hermes into one “model” dropdown |

---

## 3. Physical topology (reference deployment)

```text
                    ┌─────────────────────────────────────┐
                    │  Operator surfaces                   │
                    │  · Pi tablet (kiosk) — Agent OS UI   │
                    │  · Desktop browser                   │
                    └──────────────────┬──────────────────┘
                                       │ HTTP :3000 (LAN)
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Control plane host (Pi 5 or small VM)                            │
│  Agent OS — Next.js + SQLite (sql.js)                             │
│  · Fleet registry, memory catalog, pipelines, governance, audit   │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                               │
                │ bundle pull/push, heartbeats    │ Honcho API
                ▼                               ▼
┌───────────────────────────────┐   ┌────────────────────────────┐
│  Proxmox — LXC: Hermes         │   │  Proxmox — LXC: Honcho        │
│  192.168.0.168                 │   │  192.168.0.99:8000            │
│  · Workspace UI :3000          │   │  · Workspace: hermes          │
│  · Gateway        :8642        │   │  · User peer: yoshi           │
│  · memory.provider: honcho     │   │  · AI peers: hermes, claude,  │
└───────────────┬───────────────┘   │    codex, gemini (planned)    │
                │                   └────────────────────────────┘
                │  (optional)
                ▼
┌───────────────────────────────┐
│  Proxmox — LXC: OpenClaw       │
│  Gateway ~:18789               │
│  No workspace UI               │
└───────────────────────────────┘
```

**Network rules**

- Honcho LXC is **not** on the Hermes host; Hermes reaches Honcho over LAN.
- Agent OS reaches all three for health probes and Honcho sync.
- API keys for Honcho live in harness env and Agent OS server env — **never** in SQLite as secret values.

---

## 4. Logical architecture (four planes)

```text
┌─────────────────────────────────────────────────────────────────┐
│  EXPERIENCE — Dashboard, kiosk, approvals, memory/pipeline UIs   │
├─────────────────────────────────────────────────────────────────┤
│  CONTROL API — REST + RBAC, audit on mutation, decision queue      │
├─────────────────────────────────────────────────────────────────┤
│  KERNEL DATA — SQLite: agents, memory_entries, pipelines, audit    │
├─────────────────────────────────────────────────────────────────┤
│  ADAPTERS — Honcho bridge, harness bundle, MCP, model providers    │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
    Hermes LXC           OpenClaw LXC          Honcho LXC
    (runtime)            (runtime)             (memory)
```

### Source-of-truth matrix

| Data | Canonical store | Agent OS role |
|------|-----------------|---------------|
| User preferences, session conclusions, peer cards | **Honcho** | Mirror *long* layer via sync (operator-triggered or worker) |
| Fleet specs (AGENT.md, skills, tools) | **Agent OS** → pushed/pulled to harnesses | Authoring + export |
| Approvals, tool publish, model change | **Agent OS** `decisions` | Operator workflow |
| Operator-curated fleet facts (SOPs, policies) | **Agent OS** `memory_entries` `long` | Memory OS |
| Session scratch, tool traces | **Harness runtime** | Optional run reports via API |
| Inference endpoints | **Model providers** registry + env secrets | Assignment per agent |

---

## 5. Greenfield build phases

Execute in order. Each phase has **exit criteria** before the next starts.

### Phase 0 — Foundation (week 1)

**Deliver:** Runnable Agent OS with SQLite, auth scaffold, agent CRUD, AGENT.md export.

| # | Work item | Exit criteria |
|---|-----------|---------------|
| 0.1 | Next.js app + `lib/db.js` schema bootstrap | `npm run build` green |
| 0.2 | `agents`, `skills`, `tools`, `sections` tables + seed fleet | 20+ agents in UI |
| 0.3 | RBAC env `AGENT_OS_API_KEYS` | viewer cannot write when keys set |
| 0.4 | Pi deploy script + kiosk autostart | Dashboard loads on boot |

### Phase A — Contracts (week 2)

**Deliver:** Memory, pipelines, governance tables + minimal APIs (curl-testable).

| # | Work item | Exit criteria |
|---|-----------|---------------|
| A.1 | `memory_entries` + retrieve + promote | `POST /api/memory/retrieve` returns scoped hits |
| A.2 | `pipelines` + `pipeline_runs` + validation | Invalid DAG rejected |
| A.3 | `decisions`, `tool_proposals`, `audit_log` | Approve writes audit row |
| A.4 | Docs: MEMORY_MODEL, SKILL_PIPELINE_SPEC, GOVERNANCE | Linked from README |

### Phase B — Operator-complete UI (weeks 3–5)

**Deliver:** Memory attach, pipeline editor, governance console, model providers, audit explorer.

| Milestone | Exit |
|-----------|------|
| B1 Memory | Agent-scoped memory tab + filters |
| B2 Pipelines | 3-node editor + run console |
| B3 Governance | Proposals, safety, goals, `model_change` |
| B4 Audit | Cross-links + `PHASE_B_DEMO.md` walkthrough |

### Phase C — Runtime integration (weeks 6–8)

**Deliver:** Proxmox LXCs wired; Honcho shared; harness sync live.

| # | Work item | Exit criteria |
|---|-----------|---------------|
| C.1 | Hermes LXC + Honcho LXC provisioned | `curl :8000/health` → 200 |
| C.2 | Hermes `memory.provider: honcho` | `hermes honcho status` OK |
| C.3 | Agent OS runtime health + Honcho sync | Dashboard pills green; sync creates `memory_entries` |
| C.4 | Bundle pull on Hermes (`harness-pull-bundle.mjs`) | Cron updates `~/.hermes/agent-os-bundle/` |
| C.5 | Heartbeats + `agent_runs` | Runtime tab shows last heartbeat |
| C.6 | Register Honcho peers (claude, codex, gemini) | `POST /api/honcho/peers` succeeds |

### Phase D — Ambient operations (ongoing)

- Auto-refresh dashboard runtimes (30s polling).
- Alert rules (agent stuck, cost spike).
- Honcho ↔ Agent OS scheduled sync worker.
- OpenClaw full spec import (when gateway contract exists).

---

## 6. Agent schema (canonical)

### 6.1 Fleet record (`agents` table)

Every agent in the fleet is a row with **identity**, **runtime**, **model**, and **assignment** fields.

```sql
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  department TEXT,              -- ceo|cto|cmo|cfo|coo|cio|chro
  section TEXT,                 -- legacy alias for department
  goal TEXT,
  vibe TEXT,
  system_prompt TEXT,
  framework TEXT,               -- runtime id (see §6.2)
  harness TEXT,                 -- legacy alias for framework
  status TEXT,                  -- active|running|idle|error|scheduled
  agent_type TEXT DEFAULT 'worker',  -- worker|manager
  stage TEXT DEFAULT 'ideate',       -- ideate|build|test|deploy|observe
  memory_enabled INTEGER DEFAULT 0,
  assigned_tools TEXT,          -- JSON array of tool ids
  assigned_skills TEXT,         -- JSON array of skill ids
  model_provider_id INTEGER,    -- FK model_providers
  model_id TEXT,                -- e.g. llama3.3, claude-sonnet-4-6
  config TEXT,                  -- JSON: timeouts, hints
  tasks_today INTEGER DEFAULT 0,
  quality_score TEXT,
  cost_today REAL DEFAULT 0,
  created_at TEXT
);
```

### 6.2 Runtime (`framework`) enumeration

| `framework` id | Host | Operator UI | Notes |
|----------------|------|-------------|-------|
| `hermes-workspace` | Hermes LXC | `http://192.168.0.168:3000` | Primary; gateway `:8642` |
| `openclaw` | OpenClaw LXC | Gateway only ~`:18789` | Fleet orchestration via Agent OS |
| `claude-code` | IDE / CLI | — | Honcho peer `claude` |
| `codex` | CLI | — | Honcho peer `codex` |
| `gemini` | CLI | — | Honcho peer `gemini` |
| `crewai` | legacy | — | Optional |
| `custom` | user-defined | — | Extension point |

### 6.3 Model assignment (orthogonal to runtime)

```text
Agent record:
  framework:      hermes-workspace    ← WHERE it runs
  model_provider: ollama-cloud        ← WHO provides inference (slug)
  model_id:       llama3.3            ← WHICH model
```

`model_change` decisions gate changes to provider/model. See GOVERNANCE.md.

### 6.4 AGENT.md export contract (harness-facing)

Portable spec every runtime must accept. **Stable section headings** — adapters parse by header.

```markdown
# Agent: {name}

## Identity
- **Role:** …
- **Department:** …
- **Type:** Manager | Worker
- **Framework:** …

## Goal
…

## Personality & Vibe
…

## System Prompt
…

## Assigned Tools
- tool-name

## Assigned Skills
- skill-name

## Configuration
- **Memory:** Enabled | Disabled
- **Runtime:** …
- **Model provider:** {slug or id}
- **Model id:** …
- **Stage:** …
- **Status:** …
```

Optional JSON sidecar (`policy.json`) for RBAC hints at runtime.

### 6.5 SKILL.md contract

YAML frontmatter + markdown body. See Skills page export format in harness-sdk.

### 6.6 Honcho mapping (per agent)

| Agent OS | Honcho |
|----------|--------|
| Human operator | **Peer** `yoshi` (user) |
| Hermes agent persona | **AI peer** `hermes` |
| Claude Code agent | **AI peer** `claude` (register via API) |
| Workspace | `hermes` |
| `recallMode` | `hybrid` (Hermes-side) |

Do **not** duplicate Honcho conclusions in agent `system_prompt`; inject via Honcho at runtime.

---

## 7. Memory architecture

### 7.1 Agent OS layers (`memory_entries`)

| Layer | Use | Promotion |
|-------|-----|-----------|
| `working` | Session scratch | → `mid` via UI/API |
| `mid` | Recurring context | → `long` |
| `long` | SOPs, fleet facts | operator-curated |
| `artifact` | Pointers (URLs, paths) | — |

Fields: `agent_id`, `team_id` (department), `sensitivity` (`public`|`internal`|`confidential`), `source`, `external_id` (for Honcho idempotency).

### 7.2 Honcho (runtime user model)

- **Workspace** `hermes` — top-level isolation.
- **Dialectic reasoning** after turns (`dialecticCadence: 5` typical).
- **Conclusions** — memory atoms; sync into Agent OS `long` layer with `source: honcho`.

### 7.3 Retrieval contract

```http
POST /api/memory/retrieve
{
  "query": "brand voice",
  "agent_id": 1,
  "layers": ["long", "mid"]
}
```

Returns agent-scoped + fleet-wide (`agent_id` null) entries. Logged in `memory_access_log` / audit.

---

## 8. Governance & autonomy

### 8.1 Roles

| Role | Capabilities |
|------|----------------|
| `admin` | All |
| `operator` | Approve, promote memory, push bundle, Honcho sync |
| `agent-runtime` | Memory R/W (scoped), pipeline runs, proposals, heartbeats |
| `viewer` | Read dashboard |

### 8.2 Decision types

| `type` | Trigger | On approve |
|--------|---------|------------|
| `tool_publish` | Agent proposes new tool | Optional `tool_releases` row |
| `model_change` | Agent requests new model | Update `agents.model_*` |
| `infra_change` | Deploy / config change | Manual follow-up |
| `data_access` | Confidential memory read | Audit + grant window |

### 8.3 Autonomy primitives

- `tool_proposals` — spec + risk class + tests checklist.
- `safety_events` — open → mitigated | overridden.
- `agent_goals` — prioritized stack per agent.
- `agent_opinions` — claims with optional `evidence_memory_id`.

Every mutation → `audit_log` with `resource_type`, `resource_id`, `actor`.

---

## 9. Harness integration

### 9.1 Bundle layout (v1)

```text
bundle/
  manifest.json
  agents/<slug>/AGENT.md
  skills/<slug>-SKILL.md
  pipelines/<id>-<name>.json
```

### 9.2 Sync directions

| Direction | Mechanism | When |
|-----------|-----------|------|
| Agent OS → Hermes | HTTP push to gateway **or** pull script on LXC | On save / cron 5m |
| Agent OS → OpenClaw | Same bundle to gateway | When OpenClaw configured |
| Honcho → Agent OS | `POST /api/honcho/sync` | Operator or scheduled worker |
| Runtime → Agent OS | `POST /api/runtimes/heartbeat`, `POST /api/agent-runs` | Every 30–60s / per run |

### 9.3 Pull worker (on Hermes LXC)

```bash
AGENT_OS_URL=http://<control-plane>:3000
AGENT_OS_HONCHO_API_KEY=local-dev   # if required
node scripts/harness-pull-bundle.mjs --out ~/.hermes/agent-os-bundle
```

### 9.4 Heartbeat payload

```json
{
  "agent_id": 1,
  "runtime_type": "hermes-workspace",
  "status": "online",
  "gateway_url": "http://192.168.0.168:8642"
}
```

### 9.5 Run report payload

```json
{
  "agent_id": 1,
  "runtime_type": "hermes-workspace",
  "status": "succeeded",
  "duration_ms": 42000,
  "cost_usd": 0.12,
  "output": { "summary": "…" }
}
```

---

## 10. Environment specification

### 10.1 Agent OS (control plane)

```bash
# Runtime probes
AGENT_OS_HERMES_UI_URL=http://192.168.0.168:3000
AGENT_OS_HERMES_GATEWAY_URL=http://192.168.0.168:8642
AGENT_OS_HONCHO_URL=http://192.168.0.99:8000
AGENT_OS_HONCHO_API_KEY=local-dev
AGENT_OS_HONCHO_WORKSPACE=hermes
AGENT_OS_HONCHO_USER_PEER=yoshi
AGENT_OS_HONCHO_AI_PEER=hermes
AGENT_OS_OPENCLAW_GATEWAY_URL=          # optional

# Auth (production)
AGENT_OS_API_KEYS='{"<token>":"operator","<runtime-token>":"agent-runtime"}'
AGENT_OS_REQUIRE_API_KEY_FOR_READ=false # true in hardened deploy

# Optional push overrides
AGENT_OS_HERMES_PUSH_URL=
AGENT_OS_HERMES_GATEWAY_TOKEN=
```

### 10.2 Hermes LXC

```yaml
# ~/.hermes/config.yaml
memory:
  provider: honcho
```

```bash
# ~/.hermes/.env
HONCHO_API_KEY=...
```

```json
// ~/.honcho/config.json (client)
{
  "baseUrl": "http://192.168.0.99:8000",
  "hosts": {
    "hermes": {
      "enabled": true,
      "workspace": "hermes",
      "peerName": "yoshi",
      "aiPeer": "hermes"
    }
  },
  "recallMode": "hybrid",
  "dialecticCadence": 5
}
```

### 10.3 Honcho LXC

- Listen `:8000` on LAN.
- API key `local-dev` (dev) → rotate for production.
- Health: `GET /health` → 200.

---

## 11. API surface (minimum viable)

| Group | Endpoints |
|-------|-----------|
| Fleet | `GET/POST/PUT/DELETE /api/agents` |
| Memory | `GET/POST /api/memory`, `POST /api/memory/retrieve`, `PATCH /api/memory/:id` |
| Pipelines | `GET/POST/PUT /api/pipelines`, `POST/PATCH .../runs` |
| Governance | `GET/POST /api/decisions`, `tool-proposals`, `safety-events`, `agent-goals` |
| Models | `GET/PUT /api/model-providers` |
| Audit | `GET /api/audit` |
| Runtimes | `GET /api/runtimes/health`, `POST /api/runtimes/heartbeat` |
| Honcho | `GET /api/honcho/status`, `POST /api/honcho/sync`, `POST /api/honcho/peers` |
| Harness | `GET /api/harness/bundle`, `POST /api/harness/push` |
| Runs | `GET/POST /api/agent-runs`, `PATCH /api/agent-runs/:id` |

Full contracts: implement routes under `app/api/*` with `lib/authz.js` gates.

---

## 12. Corporate fleet model

Departments map to C-suite **squads**. Default seed:

| Department | Id | Typical agents |
|------------|-----|----------------|
| CEO | `ceo` | Strategy, pitches |
| CTO | `cto` | Research, deploy, QA |
| CMO | `cmo` | Content, SEO, social |
| CFO | `cfo` | Data, budgets, billing |
| COO | `coo` | Clients, workflows |
| CIO | `cio` | Compliance, security |
| CHRO | `chro` | Support, culture |

**Manager** agents (`agent_type: manager`) delegate to workers in the same department (v1.2 orchestration).

Lifecycle **stage**: `ideate → build → test → deploy → observe` (Agent OS `/pipeline` kanban — distinct from Hermes Kanban DB).

---

## 13. Security & compliance checklist

- [ ] Honcho not exposed to public internet without TLS + auth.
- [ ] `AGENT_OS_API_KEYS` set on Pi production; separate runtime token.
- [ ] Confidential memory hidden from `viewer` and `agent-runtime` list.
- [ ] MCP `env` redacted unless operator + `?include_secrets=1`.
- [ ] SQLite file permissions `600` on control plane host.
- [ ] Model provider registry stores **env var names** only, not API secrets.
- [ ] Audit log retained; backup SQLite nightly.

---

## 14. Operator handoff — day-one runbook

### 14.1 Provision order

1. **Proxmox** — create LXCs: Honcho, Hermes, (optional) OpenClaw.
2. **Honcho** — install, `:8000`, create workspace `hermes`, peer `yoshi`.
3. **Hermes** — install Workspace, point Honcho client at `.99:8000`.
4. **Agent OS** — deploy on Pi or VM; set env §10.1.
5. **Seed fleet** — import agents or use seed data; assign frameworks.
6. **Bundle** — cron pull on Hermes; verify `manifest.json` updates.
7. **Honcho sync** — Settings → Sync; confirm Memory OS `source: honcho` rows.
8. **Governance** — enable API keys; walk `PHASE_B_DEMO.md`.

### 14.2 Daily operator loop (~10 min)

1. Glance dashboard — runtime pills, pending decisions.
2. Approve/reject queue (`/approvals`).
3. Memory OS — promote working → long for fleet SOPs.
4. Agents — check Runtime tab heartbeats + recent runs.
5. Audit — spot-check `memory.promote`, `tool_proposal.approve`, `agent_run.create`.

### 14.3 When adding a new harness (e.g. Codex)

1. Create agent row with `framework: codex`.
2. Settings → Honcho peers → Register `codex` AI peer.
3. Assign model provider if CLI uses known API.
4. Export bundle; ensure pull worker includes agent.
5. Wire CLI to read `~/.hermes/agent-os-bundle/agents/<slug>/AGENT.md`.

### 14.4 Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Honcho pill red | LXC down or wrong IP | `curl 192.168.0.99:8000/health` |
| Hermes no memory | Honcho provider misconfigured | `hermes honcho status` on LXC |
| Bundle stale | Pull cron missing | Install `harness-pull-bundle.mjs` cron |
| Push failed | Gateway has no ingest route | Use pull path (HARNESS_DEPLOY.md) |
| Agent idle forever | No heartbeat | Runtime must POST heartbeat |

---

## 15. Success metrics (ambient ecosystem)

| Metric | Target |
|--------|--------|
| Runtime availability | Hermes + Honcho pills green >99% LAN uptime |
| Spec freshness | Bundle on LXC <5 min behind Agent OS |
| Memory sync | Honcho conclusions mirrored within 24h (or on-demand) |
| Governance | 100% tool/model changes via `decisions` |
| Audit coverage | Every promote/approve/run has audit row |
| Operator touch time | <15 min/day for steady state |

---

## 16. Document map (implementation reference)

| Topic | Doc |
|-------|-----|
| **Doc index (start here)** | [DOC_INDEX.md](./DOC_INDEX.md) |
| Presentation pack | [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md), [PRESENTATION.md](./PRESENTATION.md), [DIAGRAMS.md](./DIAGRAMS.md) |
| Week device + firmware | [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md), [DEVICE_BOM.md](./DEVICE_BOM.md) |
| Architecture layers | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Proxmox layout | [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md) |
| Honcho | [HONCHO.md](./HONCHO.md) |
| Memory layers | [MEMORY_MODEL.md](./MEMORY_MODEL.md) |
| Pipelines | [SKILL_PIPELINE_SPEC.md](./SKILL_PIPELINE_SPEC.md) |
| Governance | [GOVERNANCE.md](./GOVERNANCE.md) |
| Model vs runtime | [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md) |
| Bundle format | [harness-sdk.md](../harness-sdk.md) |
| Deploy pull/push | [HARNESS_DEPLOY.md](./HARNESS_DEPLOY.md) |
| v1.1 integration | [V1_1.md](./V1_1.md) |
| Operator demo | [PHASE_B_DEMO.md](./PHASE_B_DEMO.md) |

---

## 17. Greenfield implementation checklist (copy for project kickoff)

```text
□ Phase 0 — Next.js + SQLite + agents CRUD + Pi deploy
□ Phase A — memory + pipelines + governance APIs + audit
□ Phase B — full dashboard (memory, pipelines, governance, models, audit demo)
□ Phase C.1 — Honcho LXC (:8000, workspace hermes, peer yoshi)
□ Phase C.2 — Hermes LXC (:3000/:8642, honcho provider)
□ Phase C.3 — Agent OS env + health pills + Honcho sync
□ Phase C.4 — harness-pull-bundle cron on Hermes
□ Phase C.5 — heartbeats + agent_runs from runtime
□ Phase C.6 — Honcho peers for claude/codex/gemini
□ Phase D — alerts, scheduled sync, OpenClaw import
□ Security — API keys, confidential memory, backups
□ Handoff — another operator passes PHASE_B_DEMO without developer
```

---

## 18. Glossary

| Term | Definition |
|------|------------|
| **Control plane** | Agent OS — specs, governance, fleet catalog |
| **Runtime / harness** | Where an agent executes (Hermes, OpenClaw, CLI) |
| **Model provider** | Inference API (Ollama, Anthropic, …) |
| **Honcho** | Dialectic user-modeling memory service (peers, conclusions) |
| **Bundle** | Versioned AGENT.md + SKILL.md + pipeline export for runtimes |
| **Ambient** | Persistent context + background runtimes + low-touch operator UX |
| **Decision** | Approval ticket for elevated autonomy |

---

*This document is the greenfield north star. Implementations may exist in-repo ahead of this spec; treat sections §5–§9 as the contract to verify against, not assumptions that work is unfinished.*
