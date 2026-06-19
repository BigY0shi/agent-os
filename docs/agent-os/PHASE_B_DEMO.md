# Phase B — Operator demo (≈10 minutes)

**Audience:** Operator or reviewer who has never touched the codebase  
**Goal:** Prove Phase B win gates **W1–W4** on a fresh database without curl or SQLite  
**Prerequisites:** Node 18+, `npm install`, `npm run dev` → open `http://localhost:3000`

---

## Fresh database (optional)

To reset seed data, stop the dev server and delete the local SQLite file (path depends on deploy; dev default is under `data/` or project root per `lib/db.js`), then restart `npm run dev`.

When API keys are **not** set, all browser actions run as **admin** (local dev). In production, use an **operator** token — see [GOVERNANCE.md](./GOVERNANCE.md).

---

## 1. Memory attach (≈2 min) — W1

1. Open **Agents** → click **Content Agent** (CMO department).
2. Go to the **Memory** tab — note it may be empty.
3. Open **Memory OS** (sidebar).
4. Click **Add memory**:
   - Title: `Brand voice Q2`
   - Content: `Tone: direct, optimistic. Avoid jargon.`
   - Layer: `working`
   - Agent: **Content Agent**
   - Team: **CMO**
5. Save. Filter by agent **Content Agent** — entry appears.
6. Click **Promote** (working → mid). Open the entry drawer → **View audit history** (or list-row **Audit** link).

**Pass:** Entry visible on agent Memory tab; promote shows `memory.promote` in audit.

---

## 2. Pipeline compose & run (≈3 min) — W2

1. Open **Skill pipelines**.
2. **New pipeline** → name `Content brief flow`.
3. In the editor, add **3 nodes** with different skills (e.g. Content Writing, SEO Optimization, Trend Analysis).
4. **Save pipeline** → reload page — definition intact.
5. Switch to **Runs** → **Demo (queued→succeeded)**.
6. Select the run → **View in audit log** (or header **All runs**).

**Pass:** Run shows `queued` → `running` → `succeeded`; audit contains `pipeline.run.create` / `pipeline.run.update`.

---

## 3. Governance & models (≈4 min) — W3

### Tool proposal

1. Open **Governance** → **Tool proposals** → **Submit tool proposal** (name: `export-csv-tool`).
2. **Approve** the proposal. Click **Audit trail** on the row.

**Pass:** Status `approved`; audit shows `tool_proposal.approve`.

### Safety

1. **Safety** tab → **Report safety event** (message: `Test policy drift`, severity `med`).
2. **Mitigate** with note `Demo mitigation`.

**Pass:** Status `mitigated`; audit shows `safety_event.mitigated`.

### Goals

1. **Goals & opinions** → **Add** goal for agent id **1** (Content Agent), title `Ship Q2 blog series`, priority `20`.
2. Add a second goal, priority `10`. Use **↑ priority** so the blog goal sorts first.
3. **Mark done** on one goal.
4. Open **Agents** → Content Agent → **Governance** tab — both goals visible.

**Pass:** Goals on agent + governance; audit shows `agent_goal.create` / `agent_goal.update`.

### Model providers & change

1. **Settings** → **Model Providers** → edit **Ollama Cloud** base URL / default model → **Save** → **Test connection** (may fail offline — that's OK).
2. **Agents** → Content Agent → **Settings** tab → **Edit**:
   - Framework: **Hermes Workspace**
   - Model provider: **Ollama Cloud**
   - Model id: `llama3.3`
   - Save.
3. **Governance** → **Model changes** → **Request model change**:
   - Agent id: `1`
   - New model: `qwen2.5:72b`
   - Provider slug: `ollama-cloud`
4. **Approve** the pending decision.

**Pass:** Agent shows updated model; audit shows `model.change` and `decision.approve`.

### Typed approval

1. Open **Approvals** → filter type **tool_publish** (or create a `tool_publish` decision via API if none exist).
2. Approve or reject a pending item.

**Pass:** Filter works; status updates.

---

## 4. Audit trace (≈1 min) — W4

1. Open **Audit log** (sidebar).
2. Confirm rows for actions performed above, e.g.:
   - `memory.promote`
   - `tool_proposal.approve`
   - `pipeline.run.create` or `pipeline.run.update`
   - `model.change`
3. Use filters: resource type `memory`, action `promote`, etc.
4. Follow cross-links from **Memory**, **Pipelines**, and **Governance** rows back to filtered audit views.

**Pass:** W4.1 trace — multiple resource types visible with correct filters.

---

## Exit checklist

| Gate | Verified in demo |
|------|------------------|
| W1.1–W1.4 Memory | §1 |
| W2.1–W2.4 Pipelines | §2 |
| W3.1–W3.8 Governance + models | §3 |
| W4.1–W4.3 Audit & demo | §4 + this doc |

Run `npm run build` before release — **W4.2**.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Audit page empty / 401 | Set `AGENT_OS_API_KEYS` with an **operator** token; or unset keys for local dev |
| No skills in pipeline dropdown | Seed includes skills; refresh **Skill pipelines** page |
| Model probe fails | Expected without live Ollama/Anthropic endpoints; registry save still counts for W3.6 |
| Agent id unknown | Fleet list order matches seed; Content Agent is typically id **1** on fresh DB |

---

## Related

- [PHASE_B_PLAN.md](./PHASE_B_PLAN.md) — full milestone spec  
- [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md) — runtime vs provider split  
- [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md) — Hermes / Honcho / OpenClaw LXCs (Phase C)
