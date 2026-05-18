# Honcho integration

Honcho is your **shared long-term memory service** on a **dedicated Proxmox LXC** at **`192.168.0.99:8000`** (self-hosted, **not** on the Hermes host at `192.168.0.168`). Hermes Workspace (`memory.provider: honcho`) reaches it over LAN. Agent OS stores the **API base URL** in Settings → Harness for future health/sync. **Claude Code, Codex, and Gemini** are planned as additional `hosts` entries on the same Honcho deployment.

## Your deployment (reference)

| Host | IP | Role |
|------|-----|------|
| Hermes Workspace | `192.168.0.168` | UI `:3000`, gateway `:8642` |
| Honcho API | `192.168.0.99` | API `:8000` |

Hermes-side Honcho client config (from `~/.honcho/config.json` or `$HERMES_HOME/honcho.json`):

```json
{
  "baseUrl": "http://192.168.0.99:8000",
  "hosts": {
    "hermes": {
      "enabled": true,
      "aiPeer": "hermes",
      "workspace": "hermes",
      "peerName": "yoshi"
    }
  },
  "recallMode": "hybrid",
  "dialecticCadence": 5,
  "dialecticDepth": 1,
  "contextCadence": 1
}
```

| Field | Meaning for Agent OS |
|-------|----------------------|
| `workspace: "hermes"` | Honcho workspace id — future bridge should scope reads here |
| `peerName: "yoshi"` | Human peer — canonical user model in Honcho |
| `aiPeer: "hermes"` | Hermes agent peer — separate from future `claude` / `codex` / `gemini` AI peers |
| `recallMode: "hybrid"` | Auto-inject context + Honcho tools available in Hermes |
| `dialecticCadence: 5` | Dialectic LLM call at most every 5 turns (cost/latency tradeoff) |

## What Honcho stores

Honcho organizes data as:

| Primitive | Role |
|-----------|------|
| **Workspace** | Top-level isolation (e.g. one per person or product) |
| **Peer** | Persistent entity (user, agent, assistant persona) |
| **Session** | Thread of interaction with temporal bounds |
| **Messages** | Turns that trigger reasoning |

Unlike flat key-value memory, Honcho runs **dialectic reasoning** after turns (configurable `dialecticCadence`) to build conclusions about preferences, goals, and style. Hermes injects **base context** + **dialectic supplement** into the system prompt in `hybrid` / `context` recall modes.

Official Hermes docs: [Honcho Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/honcho).

## Three memory layers in your stack

```text
┌─────────────────────────────────────────────────────────────┐
│ Agent OS — /api/memory/* (SQLite memory_entries)            │
│ Purpose: fleet-wide facts, SOPs, governance, cross-agent    │
│          catalog with sensitivity + audit                   │
└───────────────────────────┬─────────────────────────────┘
                            │ future: adapter (dual-write or
                            │         index pointers only)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Honcho LXC — dialectic user model, sessions, conclusions    │
│ Purpose: runtime memory for Hermes + future Claude/Codex/   │
│          Gemini (canonical for “who is the user”)           │
└───────────────────────────┬─────────────────────────────┘
                            │ Hermes also has file fallback
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Hermes file memory — ~/.hermes/memories/ MEMORY.md, USER.md │
│ Purpose: local profile when provider is builtin; secondary  │
│          when Honcho is active                              │
└─────────────────────────────────────────────────────────────┘
```

**Source of truth (recommended):**

| Data type | Canonical store |
|-----------|-----------------|
| User preferences, session conclusions, peer cards | **Honcho** |
| Agent fleet specs, skills, tools, approvals | **Agent OS** SQLite |
| Session scratch, tool traces | Harness runtime (Hermes session / OpenClaw session) |
| Operator-curated “must never forget” fleet facts | **Agent OS** `long` layer (and optionally mirrored to Honcho via worker) |

## Hermes ↔ Honcho (already running)

Typical Hermes config:

```yaml
# ~/.hermes/config.yaml (inside Hermes LXC)
memory:
  provider: honcho
```

```bash
# ~/.hermes/.env (on Hermes LXC, e.g. 192.168.0.168)
HONCHO_API_KEY=...
# Self-hosted Honcho LXC: API base is set in honcho client config — discover with:
hermes honcho status
```

Agent OS default: **Settings → Harness → Honcho** → `http://192.168.0.99:8000`.

```bash
# From Agent OS machine or Pi
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.99:8000/health
```

CLI on Hermes LXC: `hermes honcho status`, `hermes memory setup`.

**Multi-agent:** Honcho **peer** separation prevents cross-contamination when multiple Hermes profiles (or future harnesses) talk to the same human—map each Agent OS agent to a Honcho `peer_id` in future `runtime_instances` metadata.

## Planned: Claude, Codex, Gemini

Integration patterns (not yet implemented in Agent OS):

1. **Same Honcho workspace** — one user peer; each harness gets its own **AI peer** (directional observation, default in Hermes).
2. **Session strategy** — align with how each tool names sessions (`per-directory`, `per-repo`, or `global`); document in Agent OS agent record.
3. **Agent OS bridge** — optional HTTP worker:
   - **Pull**: list conclusions / representations → upsert `memory_entries` with `source: honcho`, `external_id`.
   - **Push**: promote Agent OS `long` layer entries to Honcho peer cards (operator-approved only).

Until the bridge exists, use **Honcho dashboard** ([app.honcho.dev](https://app.honcho.dev/) or self-hosted UI) for memory inspection; use **Agent OS Memory** for fleet governance and harness-agnostic retrieval.

## API keys and networking

- Honcho LXC should be reachable from Hermes LXC and from any future harness LXC on a **private VLAN**.
- Do not expose Honcho to the public internet without TLS and auth.
- Store `HONCHO_API_KEY` in harness env only; Agent OS Settings stores **base URL** for operators (keys via env on the Pi/server if a bridge is added later).

## Related

- [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md)
- [MEMORY_MODEL.md](./MEMORY_MODEL.md)
