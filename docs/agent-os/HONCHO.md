# Honcho integration

Honcho is your **shared long-term memory service** on a dedicated Proxmox LXC. Hermes Workspace (Hermes Agent with `memory.provider: honcho`) is already connected. **Claude Code, Codex, and Gemini** are planned to use the same Honcho deployment so user modeling stays consistent across model providers.

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
# ~/.hermes/.env
HONCHO_API_KEY=...
# If self-hosted Honcho LXC, point client at your API base URL per Honcho deploy docs
```

CLI: `hermes honcho status`, `hermes memory setup`.

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
